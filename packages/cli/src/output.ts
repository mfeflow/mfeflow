import type { Issue } from '@mfeflow/contracts';
import { type Plan } from '@mfeflow/core';
import { EXIT, type ErrorReport } from './exit';
import type { Finding } from './findings';
import { exitForFindings, type CheckReport, type Summary } from './report';

export interface PlanReport {
  features: { name: string; version: string }[];
  changes: { path: string; action: 'create' | 'patch' | 'delete' }[];
  dependencies: { file: string; name: string; range: string; dev: boolean }[];
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

export interface FeatureInfo {
  name: string;
  version: string;
  description: string;
  always: boolean;
  default: boolean;
  installed: boolean;
}

export interface FeaturesResult {
  ok: true;
  command: 'features';
  search: string | null;
  features: FeatureInfo[];
}

/** What `doctor`, `validate` and `check-compat` print with `--json`. `ok` is false when any finding is an error. */
export interface ReportResult {
  ok: boolean;
  command: 'doctor' | 'validate' | 'check-compat';
  root: string;
  summary: Summary;
  checks: CheckReport[];
  findings: Finding[];
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
  /** mfe.json budgets.initialJsKb, or null. */
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

export interface FailureResult {
  ok: false;
  error: ErrorReport;
  exitCode: number;
}

export type CliResult =
  InitResult | AddResult | FeaturesResult | ReportResult | BudgetResult | DevResult | FailureResult;

/** The plan as plain data for `--json`, without file contents. Features are listed once. */
export function planReport(plan: Plan): PlanReport {
  const features = new Map(plan.features.map((f) => [f.name, f.version]));
  return {
    features: [...features].map(([name, version]) => ({ name, version })),
    changes: plan.changes.map((c) => ({ path: c.path, action: c.action })),
    dependencies: plan.dependencies.map((d) => ({ ...d })),
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
    case 'features':
      if (value.search !== null && typeof value.search !== 'string') {
        c.add('search', 'must be text or null');
      }
      c.objects(value, 'features', '', (f, p) => {
        for (const key of ['name', 'version', 'description']) c.string(f, key, p);
        for (const key of ['always', 'default', 'installed']) c.boolean(f, key, p);
      });
      break;
    case 'doctor':
    case 'validate':
    case 'check-compat':
      checkReport(c, value);
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
    default:
      c.add(
        'command',
        'must be init, add, features, doctor, validate, check-compat, budget or dev',
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
