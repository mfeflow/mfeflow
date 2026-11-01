import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isSafeRelativePath } from '@mfeflow/contracts';
import { formatPatch, structuredPatch } from 'diff';
import semver from 'semver';
import { isMap, parseDocument } from 'yaml';
import { MfeflowError, messageOf } from './errors';
import type { LoadedFeature } from './features/load';
import { resolveFeature } from './features/resolve';
import { hashContent, normalizeEol } from './hash';
import { asRecord, editJsonObject, parseJsonObject } from './json';
import { PlanBuilder, type FileChange, type Plan, type PlanFeature, type ReadFile } from './plan';
import type { MfeflowProject } from './project';

/**
 * What a first-party migration module exports (as `default` or `migrate`). It records its
 * changes on the builder and returns nothing, so a dry run, `--json` and rollback work for it.
 */
export type Migration = (builder: PlanBuilder, project: MfeflowProject) => void | Promise<void>;

export interface UpgradeInput {
  /** The version the project is moving to; every `@mfeflow/*` range becomes `^<toVersion>`. */
  toVersion: string;
  /** Reads a project file by relative path; undefined when it does not exist. */
  read: ReadFile;
  /**
   * The features to replay, in the order `init` applies them (`core` first). Each is replayed with
   * the options `mfeflow.json` recorded for it.
   */
  features: readonly LoadedFeature[];
  /** First-party parts replayed after the features, such as the per-remote registry and route files. */
  glue?: readonly LoadedFeature[];
  /** Recorded features the caller could not load. Their files are left alone and nothing is reported as removed. */
  skipped?: readonly { name: string; reason: string }[];
  /** Whether a project file is itself a symlink. Such a file is never replaced. */
  isSymlink?: (file: string) => Promise<boolean>;
  /** Loads a migration module. Defaults to a dynamic `import()`. */
  importModule?: (file: string) => Promise<unknown>;
}

export type DivergeReason =
  /** Tracked, and the file no longer matches the hash recorded when it was written. */
  | 'edited'
  /** The CLI never wrote this file, but a file is there and differs. */
  | 'untracked'
  /** The CLI edits this file after generating it (`add env-key`), so a match with the recorded hash proves nothing. */
  | 'edited-by-cli'
  /** A feature that could not be replayed may have patched this file, so a matching hash proves nothing. */
  | 'skipped-feature'
  /** The path is a symlink; it is not replaced with a regular file. */
  | 'symlink';

/** A file the new version wants to change that the upgrade will not write. */
export interface DivergedUpgrade {
  path: string;
  reason: DivergeReason;
  /** What is on disk. */
  yours: string;
  /** What the new version generates. */
  incoming: string;
  /** Unified diff from `yours` to `incoming`. */
  diff: string;
}

export interface UpgradePlan {
  /** The version the project was made with, and where that came from. */
  from: string;
  fromSource: 'mfeflow.json' | 'package.json';
  to: string;
  /** Replaced, created and structurally edited files. Apply it with `applyPlan`, passing `project`. */
  plan: Plan;
  /** The project to hand to `applyPlan`: `cli` is `to`; hashes and feature versions are filled in on apply. */
  project: MfeflowProject;
  /** Files with changes the upgrade did not write, each with a diff. */
  diverged: DivergedUpgrade[];
  /** Files the old version generated and the new one no longer does. Reported, never deleted. */
  removed: string[];
  /** Files the old version generated that you deleted. They are not brought back. */
  missing: string[];
}

const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const TURBO_FILE = 'turbo.json';
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const OWN_PREFIX = '@mfeflow/';
const OWN_CLI = 'mfeflow';
const PLACEHOLDER_RANGE = 'latest';
/** Registry entries hold deployed versions; they are the project's data, not generated code. */
const USER_DATA = /^registry\/envs\//;
/** Files `mfeflow add env-key` adds keys to after they are generated, and records nowhere. */
const ENV_KEY_FILES =
  /(^|\/)(env\.ts|src\/config\/schema\.ts|runtime-config(\.[^/]+)?\.json|\.env[^/]*)$/;
const KEEP_RANGE = /^(workspace|link|file|portal):/;

/** Path order that is the same on every machine. */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const isOwn = (name: string) => name === OWN_CLI || name.startsWith(OWN_PREFIX);
const isPackageFile = (file: string) => file === 'package.json' || file.endsWith('/package.json');
const isStructured = (file: string) =>
  isPackageFile(file) || file === WORKSPACE_FILE || file === TURBO_FILE;
const sameText = (a: string, b: string) => normalizeEol(a) === normalizeEol(b);

/** The range of `@mfeflow/runtime` in a package.json, following `catalog:` into the workspace file. */
async function runtimeRange(
  pkgFile: string,
  read: ReadFile,
): Promise<{ range: string; catalog: string | undefined } | undefined> {
  const source = await read(pkgFile);
  if (source === undefined) return undefined;
  const pkg = parseJsonObject(pkgFile, source);
  for (const section of DEPENDENCY_SECTIONS) {
    const value = asRecord(pkg[section])['@mfeflow/runtime'];
    if (typeof value !== 'string') continue;
    if (!value.startsWith('catalog:')) return { range: value, catalog: undefined };
    return { range: value, catalog: value.slice('catalog:'.length) };
  }
  return undefined;
}

async function catalogRange(read: ReadFile, catalogName: string): Promise<string | undefined> {
  const source = await read(WORKSPACE_FILE);
  if (source === undefined) return undefined;
  const doc = parseDocument(source);
  const where =
    catalogName === '' || catalogName === 'default' ? ['catalog'] : ['catalogs', catalogName];
  const value: unknown = doc.getIn([...where, '@mfeflow/runtime']);
  return typeof value === 'string' ? value : undefined;
}

function resolveRange(
  found: { range: string; catalog: string | undefined },
  read: ReadFile,
): Promise<string | undefined> {
  return found.catalog === undefined
    ? Promise.resolve(found.range)
    : catalogRange(read, found.catalog);
}

/**
 * The version of the CLI that made the project: `cli` in `mfeflow.json`, else the lowest version
 * the shell's `@mfeflow/runtime` range allows (0.1 projects have no `cli`). A `workspace:`,
 * `link:` or non-version range cannot be read, and that is an error rather than a guess.
 */
export async function detectBaseline(
  project: MfeflowProject,
  read: ReadFile,
): Promise<{ version: string; source: 'mfeflow.json' | 'package.json' }> {
  if (project.cli !== undefined) return { version: project.cli, source: 'mfeflow.json' };
  const apps = Object.values(project.apps).toSorted(
    (a, b) => Number(b.kind === 'shell') - Number(a.kind === 'shell'),
  );
  for (const app of apps) {
    const file = app.path === '' ? 'package.json' : `${app.path}/package.json`;
    // oxlint-disable-next-line no-await-in-loop -- the shell is looked at first; later apps only when it has no runtime dependency
    const found = await runtimeRange(file, read);
    if (found === undefined) continue;
    // oxlint-disable-next-line no-await-in-loop -- one lookup, and only for a catalog: range
    const range = await resolveRange(found, read);
    const min = range !== undefined && !KEEP_RANGE.test(range) ? minimum(range) : undefined;
    if (min === undefined) {
      throw new MfeflowError(
        'E601',
        `${file} has @mfeflow/runtime at ${JSON.stringify(found.range)}, which does not name a version`,
      );
    }
    return { version: min, source: 'package.json' };
  }
  throw new MfeflowError(
    'E601',
    'mfeflow.json has no "cli" and no app depends on @mfeflow/runtime',
  );
}

function minimum(range: string): string | undefined {
  if (semver.validRange(range) === null) return undefined;
  const min = semver.minVersion(range)?.version;
  // `*`, `x` and `>=0` allow anything; they say nothing about the version that made the project.
  return min === '0.0.0' ? undefined : min;
}

function recordedOptions(
  feature: LoadedFeature,
  project: MfeflowProject,
  warnings: string[],
): Record<string, unknown> {
  const recorded = project.features[feature.manifest.name]?.options ?? {};
  const known = new Set((feature.manifest.prompts ?? []).map((p) => p.name));
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(recorded)) {
    if (known.has(key)) kept[key] = value;
    else
      warnings.push(`${feature.manifest.name} no longer has the option "${key}"; it was ignored`);
  }
  return kept;
}

interface Replay {
  files: Map<string, string>;
  tracked: Set<string>;
  features: PlanFeature[];
  warnings: string[];
}

/** Applies the skeleton, every recorded feature and the glue to an empty tree, as `init` did. */
async function replay(project: MfeflowProject, input: UpgradeInput): Promise<Replay> {
  const local = project.local !== undefined;
  const builder = new PlanBuilder(() => Promise.resolve(undefined), {
    catalog: true,
    ...(local
      ? {}
      : {
          rewriteRange: (name: string, range: string) =>
            isOwn(name) && range === PLACEHOLDER_RANGE ? `^${input.toVersion}` : undefined,
        }),
  });
  const warnings: string[] = [];
  const names = [
    ...input.features.map((f) => f.manifest.name),
    ...(input.skipped ?? []).map((s) => s.name),
  ];
  const bare: MfeflowProject = { ...project, features: {} };
  const steps: { feature: LoadedFeature; options: Record<string, unknown> }[] = [
    ...input.features.map((feature) => ({
      feature,
      options: recordedOptions(feature, project, warnings),
    })),
    ...(input.glue ?? []).map((feature) => ({ feature, options: {} })),
  ];
  for (const step of steps) {
    // oxlint-disable-next-line no-await-in-loop -- a feature may edit the files an earlier one created
    await resolveFeature({ ...step, project: bare, builder, alsoAdding: names });
  }
  const built = builder.build();
  const files = new Map<string, string>();
  const tracked = new Set<string>();
  for (const change of built.changes) {
    if (change.after === null) continue;
    files.set(change.path, change.after);
    if (change.track) tracked.add(change.path);
  }
  const byName = new Map(built.features.map((f) => [f.name, f]));
  return {
    files,
    tracked,
    features: [...byName.values()],
    warnings,
  };
}

/** A file that used CRLF keeps it, so Windows checkouts do not see the whole file change. */
function keepLineEndings(change: FileChange): FileChange {
  if (change.after === null || !change.before?.includes('\r\n')) return change;
  return { ...change, after: normalizeEol(change.after).replaceAll('\n', '\r\n') };
}

function unifiedDiff(file: string, yours: string, incoming: string): string {
  return formatPatch(structuredPatch(`a/${file} (yours)`, `b/${file} (new)`, yours, incoming));
}

interface Classified {
  diverged: DivergedUpgrade[];
  missing: string[];
  /** Files already holding the new content, whose recorded hash is brought up to date. */
  matching: string[];
}

type Verdict = 'create' | 'missing' | 'matching' | 'replace' | 'leave' | DivergeReason;

/** What to do with one generated file, given what is on disk and what was recorded for it. */
function judge(
  file: string,
  disk: string | undefined,
  incoming: string,
  recorded?: string,
  anySkipped = false,
): Verdict {
  if (disk === undefined) {
    if (recorded !== undefined) return 'missing';
    return USER_DATA.test(file) ? 'leave' : 'create';
  }
  if (sameText(disk, incoming)) {
    return recorded !== undefined && recorded !== hashContent(disk) ? 'matching' : 'leave';
  }
  if (USER_DATA.test(file)) return 'leave';
  if (recorded === undefined) return 'untracked';
  if (ENV_KEY_FILES.test(file)) return 'edited-by-cli';
  if (recorded !== hashContent(disk)) return 'edited';
  return anySkipped ? 'skipped-feature' : 'replace';
}

/** Replaces, creates or flags every generated file that is not structured. */
async function compareFiles(
  project: MfeflowProject,
  fresh: Replay,
  read: ReadFile,
  builder: PlanBuilder,
  options: { anySkipped: boolean; isSymlink?: (file: string) => Promise<boolean> },
): Promise<Classified> {
  const out: Classified = { diverged: [], missing: [], matching: [] };
  const entries = [...fresh.files].toSorted(([a], [b]) => (a < b ? -1 : 1));
  for (const [file, incoming] of entries) {
    // oxlint-disable-next-line no-await-in-loop -- reading in order keeps the plan deterministic
    const disk = await read(file);
    if (isStructured(file) && disk !== undefined) continue;
    let verdict = judge(file, disk, incoming, project.files?.[file], options.anySkipped);
    // oxlint-disable-next-line no-await-in-loop -- only asked for a file that would be replaced
    if (verdict === 'replace' && (await options.isSymlink?.(file))) verdict = 'symlink';
    if (verdict === 'missing') out.missing.push(file);
    else if (verdict === 'matching') out.matching.push(file);
    else if (verdict === 'create') {
      // oxlint-disable-next-line no-await-in-loop -- builder edits are ordered
      await builder.create(file, incoming, fresh.tracked.has(file));
    } else if (verdict === 'replace') {
      // oxlint-disable-next-line no-await-in-loop -- builder edits are ordered
      await builder.replace(file, incoming);
    } else if (verdict !== 'leave') {
      out.diverged.push(diverge(file, verdict, disk ?? '', incoming));
    }
  }
  return out;
}

function diverge(
  file: string,
  reason: DivergeReason,
  yours: string,
  incoming: string,
): DivergedUpgrade {
  return { path: file, reason, yours, incoming, diff: unifiedDiff(file, yours, incoming) };
}

/** Adds the catalog entries and `allowBuilds` rules the new template has and the workspace file lacks. */
async function editWorkspace(
  fresh: Replay,
  read: ReadFile,
  builder: PlanBuilder,
  local: boolean,
): Promise<void> {
  const incoming = fresh.files.get(WORKSPACE_FILE);
  const disk = await read(WORKSPACE_FILE);
  if (incoming === undefined || disk === undefined) return;
  const wanted = asRecord(parseDocument(incoming).toJSON());
  const doc = parseDocument(disk);
  let changed = false;
  for (const section of ['catalog', 'allowBuilds']) {
    const have = doc.get(section);
    for (const [name, value] of Object.entries(asRecord(wanted[section]))) {
      if ((isMap(have) && have.has(name)) || (local && isOwn(name))) continue;
      doc.setIn([section, name], value);
      changed = true;
    }
  }
  if (changed) await builder.patch(WORKSPACE_FILE, () => doc.toString());
}

/** Adds the tasks the new template has and turbo.json lacks. */
async function editTurbo(fresh: Replay, read: ReadFile, builder: PlanBuilder): Promise<void> {
  const incoming = fresh.files.get(TURBO_FILE);
  if (incoming === undefined || (await read(TURBO_FILE)) === undefined) return;
  const wanted = asRecord(asRecord(parseJsonObject(TURBO_FILE, incoming)).tasks);
  await builder.patch(TURBO_FILE, (source) =>
    editJsonObject(TURBO_FILE, source, (turbo) => {
      const tasks = asRecord(turbo.tasks);
      const missing = Object.entries(wanted).filter(([name]) => !(name in tasks));
      if (missing.length === 0) return false;
      turbo.tasks = { ...tasks, ...Object.fromEntries(missing) };
      return true;
    }),
  );
}

/** Every `[name, range]` pair, once per section that lists it. */
function listed(pkg: Record<string, unknown>): [string, string][] {
  return DEPENDENCY_SECTIONS.flatMap((section) =>
    Object.entries(asRecord(pkg[section])).flatMap(([name, range]): [string, string][] =>
      typeof range === 'string' ? [[name, range]] : [],
    ),
  );
}

function declared(pkg: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, range] of Object.entries(asRecord(pkg[section]))) {
      if (typeof range === 'string') out.set(name, range);
    }
  }
  return out;
}

/** Adds the dependencies and scripts the new template has and this package.json lacks. */
async function addMissing(
  file: string,
  pkg: Record<string, unknown>,
  wanted: Record<string, unknown>,
  local: boolean,
  builder: PlanBuilder,
): Promise<void> {
  const have = declared(pkg);
  for (const [section, dev] of [
    ['dependencies', false],
    ['devDependencies', true],
  ] as const) {
    for (const [name, range] of Object.entries(asRecord(wanted[section]))) {
      if (have.has(name) || typeof range !== 'string' || (local && isOwn(name))) continue;
      // oxlint-disable-next-line no-await-in-loop -- each edit patches the same file
      await builder.addDependency(file, name, range, dev);
    }
  }
  const scripts = asRecord(pkg.scripts);
  for (const [name, command] of Object.entries(asRecord(wanted.scripts))) {
    if (name in scripts || typeof command !== 'string') continue;
    // oxlint-disable-next-line no-await-in-loop -- each edit patches the same file
    await builder.addScript(file, name, command);
  }
}

/** For one package.json: new dependencies, new scripts, and `@mfeflow/*` moved to `^<toVersion>`. Nothing else. */
async function editPackage(
  file: string,
  fresh: Replay,
  toVersion: string,
  local: boolean,
  builder: PlanBuilder,
): Promise<void> {
  const source = await builder.content(file);
  if (source === undefined) return;
  const incoming = fresh.files.get(file);
  if (incoming !== undefined) {
    await addMissing(
      file,
      parseJsonObject(file, source),
      parseJsonObject(file, incoming),
      local,
      builder,
    );
  }
  if (local) return;
  const target = `^${toVersion}`;
  const current = parseJsonObject(file, (await builder.content(file)) ?? source);
  for (const [name, range] of listed(current)) {
    if (!isOwn(name) || range === target || KEEP_RANGE.test(range)) continue;
    // oxlint-disable-next-line no-await-in-loop -- each edit patches the same file
    await builder.setRange(file, name, target);
  }
}

interface PendingMigration {
  feature: LoadedFeature;
  to: string;
  from: string;
  module: string;
}

function pendingMigrations(
  features: readonly LoadedFeature[],
  project: MfeflowProject,
): PendingMigration[] {
  const pending: PendingMigration[] = [];
  for (const feature of features) {
    const { name, version, migrations } = feature.manifest;
    const recorded = project.features[name]?.version;
    if (recorded === undefined || semver.valid(recorded) === null) continue;
    if (feature.trust !== 'first-party') continue;
    for (const m of migrations ?? []) {
      if (semver.valid(m.to) === null || semver.valid(version) === null) continue;
      if (semver.lt(recorded, m.to) && semver.lte(m.to, version)) pending.push({ feature, ...m });
    }
  }
  return pending.toSorted((a, b) => semver.compare(a.to, b.to));
}

async function importDefault(file: string): Promise<unknown> {
  return import(pathToFileURL(file).href);
}

async function loadMigration(
  step: PendingMigration,
  importModule: (file: string) => Promise<unknown>,
): Promise<Migration> {
  const name = step.feature.manifest.name;
  const label = `${name} ${step.from} to ${step.to} (${step.module})`;
  const { dir } = step.feature;
  if (dir === undefined || !isSafeRelativePath(step.module)) {
    throw new MfeflowError('E603', `${label}: cannot find ${step.module}`);
  }
  let loaded: unknown;
  try {
    loaded = await importModule(path.join(dir, ...step.module.split('/')));
  } catch (error) {
    throw new MfeflowError('E603', `${label}: ${messageOf(error)}`, { cause: error });
  }
  const exported = asRecord(loaded);
  const fn = typeof exported.default === 'function' ? exported.default : exported.migrate;
  if (typeof fn !== 'function') {
    throw new MfeflowError('E603', `${label}: ${step.module} exports no migration function`);
  }
  return async (builder, project) => {
    try {
      await Reflect.apply(fn, undefined, [builder, project]);
    } catch (error) {
      throw new MfeflowError('E603', `${label}: ${messageOf(error)}`, { cause: error });
    }
  };
}

async function runMigrations(
  project: MfeflowProject,
  input: UpgradeInput,
  builder: PlanBuilder,
): Promise<void> {
  const importModule = input.importModule ?? importDefault;
  for (const step of pendingMigrations(input.features, project)) {
    // oxlint-disable-next-line no-await-in-loop -- migrations run in version order
    const migrate = await loadMigration(step, importModule);
    // oxlint-disable-next-line no-await-in-loop -- migrations run in version order
    await migrate(builder.scoped('first-party'), project);
  }
}

/** Tracked files that are still on disk but that the new version no longer generates. */
async function findRemoved(
  project: MfeflowProject,
  fresh: Replay,
  read: ReadFile,
): Promise<string[]> {
  const removed: string[] = [];
  for (const file of Object.keys(project.files ?? {}).toSorted(byCodePoint)) {
    if (fresh.files.has(file) || USER_DATA.test(file) || ENV_KEY_FILES.test(file)) continue;
    // oxlint-disable-next-line no-await-in-loop -- reading in order keeps the report deterministic
    if ((await read(file)) !== undefined) removed.push(file);
  }
  return removed;
}

/**
 * Works out what moving a project to `toVersion` changes, without touching the disk.
 *
 * It replays the skeleton and every recorded feature, with its recorded options, into memory and
 * compares the result with the project. A tracked file you have not edited is replaced; one you
 * have edited is returned in `diverged` with a diff and left alone; a new file is created; a file
 * the new version no longer makes is listed in `removed` and never deleted. `package.json`,
 * `pnpm-workspace.yaml` and `turbo.json` only get structured edits. Feature migrations whose
 * version the upgrade crosses then run, in order, on the same plan.
 */
export async function planUpgrade(
  project: MfeflowProject,
  input: UpgradeInput,
): Promise<UpgradePlan> {
  if (semver.valid(input.toVersion) === null) {
    throw new MfeflowError('E601', `"${input.toVersion}" is not a version`);
  }
  const baseline = await detectBaseline(project, input.read);
  if (semver.valid(baseline.version) === null || semver.gt(baseline.version, input.toVersion)) {
    throw new MfeflowError(
      'E602',
      `project is at ${baseline.version}, target is ${input.toVersion}`,
    );
  }
  const fresh = await replay(project, input);
  const builder = new PlanBuilder(input.read, {});
  await builder.captureProject();

  const compared = await compareFiles(project, fresh, input.read, builder, {
    anySkipped: (input.skipped ?? []).length > 0,
    ...(input.isSymlink ? { isSymlink: input.isSymlink } : {}),
  });
  await editWorkspace(fresh, input.read, builder, project.local !== undefined);
  await editTurbo(fresh, input.read, builder);
  const local = project.local !== undefined;
  const packageFiles = new Set(
    [
      ...fresh.files.keys(),
      ...Object.values(project.apps).map(
        (a) => (a.path === '' ? '' : `${a.path}/`) + 'package.json',
      ),
      'package.json',
    ].filter(isPackageFile),
  );
  for (const file of [...packageFiles].toSorted(byCodePoint)) {
    // oxlint-disable-next-line no-await-in-loop -- reading in order keeps the plan deterministic
    if (!(await input.read(file))) continue;
    // oxlint-disable-next-line no-await-in-loop -- ordered edits keep the plan deterministic
    await editPackage(file, fresh, input.toVersion, local, builder);
  }

  await runMigrations(project, input, builder);
  const skipped = input.skipped ?? [];
  // A file a migration deletes or moves is not reported as left behind.
  const planned: ReadFile = (file) => builder.content(file);
  const removed = skipped.length === 0 ? await findRemoved(project, fresh, planned) : [];

  const built = builder.build();
  const plan: Plan = {
    ...built,
    changes: built.changes.map(keepLineEndings),
    features: fresh.features,
    warnings: [
      ...fresh.warnings,
      ...built.warnings,
      ...skipped.map(
        ({ name, reason }) =>
          `${name} was not replayed (${reason}); its files were left as they are`,
      ),
    ],
  };
  const files = { ...project.files };
  for (const file of compared.matching) files[file] = hashContent(fresh.files.get(file) ?? '');
  const next: MfeflowProject = { ...project, cli: input.toVersion };
  if (Object.keys(files).length > 0) next.files = files;
  return {
    from: baseline.version,
    fromSource: baseline.source,
    to: input.toVersion,
    plan,
    project: next,
    diverged: compared.diverged,
    removed,
    missing: compared.missing,
  };
}
