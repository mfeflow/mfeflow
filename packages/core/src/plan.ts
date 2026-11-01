import { formatPatch, structuredPatch } from 'diff';
import { isMap, parseDocument } from 'yaml';
import { validRange } from 'semver';
import { MfeflowError, messageOf } from './errors';
import { asRecord, editJsonObject, parseJsonObject } from './json';
import type { Trust } from './features/policy';
import { PROJECT_FILE } from './project';

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
  /** Who asked for the change; a file any third-party feature touched is third-party. `applyPlan` holds third-party changes to a stricter symlink rule than first-party ones. */
  trust: Trust;
}

export interface PlanFeature {
  name: string;
  version: string;
  options?: Record<string, unknown>;
  /** `sha256-<hex>` of the feature.json a registry served; recorded in mfeflow.json. */
  integrity?: string;
}

export interface DependencyAdd {
  file: string;
  name: string;
  range: string;
  dev: boolean;
  /** Added by a third-party feature, so `summarize` lists it in its own block. */
  thirdParty?: boolean;
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
  /**
   * What `mfeflow.json` held when the plan was made (null: no file). `applyPlan`
   * checks it like any other target, so an edit in between is an E211.
   */
  projectBefore?: string | null;
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
  /**
   * Replaces a dependency's declared range before it is written, for example
   * `latest` with a `link:` path. A replaced range goes into package.json as
   * returned and never into the catalog. Return undefined to keep the range.
   */
  rewriteRange?: (name: string, range: string) => string | undefined;
}

const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

interface Tracked {
  original: string | null;
  current: string | null;
  track: boolean;
  trust: Trust;
}

interface BuilderState {
  files: Map<string, Tracked>;
  plan: Plan;
  projectBefore: string | null | undefined;
}

/**
 * Collects edits in memory on top of what `read` returns. Nothing touches the
 * disk; `build()` turns the edits into a {@link Plan}.
 */
export class PlanBuilder {
  private readonly state: BuilderState;

  constructor(
    private readonly read: ReadFile,
    private readonly options: PlanBuilderOptions = {},
    private readonly trust: Trust = 'first-party',
    state?: BuilderState,
  ) {
    this.state = state ?? { files: new Map(), plan: emptyPlan(), projectBefore: undefined };
  }

  private get files(): Map<string, Tracked> {
    return this.state.files;
  }

  private get plan(): Plan {
    return this.state.plan;
  }

  /** A view on the same plan whose edits are recorded as made by `trust`. */
  scoped(trust: Trust): PlanBuilder {
    return new PlanBuilder(this.read, this.options, trust, this.state);
  }

  private touch(entry: Tracked): void {
    if (this.trust === 'third-party') entry.trust = 'third-party';
  }

  private async open(file: string): Promise<Tracked> {
    const known = this.files.get(file);
    if (known) return known;
    const content = (await this.read(file)) ?? null;
    const entry: Tracked = {
      original: content,
      current: content,
      track: false,
      trust: 'first-party',
    };
    this.files.set(file, entry);
    return entry;
  }

  async exists(file: string): Promise<boolean> {
    return (await this.open(file)).current !== null;
  }

  async content(file: string): Promise<string | undefined> {
    return (await this.open(file)).current ?? undefined;
  }

  /** Remembers `mfeflow.json` as it is now; `applyPlan` refuses to continue if it changes before the write. */
  async captureProject(): Promise<void> {
    this.state.projectBefore = (await this.read(PROJECT_FILE)) ?? null;
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
    this.touch(entry);
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
    this.touch(entry);
    entry.current = edit(entry.current);
  }

  /** Overwrites a file that exists, shown as a modification. First-party only: a third-party feature never replaces content. */
  async replace(file: string, content: string): Promise<void> {
    const entry = await this.open(file);
    if (entry.current === null) throw new MfeflowError('E208', `${file} does not exist`);
    if (this.trust === 'third-party' && entry.current !== content) {
      throw new MfeflowError('E207', file);
    }
    this.touch(entry);
    entry.current = content;
  }

  async delete(file: string): Promise<void> {
    const entry = await this.open(file);
    this.touch(entry);
    entry.current = null;
  }

  async addDependency(file: string, name: string, range: string, dev = false): Promise<void> {
    const rewritten = this.options.rewriteRange?.(name, range);
    let wanted = rewritten ?? range;
    if (this.options.catalog && rewritten === undefined && !isPinnedElsewhere(range))
      wanted = await this.useCatalog(name, range);
    let added = true;
    await this.patch(file, (source) =>
      editJsonObject(file, source, (pkg) => {
        const existing = [pkg.dependencies, pkg.devDependencies]
          .map((section) => asRecord(section)[name])
          .find((value) => value !== undefined);
        if (existing === wanted || existing === range) {
          added = false;
          return false;
        }
        if (existing !== undefined) {
          throw new MfeflowError(
            'E207',
            `${file}: ${name} is already ${JSON.stringify(existing)}; the feature wants ${wanted}`,
          );
        }
        const key = dev ? 'devDependencies' : 'dependencies';
        pkg[key] = sortedWith(pkg[key], name, wanted);
        return true;
      }),
    );
    if (added) {
      this.plan.dependencies.push({
        file,
        name,
        range: wanted,
        dev,
        ...(this.trust === 'third-party' ? { thirdParty: true } : {}),
      });
    }
  }

  /**
   * Moves an existing dependency to `range`. A dependency on `catalog:` changes
   * its entry in pnpm-workspace.yaml instead. A `workspace:` link, or any
   * specifier that is not a registry range (`npm:`, `link:`, `file:`, a
   * repository or a URL), is the project's own choice and is left alone with a
   * warning. The new range must be a semver range or a dist-tag (E202). A
   * missing dependency is an E208. A third-party feature can only ask for the
   * range that is already there.
   */
  async setRange(file: string, name: string, range: string): Promise<void> {
    if (!isRegistryRange(range)) {
      throw new MfeflowError('E202', `${name}: "${range}" is not a semver range or a dist-tag`);
    }
    const source = await this.content(file);
    if (source === undefined) throw new MfeflowError('E208', `${file} does not exist`);
    const existing = this.declaredRange(file, source, name);
    if (existing === range || existing.startsWith('workspace:')) return;
    if (!existing.startsWith('catalog:') && !isRegistryRange(existing)) {
      this.warn(
        `${file}: ${name} is ${JSON.stringify(existing)}; left as it is, not moved to ${range}`,
      );
      return;
    }
    if (this.trust === 'third-party') {
      throw new MfeflowError(
        'E207',
        `${file}: ${name} is already ${JSON.stringify(existing)}; the feature wants ${range}`,
      );
    }
    if (existing.startsWith('catalog:')) {
      await this.setCatalogEntry(name, existing.slice('catalog:'.length), range);
      return;
    }
    await this.patch(file, (text) =>
      editJsonObject(file, text, (pkg) => {
        const section = DEPENDENCY_SECTIONS.find((key) => name in asRecord(pkg[key])) ?? '';
        pkg[section] = { ...asRecord(pkg[section]), [name]: range };
        return true;
      }),
    );
  }

  private declaredRange(file: string, source: string, name: string): string {
    const pkg = parseJsonObject(file, source);
    for (const section of DEPENDENCY_SECTIONS) {
      const value = asRecord(pkg[section])[name];
      if (typeof value === 'string') return value;
    }
    throw new MfeflowError('E208', `${file} does not depend on ${name}`);
  }

  private async setCatalogEntry(name: string, catalogName: string, range: string): Promise<void> {
    const path =
      catalogName === '' || catalogName === 'default' ? ['catalog'] : ['catalogs', catalogName];
    const source = await this.content(WORKSPACE_FILE);
    const doc = source === undefined ? undefined : parseDocument(source);
    const problem = doc?.errors[0];
    if (problem) {
      throw new MfeflowError('E208', `${WORKSPACE_FILE} is not valid YAML (${problem.message})`, {
        cause: problem,
      });
    }
    if (doc === undefined || !isMap(doc.getIn(path)) || !doc.hasIn([...path, name])) {
      throw new MfeflowError('E208', `${WORKSPACE_FILE} has no catalog entry for ${name}`);
    }
    doc.setIn([...path, name], range);
    let text: string;
    try {
      text = doc.toString();
    } catch (error) {
      throw new MfeflowError(
        'E208',
        `${WORKSPACE_FILE} could not be written back (${messageOf(error)})`,
        { cause: error },
      );
    }
    await this.patch(WORKSPACE_FILE, () => text);
  }

  /** Adds a script. An identical one already there is a no-op; a different command under the same name is a conflict. */
  async addScript(file: string, name: string, command: string): Promise<void> {
    let added = true;
    await this.patch(file, (source) =>
      editJsonObject(file, source, (pkg) => {
        const scripts = asRecord(pkg.scripts);
        const existing = scripts[name];
        if (existing === command) {
          added = false;
          return false;
        }
        if (existing !== undefined) {
          throw new MfeflowError('E207', `${file}: script "${name}" already exists`);
        }
        pkg.scripts = { ...scripts, [name]: command };
        return true;
      }),
    );
    if (added) this.plan.scripts.push({ file, name, command });
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
        trust: entry.trust,
      });
    }
    return {
      ...this.plan,
      changes,
      ...(this.state.projectBefore === undefined
        ? {}
        : { projectBefore: this.state.projectBefore }),
    };
  }
}

/** True for a semver range or a dist-tag, the only things a registry resolves. */
function isRegistryRange(range: string): boolean {
  if (range === '' || range !== range.trim() || range.includes('/')) return false;
  return /^[a-z][a-z0-9-]*$/.test(range) || validRange(range) !== null;
}

function isPinnedElsewhere(range: string): boolean {
  return range.startsWith('catalog:') || range.startsWith('workspace:');
}

function sortedWith(existing: unknown, name: string, range: string): Record<string, unknown> {
  const next = { ...asRecord(existing), [name]: range };
  return Object.fromEntries(Object.entries(next).toSorted(([a], [b]) => (a < b ? -1 : 1)));
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

const dependencyLine = (d: DependencyAdd) =>
  `  ${d.file}  ${d.name}@${d.range}${d.dev ? ' (dev)' : ''}`;

/** A short human summary: counts, then each file, dependency, script and env key. */
export function summarize(plan: Plan): string {
  const count = (action: ChangeAction) => plan.changes.filter((c) => c.action === action).length;
  const lines = [
    `${String(count('create'))} to create, ${String(count('patch'))} to patch, ${String(count('delete'))} to delete`,
  ];
  for (const c of plan.changes) lines.push(`  ${VERB[c.action]}  ${c.path}`);
  const dependencies = plan.dependencies.filter((d) => d.thirdParty !== true);
  const newPackages = plan.dependencies.filter((d) => d.thirdParty === true);
  if (dependencies.length > 0) {
    lines.push(`Dependencies (${String(dependencies.length)}):`);
    for (const d of dependencies) lines.push(dependencyLine(d));
  }
  if (newPackages.length > 0) {
    lines.push(
      '',
      `NEW PACKAGES from a third-party feature (${String(newPackages.length)}):`,
      ...newPackages.map(dependencyLine),
      "  Check each one before you install. npm and yarn run a package's install scripts;",
      '  pnpm 10 and later blocks them until you allow them.',
      '',
    );
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
