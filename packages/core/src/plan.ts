import { formatPatch, structuredPatch } from 'diff';
import { isMap, parseDocument } from 'yaml';
import { MfeflowError, messageOf } from './errors.js';

export type ChangeAction = 'create' | 'patch' | 'delete';

/** One file the plan touches. `before` and `after` are whole file contents. */
export interface FileChange {
  path: string;
  action: ChangeAction;
  /** What the plan was made against. Null for a file that does not exist yet. */
  before: string | null;
  /** What the file becomes. Null for a delete. */
  after: string | null;
  /** True for files copied from a feature: their hash is recorded for `upgrade`. */
  track: boolean;
}

export interface PlanFeature {
  name: string;
  version: string;
  options?: Record<string, unknown>;
}

export interface DependencyAdd {
  file: string;
  name: string;
  range: string;
  dev: boolean;
}

/** Added to package.json and shown. The engine never runs it. */
export interface ScriptAdd {
  file: string;
  name: string;
  command: string;
}

export interface EnvKeyAdd {
  file: string;
  key: string;
}

/** Everything `add` or `init` is about to do. Plain data, so it survives JSON and the MCP server. */
export interface Plan {
  version: 1;
  features: PlanFeature[];
  changes: FileChange[];
  dependencies: DependencyAdd[];
  scripts: ScriptAdd[];
  env: EnvKeyAdd[];
  warnings: string[];
}

export function emptyPlan(): Plan {
  return {
    version: 1,
    features: [],
    changes: [],
    dependencies: [],
    scripts: [],
    env: [],
    warnings: [],
  };
}

/** Reads a project file by relative path; undefined when it does not exist. */
export type ReadFile = (file: string) => Promise<string | undefined>;

export interface PlanBuilderOptions {
  /** Put new dependencies in the `catalog:` of pnpm-workspace.yaml and reference them as `catalog:`. */
  catalog?: boolean;
}

const WORKSPACE_FILE = 'pnpm-workspace.yaml';

interface Tracked {
  original: string | null;
  current: string | null;
  track: boolean;
}

/**
 * Collects edits in memory on top of what `read` returns. Nothing touches the
 * disk; `build()` turns the edits into a {@link Plan}.
 */
export class PlanBuilder {
  private readonly files = new Map<string, Tracked>();
  private readonly plan = emptyPlan();

  constructor(
    private readonly read: ReadFile,
    private readonly options: PlanBuilderOptions = {},
  ) {}

  private async open(file: string): Promise<Tracked> {
    const known = this.files.get(file);
    if (known) return known;
    const content = (await this.read(file)) ?? null;
    const entry: Tracked = { original: content, current: content, track: false };
    this.files.set(file, entry);
    return entry;
  }

  async exists(file: string): Promise<boolean> {
    return (await this.open(file)).current !== null;
  }

  async content(file: string): Promise<string | undefined> {
    return (await this.open(file)).current ?? undefined;
  }

  addFeature(feature: PlanFeature): void {
    this.plan.features.push(feature);
  }

  warn(message: string): void {
    this.plan.warnings.push(message);
  }

  /** Creates a file. Asking for the same content again is fine; different content is a conflict. */
  async create(file: string, content: string, track = true): Promise<void> {
    const entry = await this.open(file);
    if (entry.current !== null && entry.current !== content) {
      throw new MfeflowError('E207', file);
    }
    if (entry.current === null) entry.track = track;
    entry.current = content;
  }

  /** Rewrites an existing file. */
  async patch(file: string, edit: (source: string) => string): Promise<void> {
    const entry = await this.open(file);
    if (entry.current === null) throw new MfeflowError('E208', `${file} does not exist`);
    entry.current = edit(entry.current);
  }

  async delete(file: string): Promise<void> {
    const entry = await this.open(file);
    entry.current = null;
  }

  async addDependency(file: string, name: string, range: string, dev = false): Promise<void> {
    let wanted = range;
    if (this.options.catalog && !isPinnedElsewhere(range))
      wanted = await this.useCatalog(name, range);
    await this.patch(file, (source) =>
      editPackageJson(file, source, (pkg) => {
        const key = dev ? 'devDependencies' : 'dependencies';
        pkg[key] = sortedWith(pkg[key], name, wanted);
      }),
    );
    this.plan.dependencies.push({ file, name, range: wanted, dev });
  }

  async addScript(file: string, name: string, command: string): Promise<void> {
    await this.patch(file, (source) =>
      editPackageJson(file, source, (pkg) => {
        pkg.scripts = { ...asRecord(pkg.scripts), [name]: command };
      }),
    );
    this.plan.scripts.push({ file, name, command });
  }

  addEnvKey(file: string, key: string): void {
    this.plan.env.push({ file, key });
  }

  private async useCatalog(name: string, range: string): Promise<string> {
    if (!(await this.exists(WORKSPACE_FILE))) return range;
    const source = (await this.content(WORKSPACE_FILE)) ?? '';
    const doc = parseDocument(source);
    const catalog = doc.get('catalog');
    const existing = isMap(catalog) ? catalog.get(name) : undefined;
    if (typeof existing === 'string') {
      if (existing !== range) {
        this.warn(`${name} is ${existing} in the catalog; using that instead of ${range}`);
      }
      return 'catalog:';
    }
    doc.setIn(['catalog', name], range);
    await this.patch(WORKSPACE_FILE, () => doc.toString());
    return 'catalog:';
  }

  build(): Plan {
    const changes: FileChange[] = [];
    for (const [file, entry] of [...this.files].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
      if (entry.original === entry.current) continue;
      const action: ChangeAction =
        entry.original === null ? 'create' : entry.current === null ? 'delete' : 'patch';
      changes.push({
        path: file,
        action,
        before: entry.original,
        after: entry.current,
        track: action === 'create' && entry.track,
      });
    }
    return { ...this.plan, changes };
  }
}

function isPinnedElsewhere(range: string): boolean {
  return range.startsWith('catalog:') || range.startsWith('workspace:');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function sortedWith(existing: unknown, name: string, range: string): Record<string, unknown> {
  const next = { ...asRecord(existing), [name]: range };
  return Object.fromEntries(Object.entries(next).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

function indentOf(source: string): string | number {
  const match = /^[ \t]+(?=")/m.exec(source);
  return match ? match[0] : 2;
}

/** Edits a package.json, keeping its indentation and final newline. */
function editPackageJson(
  file: string,
  source: string,
  edit: (pkg: Record<string, unknown>) => void,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new MfeflowError('E208', `${file} is not valid JSON (${messageOf(error)})`, {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MfeflowError('E208', `${file} is not a JSON object`);
  }
  const pkg = asRecord(parsed);
  edit(pkg);
  return `${JSON.stringify(pkg, null, indentOf(source))}${source.endsWith('\n') ? '\n' : ''}`;
}

/** The unified diff of every file change, one `---`/`+++` block per file. */
export function renderDiff(plan: Plan, context = 3): string {
  const blocks: string[] = [];
  for (const change of plan.changes) {
    const patch = structuredPatch(
      change.before === null ? '/dev/null' : `a/${change.path}`,
      change.after === null ? '/dev/null' : `b/${change.path}`,
      change.before ?? '',
      change.after ?? '',
      undefined,
      undefined,
      { context },
    );
    blocks.push(`diff --mfeflow ${change.path}\n${formatPatch(patch)}`);
  }
  return blocks.join('\n');
}

const VERB: Record<ChangeAction, string> = { create: 'create', patch: 'patch ', delete: 'delete' };

/** A short human summary: counts, then each file, dependency, script and env key. */
export function summarize(plan: Plan): string {
  const count = (action: ChangeAction) => plan.changes.filter((c) => c.action === action).length;
  const lines = [
    `${String(count('create'))} to create, ${String(count('patch'))} to patch, ${String(count('delete'))} to delete`,
  ];
  for (const c of plan.changes) lines.push(`  ${VERB[c.action]}  ${c.path}`);
  if (plan.dependencies.length > 0) {
    lines.push(`Dependencies (${String(plan.dependencies.length)}):`);
    for (const d of plan.dependencies) {
      lines.push(`  ${d.file}  ${d.name}@${d.range}${d.dev ? ' (dev)' : ''}`);
    }
  }
  if (plan.scripts.length > 0) {
    lines.push(`Scripts added to package.json, not run (${String(plan.scripts.length)}):`);
    for (const s of plan.scripts) lines.push(`  ${s.file}  ${s.name}: ${s.command}`);
  }
  if (plan.env.length > 0) {
    lines.push(`Runtime config keys (${String(plan.env.length)}):`);
    for (const e of plan.env) lines.push(`  ${e.file}  ${e.key}`);
  }
  for (const w of plan.warnings) lines.push(`Warning: ${w}`);
  return lines.join('\n');
}
