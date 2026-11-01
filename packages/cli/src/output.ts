import type { Issue, RegistryIndex } from '@mfeflow/contracts';
import { type Plan } from '@mfeflow/core';
import { EXIT, type ErrorReport } from './exit';
import type { Finding } from './findings';
import { exitForFindings, type CheckReport, type Summary } from './report';

export interface PlanReport {
  features: { name: string; version: string }[];
  changes: { path: string; action: 'create' | 'patch' | 'delete' }[];
  /** `thirdParty` (only present when true): a feature from a registry asked for it. */
  dependencies: { file: string; name: string; range: string; dev: boolean; thirdParty?: boolean }[];
  scripts: { file: string; name: string; command: string }[];
  warnings: string[];
}

export interface AppReport {
  name: string;
  kind: 'shell' | 'remote';
  path: string;
  port: number | null;
}

interface WriteReport {
  ok: true;
  dryRun: boolean;
  root: string;
  plan: PlanReport;
  /** Files written, in plan order. Empty for a dry run. */
  written: string[];
  installed: boolean;
  /** Unified diff of every change. Only present for a dry run. */
  diff?: string;
}

export interface InitResult extends WriteReport {
  command: 'init';
  scope: string;
  apps: AppReport[];
  next: string[];
}

export interface AddResult extends WriteReport {
  command: 'add';
  kind: 'remote' | 'shell' | 'feature' | 'env-key';
  /** What was added: an app name, or feature names. */
  added: string[];
  /** Features that were already part of the project. */
  skipped: string[];
}

export interface UpgradeFileReport {
  path: string;
  reason: 'edited' | 'untracked' | 'edited-by-cli' | 'skipped-feature' | 'symlink';
  /** `accept`: written with the new version. `keep`: left, and remembered. `undecided`: left, and the run fails without a person to ask. */
  decision: 'accept' | 'keep' | 'undecided';
  /** Keys in your file that the new version lacks; accepting drops them. */
  lostKeys: string[];
  /** Unified diff from your file to the new version. */
  diff: string;
}

export interface UpgradeResult extends WriteReport {
  command: 'upgrade';
  from: string;
  /** Where `from` was read: the `cli` field of mfeflow.json, or the shell's `@mfeflow/runtime` range. */
  fromSource: 'mfeflow.json' | 'package.json';
  to: string;
  /** Nothing to write: the project already matches this version. */
  upToDate: boolean;
  /** Generated files you had not changed, now at the new version. */
  replaced: string[];
  created: string[];
  /** package.json, pnpm-workspace.yaml and turbo.json, edited in place. */
  edited: string[];
  diverged: UpgradeFileReport[];
  /** Generated files you deleted. Not brought back. */
  missing: string[];
  /** Files the new version no longer generates. Left in place. */
  removed: string[];
  migrations: { feature: string; from: string; to: string }[];
}

export interface FeatureInfo {
  /** `mfeflow` for the features that ship with the CLI, otherwise the registry's namespace, like `@test`. */
  source: string;
  /** What you pass to `mfeflow add`: `lint-oxlint`, or `@test/hello` for a registry's. */
  name: string;
  version: string;
  description: string;
  always: boolean;
  default: boolean;
  installed: boolean;
}

export interface RegistryStatus {
  namespace: string;
  /** The index.json asked for, with token-like query values hidden. */
  index: string;
  /** False: the user has not trusted this registry yet, so nothing was requested from it. */
  trusted: boolean;
  /** How many items it lists. */
  items: number;
  /** Why it could not be read; the other registries are listed regardless. */
  error: ErrorReport | null;
}

export interface FeaturesResult {
  ok: true;
  command: 'features';
  search: string | null;
  features: FeatureInfo[];
  registries: RegistryStatus[];
}

export interface RegistryEntryInfo {
  namespace: string;
  /** The URL template from mfeflow.json, with token-like query values hidden. */
  url: string;
  /** Where its index.json is. */
  index: string;
  /** Whether the user has trusted this namespace at this URL. */
  trusted: boolean;
}

export interface RegistryResult {
  ok: true;
  command: 'registry';
  action: 'add' | 'remove' | 'list' | 'build' | 'trust' | 'untrust';
  dryRun: boolean;
  /** The project folder; null for `build`, which needs none. */
  root: string | null;
  /** Whether mfeflow.json changed (or would have, for a dry run). */
  changed: boolean;
  /** The registries of the project after the action. */
  registries: RegistryEntryInfo[];
  build: {
    namespace: string;
    out: string;
    features: { name: string; version: string }[];
    /** Relative to `out`. */
    files: string[];
  } | null;
}

/** What `doctor`, `validate` and `check-compat` print with `--json`. `ok` is false when any finding is an error. */
export interface ReportResult {
  ok: boolean;
  command: 'doctor' | 'validate' | 'check-compat';
  root: string;
  summary: Summary;
  checks: CheckReport[];
  findings: Finding[];
  /** `check-compat --against`: where the shell's versions came from. */
  against?: string;
}

export interface ShellBudget {
  name: string;
  /** Gzip KB of the scripts index.html loads. */
  initialKb: number;
  scripts: number;
  /** Your pages built as one app (budget.baselineKb), or null when not set. */
  baselineKb: number | null;
  /** baselineKb plus what the shell may add; null without a baseline. */
  budgetKb: number | null;
  /** Null when there is nothing to compare with. */
  pass: boolean | null;
}

export interface RouteBudget {
  route: string;
  expose: string | null;
  /** Entry plus the expose's synchronous JS, gzip KB. */
  kb: number;
  /** mfeflow.app.json budgets.initialJsKb, or null. */
  budgetKb: number | null;
  pass: boolean | null;
}

export interface RemoteBudget {
  name: string;
  entryKb: number;
  /** What a remote may add (cost model, 10 KB). */
  budgetKb: number;
  pass: boolean;
  routes: RouteBudget[];
}

export interface BudgetResult {
  ok: boolean;
  command: 'budget';
  root: string;
  model: { lcpDeltaMs: number; shellKb: number; remoteKb: number };
  shells: ShellBudget[];
  remotes: RemoteBudget[];
  findings: Finding[];
}

export interface DevApp {
  name: string;
  kind: 'shell' | 'remote';
  port: number | null;
  url: string | null;
  command: string;
  /** `overridden`: a server you run yourself, given with --remote. */
  status: 'started' | 'overridden';
}

export interface DevResult {
  ok: boolean;
  command: 'dev';
  root: string;
  /** The generated dev registry the shell reads. */
  registry: string;
  apps: DevApp[];
  overrides: Record<string, string>;
  dryRun: boolean;
  /** Stopped with Ctrl+C or a termination signal. */
  interrupted: boolean;
}

export interface PlannedUpload {
  key: string;
  bytes: number;
  contentType: string;
  cacheControl: string;
  /** `create-only`: refuses to overwrite. `if-match`: only if the index is the one that was read. */
  guard: 'create-only' | 'if-match' | 'none';
}

/** What `deploy`, `promote` and `rollback` print with `--json`. `ok` is false when a gate failed. */
export interface DeployResult {
  ok: boolean;
  command: 'deploy' | 'promote' | 'rollback';
  dryRun: boolean;
  root: string;
  env: string;
  /** The env a promote copied from; null otherwise. */
  fromEnv: string | null;
  /** The host as a person wrote it, never an endpoint or a credential. */
  host: string;
  remote: string;
  version: string;
  /** The version the env served before; null when the remote was not deployed there. */
  servedBefore: string | null;
  /** The index now points at `version` (false for a dry run, `--no-publish`, a failed gate, or when it already did). */
  published: boolean;
  previous: string | null;
  rolledBackFrom: string | null;
  /** Everything the run uploads, in order, the index last. */
  uploads: PlannedUpload[];
  uploaded: string[];
  skipped: string[];
  /** The registry/envs file written to match the host; null when none was. */
  localEntry: string | null;
  /** The index the run would write. Only for a dry run. */
  index?: RegistryIndex;
  warnings: string[];
  findings: Finding[];
}

export interface StatusRemote {
  name: string;
  version: string;
  previous: string | null;
  history: string[];
  rolledBackFrom: string | null;
  /** The version in `registry/envs/<env>/<name>.json`; null when there is no such file. */
  local: string | null;
  /** Versions on the host newer than `version` that no environment points at; null when the host cannot list. */
  unreferenced: string[] | null;
  drift: string[];
}

export interface StatusEnv {
  env: string;
  /** The host has an index for this env. */
  published: boolean;
  /** When that index was written. The index records no per-remote time. */
  generatedAt: string | null;
  remotes: StatusRemote[];
}

export interface StatusResult {
  ok: boolean;
  command: 'status';
  root: string;
  host: string;
  envs: StatusEnv[];
  findings: Finding[];
}

export interface FailureResult {
  ok: false;
  error: ErrorReport;
  exitCode: number;
}

export type CliResult =
  | InitResult
  | AddResult
  | UpgradeResult
  | FeaturesResult
  | RegistryResult
  | ReportResult
  | BudgetResult
  | DevResult
  | DeployResult
  | StatusResult
  | FailureResult;

/** The plan as plain data for `--json`, without file contents. Features are listed once. */
export function planReport(plan: Plan): PlanReport {
  const features = new Map(plan.features.map((f) => [f.name, f.version]));
  return {
    features: [...features].map(([name, version]) => ({ name, version })),
    changes: plan.changes.map((c) => ({ path: c.path, action: c.action })),
    dependencies: plan.dependencies.map((d) => ({
      file: d.file,
      name: d.name,
      range: d.range,
      dev: d.dev,
      ...(d.thirdParty === true ? { thirdParty: true } : {}),
    })),
    scripts: plan.scripts.map((s) => ({ file: s.file, name: s.name, command: s.command })),
    warnings: [...plan.warnings],
  };
}

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

class Check {
  readonly issues: Issue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  string(obj: Obj, key: string, at: string): void {
    if (typeof obj[key] !== 'string') this.add(`${at}${key}`, 'must be text');
  }

  boolean(obj: Obj, key: string, at: string): void {
    if (typeof obj[key] !== 'boolean') this.add(`${at}${key}`, 'must be true or false');
  }

  list(obj: Obj, key: string, at: string, each: (item: unknown, path: string) => void): void {
    const value = obj[key];
    if (!Array.isArray(value)) {
      this.add(`${at}${key}`, 'must be a list');
      return;
    }
    value.forEach((item: unknown, i) => {
      each(item, `${at}${key}[${String(i)}]`);
    });
  }

  texts(obj: Obj, key: string, at: string): void {
    this.list(obj, key, at, (item, path) => {
      if (typeof item !== 'string') this.add(path, 'must be text');
    });
  }

  objects(obj: Obj, key: string, at: string, check: (item: Obj, path: string) => void): void {
    this.list(obj, key, at, (item, path) => {
      if (isObj(item)) check(item, `${path}.`);
      else this.add(path, 'must be an object');
    });
  }
}

function checkPlan(c: Check, plan: unknown): void {
  if (!isObj(plan)) {
    c.add('plan', 'must be an object');
    return;
  }
  const at = 'plan.';
  c.objects(plan, 'features', at, (f, p) => {
    c.string(f, 'name', p);
    c.string(f, 'version', p);
  });
  c.objects(plan, 'changes', at, (f, p) => {
    c.string(f, 'path', p);
    if (!['create', 'patch', 'delete'].includes(String(f.action))) {
      c.add(`${p}action`, 'must be create, patch or delete');
    }
  });
  c.objects(plan, 'dependencies', at, (d, p) => {
    for (const key of ['file', 'name', 'range']) c.string(d, key, p);
    c.boolean(d, 'dev', p);
    if (d.thirdParty !== undefined) c.boolean(d, 'thirdParty', p);
  });
  c.objects(plan, 'scripts', at, (s, p) => {
    for (const key of ['file', 'name', 'command']) c.string(s, key, p);
  });
  c.texts(plan, 'warnings', at);
}

function checkWrite(c: Check, value: Obj): void {
  c.boolean(value, 'dryRun', '');
  c.string(value, 'root', '');
  checkPlan(c, value.plan);
  c.texts(value, 'written', '');
  c.boolean(value, 'installed', '');
  if (value.diff !== undefined && typeof value.diff !== 'string') c.add('diff', 'must be text');
  if (value.dryRun === true && typeof value.diff !== 'string') {
    c.add('diff', 'is required for a dry run');
  }
  if (value.dryRun === true && Array.isArray(value.written) && value.written.length > 0) {
    c.add('written', 'must be empty for a dry run');
  }
}

function checkReport(c: Check, value: Obj): void {
  c.string(value, 'root', '');
  const summary = value.summary;
  if (!isObj(summary)) c.add('summary', 'must be an object');
  else
    for (const key of ['errors', 'warnings', 'skipped', 'fixed']) {
      if (typeof summary[key] !== 'number') c.add(`summary.${key}`, 'must be a number');
    }
  c.objects(value, 'checks', '', (check, p) => {
    for (const key of ['id', 'title']) c.string(check, key, p);
    if (!['pass', 'warn', 'fail', 'skipped'].includes(String(check.status))) {
      c.add(`${p}status`, 'must be pass, warn, fail or skipped');
    }
    if (typeof check.findings !== 'number') c.add(`${p}findings`, 'must be a number');
  });
  c.objects(value, 'findings', '', (f, p) => {
    for (const key of ['code', 'check', 'message', 'fix', 'docs']) c.string(f, key, p);
    if (f.severity !== 'error' && f.severity !== 'warning')
      c.add(`${p}severity`, 'must be error or warning');
    c.boolean(f, 'fixable', p);
  });
  if (value.ok !== (isObj(summary) && summary.errors === 0))
    c.add('ok', 'must be true exactly when there are no errors');
}

function checkBudget(c: Check, value: Obj): void {
  c.string(value, 'root', '');
  const model = value.model;
  if (!isObj(model)) c.add('model', 'must be an object');
  else
    for (const key of ['lcpDeltaMs', 'shellKb', 'remoteKb']) {
      if (typeof model[key] !== 'number') c.add(`model.${key}`, 'must be a number');
    }
  c.objects(value, 'shells', '', (s, p) => {
    c.string(s, 'name', p);
    for (const key of ['initialKb', 'scripts']) {
      if (typeof s[key] !== 'number') c.add(`${p}${key}`, 'must be a number');
    }
  });
  c.objects(value, 'remotes', '', (r, p) => {
    c.string(r, 'name', p);
    c.boolean(r, 'pass', p);
    for (const key of ['entryKb', 'budgetKb']) {
      if (typeof r[key] !== 'number') c.add(`${p}${key}`, 'must be a number');
    }
    c.objects(r, 'routes', p, (route, q) => {
      c.string(route, 'route', q);
      if (typeof route.kb !== 'number') c.add(`${q}kb`, 'must be a number');
    });
  });
  c.objects(value, 'findings', '', (f, p) => {
    for (const key of ['code', 'message', 'fix', 'docs']) c.string(f, key, p);
  });
}

function checkFindings(c: Check, value: Obj): void {
  c.objects(value, 'findings', '', (f, p) => {
    for (const key of ['code', 'message', 'fix', 'docs']) c.string(f, key, p);
  });
}

function checkDeploy(c: Check, value: Obj): void {
  for (const key of ['root', 'env', 'host', 'remote', 'version']) c.string(value, key, '');
  for (const key of ['dryRun', 'published']) c.boolean(value, key, '');
  for (const key of ['fromEnv', 'servedBefore', 'previous', 'rolledBackFrom', 'localEntry']) {
    if (value[key] !== null && typeof value[key] !== 'string') c.add(key, 'must be text or null');
  }
  c.texts(value, 'uploaded', '');
  c.texts(value, 'skipped', '');
  c.texts(value, 'warnings', '');
  c.objects(value, 'uploads', '', (u, p) => {
    for (const key of ['key', 'contentType', 'cacheControl']) c.string(u, key, p);
    if (typeof u.bytes !== 'number') c.add(`${p}bytes`, 'must be a number');
    if (!['create-only', 'if-match', 'none'].includes(String(u.guard)))
      c.add(`${p}guard`, 'must be create-only, if-match or none');
  });
  if (value.dryRun === true && Array.isArray(value.uploaded) && value.uploaded.length > 0)
    c.add('uploaded', 'must be empty for a dry run');
  if (value.index !== undefined && !isObj(value.index)) c.add('index', 'must be an object');
  checkFindings(c, value);
}

function checkStatus(c: Check, value: Obj): void {
  c.string(value, 'root', '');
  c.string(value, 'host', '');
  c.objects(value, 'envs', '', (e, p) => {
    c.string(e, 'env', p);
    c.boolean(e, 'published', p);
    if (e.generatedAt !== null && typeof e.generatedAt !== 'string')
      c.add(`${p}generatedAt`, 'must be text or null');
    c.objects(e, 'remotes', p, (r, q) => {
      c.string(r, 'name', q);
      c.string(r, 'version', q);
      c.texts(r, 'history', q);
      c.texts(r, 'drift', q);
      if (r.unreferenced !== null) c.texts(r, 'unreferenced', q);
    });
  });
  checkFindings(c, value);
}

/** Checks a document the CLI printed with `--json`. Returns the problems; empty means valid. */
export function validateResult(value: unknown): Issue[] {
  const c = new Check();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  if (value.ok === false && value.command === undefined) {
    if (!isObj(value.error)) c.add('error', 'must be an object');
    else for (const key of ['code', 'message', 'fix', 'docs']) c.string(value.error, key, 'error.');
    if (typeof value.exitCode !== 'number') c.add('exitCode', 'must be a number');
    return c.issues;
  }
  if (typeof value.ok !== 'boolean') c.add('ok', 'must be true or false');
  switch (value.command) {
    case 'init':
      checkWrite(c, value);
      c.string(value, 'scope', '');
      c.texts(value, 'next', '');
      c.objects(value, 'apps', '', (app, p) => {
        c.string(app, 'name', p);
        c.string(app, 'path', p);
        if (app.kind !== 'shell' && app.kind !== 'remote')
          c.add(`${p}kind`, 'must be shell or remote');
        if (app.port !== null && typeof app.port !== 'number')
          c.add(`${p}port`, 'must be a number or null');
      });
      break;
    case 'add':
      checkWrite(c, value);
      if (!['remote', 'shell', 'feature', 'env-key'].includes(String(value.kind))) {
        c.add('kind', 'must be remote, shell, feature or env-key');
      }
      c.texts(value, 'added', '');
      c.texts(value, 'skipped', '');
      break;
    case 'upgrade':
      checkWrite(c, value);
      for (const key of ['from', 'to']) c.string(value, key, '');
      if (value.fromSource !== 'mfeflow.json' && value.fromSource !== 'package.json') {
        c.add('fromSource', 'must be mfeflow.json or package.json');
      }
      c.boolean(value, 'upToDate', '');
      for (const key of ['replaced', 'created', 'edited', 'missing', 'removed']) {
        c.texts(value, key, '');
      }
      c.objects(value, 'diverged', '', (f, p) => {
        for (const key of ['path', 'reason', 'diff']) c.string(f, key, p);
        if (!['accept', 'keep', 'undecided'].includes(String(f.decision))) {
          c.add(`${p}decision`, 'must be accept, keep or undecided');
        }
        c.texts(f, 'lostKeys', p);
      });
      c.objects(value, 'migrations', '', (m, p) => {
        for (const key of ['feature', 'from', 'to']) c.string(m, key, p);
      });
      break;
    case 'features':
      if (value.search !== null && typeof value.search !== 'string') {
        c.add('search', 'must be text or null');
      }
      c.objects(value, 'features', '', (f, p) => {
        for (const key of ['source', 'name', 'version', 'description']) c.string(f, key, p);
        for (const key of ['always', 'default', 'installed']) c.boolean(f, key, p);
      });
      c.objects(value, 'registries', '', (r, p) => {
        for (const key of ['namespace', 'index']) c.string(r, key, p);
        c.boolean(r, 'trusted', p);
        if (typeof r.items !== 'number') c.add(`${p}items`, 'must be a number');
        if (r.error !== null) {
          if (!isObj(r.error)) c.add(`${p}error`, 'must be an object or null');
          else
            for (const key of ['code', 'message', 'fix', 'docs'])
              c.string(r.error, key, `${p}error.`);
        }
      });
      break;
    case 'registry':
      if (!['add', 'remove', 'list', 'build', 'trust', 'untrust'].includes(String(value.action))) {
        c.add('action', 'must be add, remove, list, build, trust or untrust');
      }
      c.boolean(value, 'dryRun', '');
      c.boolean(value, 'changed', '');
      if (value.root !== null) c.string(value, 'root', '');
      c.objects(value, 'registries', '', (r, p) => {
        for (const key of ['namespace', 'url', 'index']) c.string(r, key, p);
        c.boolean(r, 'trusted', p);
      });
      if (value.build !== null) {
        if (!isObj(value.build)) c.add('build', 'must be an object or null');
        else {
          for (const key of ['namespace', 'out']) c.string(value.build, key, 'build.');
          c.texts(value.build, 'files', 'build.');
          c.objects(value.build, 'features', 'build.', (f, p) => {
            for (const key of ['name', 'version']) c.string(f, key, p);
          });
        }
      }
      break;
    case 'doctor':
    case 'validate':
    case 'check-compat':
      checkReport(c, value);
      if (value.against !== undefined) c.string(value, 'against', '');
      break;
    case 'budget':
      checkBudget(c, value);
      break;
    case 'dev':
      c.string(value, 'root', '');
      c.string(value, 'registry', '');
      c.boolean(value, 'dryRun', '');
      c.boolean(value, 'interrupted', '');
      c.objects(value, 'apps', '', (app, p) => {
        c.string(app, 'name', p);
        c.string(app, 'command', p);
        if (app.status !== 'started' && app.status !== 'overridden') {
          c.add(`${p}status`, 'must be started or overridden');
        }
      });
      if (!isObj(value.overrides)) c.add('overrides', 'must be an object');
      break;
    case 'deploy':
    case 'promote':
    case 'rollback':
      checkDeploy(c, value);
      break;
    case 'status':
      checkStatus(c, value);
      break;
    default:
      c.add(
        'command',
        'must be init, add, upgrade, features, registry, doctor, validate, check-compat, budget, dev, deploy, promote, rollback or status',
      );
  }
  return c.issues;
}

/** Exit code for a result that printed normally: findings decide for the checks, Ctrl+C is 130. */
export function exitOf(result: CliResult): number {
  if ('findings' in result) return exitForFindings(result.findings);
  if (result.ok && 'interrupted' in result && result.interrupted) return EXIT.cancelled;
  return result.ok ? EXIT.ok : EXIT.unexpected;
}
