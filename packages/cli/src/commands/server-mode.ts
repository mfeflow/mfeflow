import path from 'node:path';
import type { RegistryIndex, RegistryIndexRemote } from '@mfeflow/contracts';
import { findProjectRoot, MfeflowError, type ErrorCode } from '@mfeflow/core';
import { applyPlan, artifactPrefix, planDeploy } from '@mfeflow/registry/static';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, splitList, text, type Globals } from '../args';
import { Cancelled } from '../exit';
import { finding, type Finding } from '../findings';
import { inspectProject } from '../inspect';
import type {
  DeployResult,
  KillCommandResult,
  RolloutCommandResult,
  StatusEnv,
  StatusRemote,
  StatusResult,
} from '../output';
import {
  baseUrlFor,
  describeUploads,
  envOf,
  GATE_CODES,
  onHost,
  openSession,
  positionals,
  readBuild,
  readShellManifest,
  remoteApp,
  shellVersions,
} from '../publish';
import type { Runtime } from '../runtime';
import type { ServerClient, ServerFailure } from '../server-client';

export const SERVER_ARGS = {
  'registry-url': {
    type: 'string',
    description:
      'Registry server address (env MFEFLOW_REGISTRY_URL). The token is only read from MFEFLOW_REGISTRY_TOKEN',
    valueHint: 'url',
  },
} as const satisfies ArgsDef;

export const ROLLOUT_ARGS = {
  percent: {
    type: 'string',
    description:
      'Start a percentage rollout at this share of visitors, 1 to 99 (registry server only)',
    valueHint: 'n',
  },
  steps: {
    type: 'string',
    description: 'Later rollout steps, rising, like 50,100 (needs --percent)',
    valueHint: 'a,b,c',
  },
} as const satisfies ArgsDef;

export const ROLLOUT_CMD_ARGS = {
  env: { type: 'string', description: 'Environment the rollout runs in', valueHint: 'env' },
  reason: { type: 'string', description: 'Why, for the audit log (abort only)', valueHint: 'text' },
  ...SERVER_ARGS,
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

export const KILL_ARGS = {
  env: { type: 'string', description: 'Environment to remove the remote from', valueHint: 'env' },
  reason: { type: 'string', description: 'Why, for the audit log', valueHint: 'text' },
  ...SERVER_ARGS,
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

export const RESTORE_ARGS = {
  env: { type: 'string', description: 'Environment to put the remote back in', valueHint: 'env' },
  ...SERVER_ARGS,
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface RolloutPlan {
  percent: number;
  steps: number[];
}

const whole = (raw: string, flag: string): number => {
  if (!/^\d{1,3}$/.test(raw.trim()))
    throw new MfeflowError('E107', `${flag} "${raw}" must be a whole number`);
  return Number(raw);
};

/** `--percent` and `--steps` as the server wants them, or undefined when neither is given. */
export function rolloutOf(args: Record<string, unknown>): RolloutPlan | undefined {
  const rawPercent = text(args, 'percent');
  const rawSteps = text(args, 'steps');
  if (rawPercent === undefined) {
    if (rawSteps !== undefined) throw new MfeflowError('E107', '--steps needs --percent');
    return undefined;
  }
  const percent = whole(rawPercent, '--percent');
  if (percent < 1 || percent > 99)
    throw new MfeflowError('E107', `--percent must be from 1 to 99, not ${String(percent)}`);
  const steps = (splitList(rawSteps) ?? []).map((s) => whole(s, '--steps'));
  let last = percent;
  for (const step of steps) {
    if (step <= last || step > 100)
      throw new MfeflowError(
        'E107',
        `--steps must rise, stay over --percent (${String(percent)}) and end at 100 at most`,
      );
    last = step;
  }
  if (steps.length > 20) throw new MfeflowError('E107', '--steps takes up to 20 steps');
  return { percent, steps };
}

/** A rollout was asked for in static mode, which has no way to split traffic. */
export function refuseRolloutFlags(args: Record<string, unknown>): void {
  if (args.percent !== undefined || args.steps !== undefined)
    throw new MfeflowError(
      'E505',
      '--percent and --steps need the registry server: set MFEFLOW_REGISTRY_URL or pass --registry-url',
    );
}

async function confirmed(rt: Runtime, globals: Globals, message: string): Promise<void> {
  if (globals.dryRun || !globals.canPrompt) return;
  if (!(await rt.prompter.confirm({ message, initialValue: false }))) throw new Cancelled();
}

async function rootOf(globals: Globals): Promise<string> {
  try {
    return await findProjectRoot(globals.cwd);
  } catch {
    return globals.cwd;
  }
}

const gateCode = (code: string): ErrorCode =>
  Object.entries(GATE_CODES).find(([k]) => k === code)?.[1] ?? 'E501';

const gateFindings = (failure: ServerFailure, app: string): Finding[] =>
  (failure.failures ?? []).map((f) =>
    finding('deploy.gates', gateCode(f.code), f.message ?? f.code, { app }),
  );

const nothing = (): Pick<
  DeployResult,
  'uploads' | 'uploaded' | 'skipped' | 'localEntry' | 'warnings' | 'findings'
> => ({ uploads: [], uploaded: [], skipped: [], localEntry: null, warnings: [], findings: [] });

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

interface Moved {
  changed: boolean;
  version: string;
  servedBefore: string | null;
  previous: string | null;
  rolledBackFrom: string | null;
  warnings: string[];
  rollout?: DeployResult['rollout'];
}

function movedOf(body: unknown): Moved {
  const b = isObj(body) ? body : {};
  const r = isObj(b.rollout) ? b.rollout : undefined;
  return {
    changed: b.changed === true,
    version: textOf(b.version) ?? '',
    servedBefore: textOf(b.servedBefore),
    previous: textOf(b.previous),
    rolledBackFrom: textOf(b.rolledBackFrom),
    warnings: listOf(b.warnings),
    ...(r === undefined
      ? {}
      : {
          rollout: {
            id: textOf(r.id) ?? '',
            stable: textOf(r.stable) ?? '',
            candidate: textOf(r.candidate) ?? '',
            percent: numberOf(r.percent),
            steps: Array.isArray(r.steps) ? r.steps.map(numberOf) : [],
          },
        }),
  };
}

interface Facts {
  command: DeployResult['command'];
  root: string;
  globals: Globals;
  client: ServerClient;
  env: string;
  fromEnv?: string;
  remote: string;
  version: string;
}

function deployResult(facts: Facts, extra: Partial<DeployResult>): DeployResult {
  return {
    ok: true,
    command: facts.command,
    dryRun: facts.globals.dryRun,
    root: facts.root,
    env: facts.env,
    fromEnv: facts.fromEnv ?? null,
    host: facts.client.label,
    remote: facts.remote,
    version: facts.version,
    servedBefore: null,
    published: false,
    previous: null,
    rolledBackFrom: null,
    ...nothing(),
    ...extra,
  };
}

function fromMoved(facts: Facts, moved: Moved, extra: Partial<DeployResult> = {}): DeployResult {
  return deployResult(
    { ...facts, version: moved.version },
    {
      servedBefore: moved.servedBefore,
      previous: moved.previous,
      rolledBackFrom: moved.rolledBackFrom,
      published: moved.changed && moved.rollout === undefined,
      warnings: moved.warnings,
      ...(moved.rollout === undefined ? {} : { rollout: moved.rollout }),
      ...extra,
    },
  );
}

const pointer = (index: RegistryIndex | undefined, name: string): RegistryIndexRemote | undefined =>
  index?.remotes.find((r) => r.name === name);

async function deployInner(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  client: ServerClient,
): Promise<DeployResult> {
  assertKnownFlags(raw, defs);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const [name] = positionals(args, 1, 'mfeflow deploy <remote> --env <env>');
  const env = envOf(args);
  const rollout = rolloutOf(args);
  const s = await openSession(rt, args, globals, { hostOptional: true });
  const app = remoteApp(s.view, name);
  const version = text(args, 'version') ?? app.pkg?.version;
  if (version === undefined)
    throw new MfeflowError(
      'E507',
      `${app.name} has no version: pass --version or set one in its package.json`,
    );
  const dist = text(args, 'dist') ?? 'dist';
  const build = await readBuild(path.join(app.dir, dist), `${app.rel}/${dist}`);
  const noPublish = args.publish === false;
  await confirmed(rt, globals, `Deploy ${app.name}@${version} to ${env} on ${client.label}?`);

  const index = await client.run(() => client.index(env));
  const shell = await readShellManifest(s, env, text(args, 'shell-manifest'));
  const base = baseUrlFor(s, index);
  const plan = planDeploy({
    remote: app.mfe.value,
    version,
    manifest: build.manifest,
    files: build.files,
    env,
    baseUrl: base,
    ...(index === undefined ? {} : { currentIndex: index, currentIndexEtag: 'server' }),
    ...(shell.manifest === undefined ? {} : { shellManifest: shell.manifest }),
    workspaceVersions: await shellVersions(s.view, app.mfe.value),
  });
  const artifacts = plan.uploads.filter((u) => u.key !== plan.indexKey);
  const warnings = [...shell.warnings, ...plan.warnings];
  const facts: Facts = {
    command: 'deploy',
    root: s.view.root,
    globals,
    client,
    env,
    remote: app.name,
    version,
  };
  const before = pointer(index, app.name);
  if (plan.failures.length > 0)
    return deployResult(facts, {
      ok: false,
      servedBefore: before?.version ?? null,
      warnings,
      findings: plan.failures.map((f) =>
        finding('deploy.gates', GATE_CODES[f.code], f.message, { app: app.name }),
      ),
    });
  const described = describeUploads({ ...plan, uploads: artifacts });
  if (globals.dryRun)
    return deployResult(facts, {
      servedBefore: before?.version ?? null,
      uploads: described,
      warnings: [
        ...warnings,
        'the server runs its own checks on deploy; a dry run does not call it',
      ],
      index: plan.index,
    });

  let uploaded: string[] = [];
  let skipped: string[] = [];
  if (s.hostless) {
    warnings.push(
      `no host set: the artifacts were not uploaded; the server must already read ${base}/${artifactPrefix(app.name, version)}/`,
    );
  } else {
    const applied = await onHost(s, () => applyPlan(s.host, { ...plan, uploads: artifacts }));
    uploaded = applied.uploaded;
    skipped = applied.skipped;
  }
  const common = { uploads: described, uploaded, skipped };
  if (noPublish)
    return deployResult(facts, {
      servedBefore: before?.version ?? null,
      warnings,
      ...common,
    });

  const body = {
    env,
    remote: app.name,
    version,
    manifestUrl: `${base}/${artifactPrefix(app.name, version)}/mf-manifest.json`,
    owner: app.mfe.value.owner,
    routes: app.mfe.value.routes,
    ...(app.mfe.value.platform === undefined ? {} : { platform: app.mfe.value.platform }),
    ...(app.mfe.value.budgets === undefined ? {} : { budgets: app.mfe.value.budgets }),
    ...(rollout === undefined ? {} : { rollout }),
  };
  return client.run(
    async () => {
      const moved = movedOf(await client.post('/v1/deploy', body));
      return fromMoved(facts, moved, { ...common, warnings: [...warnings, ...moved.warnings] });
    },
    (failure) =>
      deployResult(facts, {
        ok: false,
        servedBefore: before?.version ?? null,
        warnings,
        ...common,
        findings: gateFindings(failure, app.name),
      }),
  );
}

async function promoteInner(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  client: ServerClient,
): Promise<DeployResult> {
  assertKnownFlags(raw, defs);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const [name] = positionals(args, 1, 'mfeflow promote <remote> --from <env> --to <env>');
  if (name === undefined) throw new MfeflowError('E107', 'name the remote to promote');
  const from = envOf(args, 'from');
  const to = envOf(args, 'to');
  if (from === to) throw new MfeflowError('E107', `--from and --to are both "${from}"`);
  const rollout = rolloutOf(args);
  const root = await rootOf(globals);
  const facts: Facts = {
    command: 'promote',
    root,
    globals,
    client,
    env: to,
    fromEnv: from,
    remote: name,
    version: '',
  };
  const source = await client.run(async () => pointer(await client.index(from), name));
  if (source?.version === undefined)
    throw new MfeflowError('E508', `${name} is not deployed to ${from}`);
  const target = await client.run(async () => pointer(await client.index(to), name));
  await confirmed(rt, globals, `Point ${to} at ${name}@${source.version} (now in ${from})?`);
  const withVersion = { ...facts, version: source.version };
  if (globals.dryRun)
    return deployResult(withVersion, {
      servedBefore: target?.version ?? null,
      warnings: ['the server runs its own checks on promote; a dry run does not call it'],
    });
  return client.run(
    async () =>
      fromMoved(
        withVersion,
        movedOf(
          await client.post('/v1/promote', {
            from,
            to,
            remote: name,
            ...(rollout === undefined ? {} : { rollout }),
          }),
        ),
      ),
    (failure) =>
      deployResult(withVersion, {
        ok: false,
        servedBefore: target?.version ?? null,
        findings: gateFindings(failure, withVersion.remote),
      }),
  );
}

function rollbackTarget(
  remote: RegistryIndexRemote | undefined,
  explicit: string | undefined,
  env: string,
  name: string,
): string {
  if (remote?.version === undefined)
    throw new MfeflowError('E508', `${name} is not deployed to ${env}`);
  const known = [...new Set([remote.previous, ...(remote.history ?? [])])].filter(
    (v): v is string => v !== undefined,
  );
  const to = explicit ?? remote.previous;
  if (to === undefined)
    throw new MfeflowError('E508', `${name} in ${env} has no previous version to go back to`);
  if (to === remote.version) throw new MfeflowError('E508', `${env} already serves ${name}@${to}`);
  if (!known.includes(to))
    throw new MfeflowError(
      'E508',
      `${name}@${to} is not in the history of ${env} (${known.length === 0 ? 'empty' : known.join(', ')})`,
    );
  return to;
}

async function rollbackInner(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  client: ServerClient,
): Promise<DeployResult> {
  assertKnownFlags(raw, defs);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const [name] = positionals(args, 1, 'mfeflow rollback <remote> --env <env>');
  if (name === undefined) throw new MfeflowError('E107', 'name the remote to roll back');
  const env = envOf(args);
  const explicit = text(args, 'to');
  const facts: Facts = {
    command: 'rollback',
    root: await rootOf(globals),
    globals,
    client,
    env,
    remote: name,
    version: '',
  };
  if (globals.dryRun) {
    const current = await client.run(async () => pointer(await client.index(env), name));
    const to = rollbackTarget(current, explicit, env, name);
    return deployResult(
      { ...facts, version: to },
      {
        servedBefore: current?.version ?? null,
        previous: current?.previous ?? null,
        warnings: ['the server runs its own checks on rollback; a dry run does not call it'],
      },
    );
  }
  await confirmed(rt, globals, `Roll ${env} back to ${explicit ?? 'the previous version'}?`);
  return client.run(
    async () =>
      fromMoved(
        facts,
        movedOf(
          await client.post('/v1/rollback', {
            env,
            remote: name,
            ...(explicit === undefined ? {} : { to: explicit }),
            ...(args.force === true ? { force: true } : {}),
          }),
        ),
      ),
    (failure) => deployResult(facts, { ok: false, findings: gateFindings(failure, name) }),
  );
}

interface AuditRow {
  action: string;
  remote: string | null;
  before: string | null;
  after: string | null;
  detail: Obj;
}

function auditRows(body: unknown): AuditRow[] {
  const entries = isObj(body) && Array.isArray(body.entries) ? body.entries : [];
  return entries.filter(isObj).map((e) => ({
    action: textOf(e.action) ?? '',
    remote: textOf(e.remote),
    before: textOf(e.before),
    after: textOf(e.after),
    detail: isObj(e.detail) ? e.detail : {},
  }));
}

/** From the audit log, newest first: who is killed and who is mid-rollout. */
function auditState(rows: readonly AuditRow[]): {
  killed: Map<string, string>;
  rollouts: Map<string, { candidate: string; percent: number }>;
} {
  const killed = new Map<string, string>();
  const rollouts = new Map<string, { candidate: string; percent: number }>();
  const seenKill = new Set<string>();
  const seenRollout = new Set<string>();
  for (const row of rows) {
    const remote = row.remote;
    if (remote === null) continue;
    if ((row.action === 'kill' || row.action === 'restore') && !seenKill.has(remote)) {
      seenKill.add(remote);
      if (row.action === 'kill') killed.set(remote, row.before ?? '');
    }
    const r = isObj(row.detail.rollout) ? row.detail.rollout : undefined;
    if (seenRollout.has(remote)) continue;
    if ((row.action === 'deploy' || row.action === 'promote') && r !== undefined) {
      seenRollout.add(remote);
      rollouts.set(remote, {
        candidate: row.after ?? '',
        percent: numberOf(r.percent),
      });
    } else if (row.action === 'rollout.step') {
      seenRollout.add(remote);
      rollouts.set(remote, {
        candidate: textOf(row.detail.candidate) ?? '',
        percent: numberOf(row.detail.toPercent),
      });
    } else if (['rollout.complete', 'rollout.abort', 'rollout.halt'].includes(row.action)) {
      seenRollout.add(remote);
    } else if (['deploy', 'promote', 'rollback'].includes(row.action)) {
      seenRollout.add(remote);
    }
  }
  return { killed, rollouts };
}

async function envsToShow(args: Record<string, unknown>, globals: Globals): Promise<string[]> {
  if (args.env !== undefined) return [envOf(args)];
  try {
    const view = await inspectProject(await findProjectRoot(globals.cwd));
    const envs = view.envDirs.filter((e) => e !== 'dev').toSorted((a, b) => a.localeCompare(b));
    if (envs.length > 0) return envs;
  } catch {
    // not in a project: the next line names what is missing
  }
  throw new MfeflowError(
    'E107',
    'name the environment: --env <env> (a server has no list of envs)',
  );
}

async function statusInner(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  client: ServerClient,
): Promise<StatusResult> {
  assertKnownFlags(raw, defs);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  positionals(args, 0, 'mfeflow status [--env <env>]');
  const envs = await envsToShow(args, globals);
  const out: StatusEnv[] = [];
  for (const env of envs) {
    // oxlint-disable-next-line no-await-in-loop -- a few envs
    const index = await client.run(() => client.index(env));
    if (index === undefined) {
      out.push({ env, published: false, generatedAt: null, remotes: [] });
      continue;
    }
    const state = client.hasToken
      ? // oxlint-disable-next-line no-await-in-loop -- a few envs
        await client
          .run(async () =>
            auditState(
              auditRows(
                await client.get(`/v1/audit?env=${encodeURIComponent(env)}&limit=500`, true),
              ),
            ),
          )
          .catch(() => undefined)
      : undefined;
    const remotes: StatusRemote[] = index.remotes.map((r) => ({
      name: r.name,
      version: r.version ?? '',
      previous: r.previous ?? null,
      history: r.history ?? [],
      rolledBackFrom: r.rolledBackFrom ?? null,
      local: null,
      unreferenced: null,
      drift: [],
      ...(state === undefined
        ? {}
        : { killed: false, rollout: state.rollouts.get(r.name) ?? null }),
    }));
    for (const [name, version] of state?.killed ?? [])
      remotes.push({
        name,
        version,
        previous: null,
        history: [],
        rolledBackFrom: null,
        local: null,
        unreferenced: null,
        drift: [],
        killed: true,
        rollout: null,
      });
    out.push({ env, published: true, generatedAt: index.generatedAt ?? null, remotes });
  }
  return {
    ok: true,
    command: 'status',
    root: await rootOf(globals),
    host: client.label,
    envs: out,
    findings: [],
  };
}

const countsOf = (value: unknown): { loads: number; errors: number; clients: number } => {
  const c = isObj(value) ? value : {};
  return { loads: numberOf(c.loads), errors: numberOf(c.errors), clients: numberOf(c.clients) };
};

/** What `GET /v1/rollout` says, as the fields of a rollout result. */
function statusOf(
  body: unknown,
): Pick<RolloutCommandResult, 'stable' | 'candidate' | 'percent' | 'serves' | 'report'> {
  const b = isObj(body) ? body : {};
  const gate = isObj(b.gate) ? b.gate : {};
  const cap = isObj(gate.reporterCap) ? gate.reporterCap : {};
  const verdict = gate.verdict === 'ok' || gate.verdict === 'halt' ? gate.verdict : 'wait';
  return {
    stable: textOf(b.stable),
    candidate: textOf(b.candidate),
    percent: typeof b.percent === 'number' ? b.percent : null,
    serves: textOf(b.stable),
    report: {
      startedAt: textOf(b.startedAt) ?? '',
      steps: Array.isArray(b.steps) ? b.steps.map(numberOf) : [],
      candidateCounts: countsOf(b.candidateCounts),
      stableCounts: countsOf(b.stableCounts),
      gate: { verdict, reason: textOf(gate.reason) },
      reporterCapFull: cap.full === true,
    },
  };
}

async function rolloutInner(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  client: ServerClient | undefined,
): Promise<RolloutCommandResult> {
  assertKnownFlags(raw, ROLLOUT_CMD_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const [action, name] = positionals(
    args,
    2,
    'mfeflow rollout step|complete|abort|status <remote> --env <env>',
  );
  if (action !== 'step' && action !== 'complete' && action !== 'abort' && action !== 'status')
    throw new MfeflowError(
      'E107',
      'write mfeflow rollout step|complete|abort|status <remote> --env <env>',
    );
  if (name === undefined) throw new MfeflowError('E107', `name the remote to ${action}`);
  if (client === undefined)
    throw new MfeflowError(
      'E505',
      'rollouts need the registry server: set MFEFLOW_REGISTRY_URL or pass --registry-url',
    );
  const env = envOf(args);
  const root = await rootOf(globals);
  const verb: RolloutCommandResult['action'] = action;
  const base = {
    ok: true,
    command: 'rollout' as const,
    action: verb,
    dryRun: globals.dryRun,
    root,
    host: client.label,
    env,
    remote: name,
  };
  if (action === 'status') {
    const s = await client.run(() =>
      client.get(
        `/v1/rollout?env=${encodeURIComponent(env)}&remote=${encodeURIComponent(name)}`,
        true,
      ),
    );
    return { ...base, ...statusOf(s) };
  }
  if (globals.dryRun)
    return { ...base, stable: null, candidate: null, percent: null, serves: null };
  await confirmed(rt, globals, `${action} the rollout of ${name} in ${env}?`);
  const reason = action === 'abort' ? text(args, 'reason') : undefined;
  const body = await client.run(() =>
    client.post(`/v1/rollout/${action}`, {
      env,
      remote: name,
      ...(reason === undefined ? {} : { reason }),
    }),
  );
  const b = isObj(body) ? body : {};
  return {
    ...base,
    stable: textOf(b.stable),
    candidate: textOf(b.candidate),
    percent: typeof b.percent === 'number' ? b.percent : null,
    serves: textOf(b.serves),
  };
}

async function killInner(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  restore: boolean,
  client: ServerClient | undefined,
): Promise<KillCommandResult> {
  assertKnownFlags(raw, restore ? RESTORE_ARGS : KILL_ARGS);
  const command = restore ? 'restore' : 'kill';
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const [name] = positionals(args, 1, `mfeflow ${command} <remote> --env <env>`);
  if (name === undefined) throw new MfeflowError('E107', `name the remote to ${command}`);
  if (client === undefined)
    throw new MfeflowError(
      'E506',
      `${command} needs the registry server: set MFEFLOW_REGISTRY_URL or pass --registry-url. A static host has no kill switch; roll back instead`,
    );
  const env = envOf(args);
  const base = {
    ok: true,
    command,
    dryRun: globals.dryRun,
    root: await rootOf(globals),
    host: client.label,
    env,
    remote: name,
  } as const;
  if (globals.dryRun) return { ...base, changed: null, killed: null };
  await confirmed(rt, globals, `${restore ? 'Restore' : 'Kill'} ${name} in ${env}?`);
  const reason = restore ? undefined : text(args, 'reason');
  const body = await client.run(() =>
    client.post('/v1/kill', {
      env,
      remote: name,
      ...(restore ? { restore: true } : {}),
      ...(reason === undefined ? {} : { reason }),
    }),
  );
  const b = isObj(body) ? body : {};
  return { ...base, changed: b.changed === true, killed: b.killed === true };
}

const rate = (c: { loads: number; errors: number }): string =>
  `${String(c.loads)} loads, ${String(c.errors)} errors`;

export async function deployViaServer(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  client: ServerClient,
): Promise<DeployResult> {
  return client.scrubAll(await deployInner(rt, args, raw, defs, client));
}

export async function promoteViaServer(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  client: ServerClient,
): Promise<DeployResult> {
  return client.scrubAll(await promoteInner(rt, args, raw, defs, client));
}

export async function rollbackViaServer(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  client: ServerClient,
): Promise<DeployResult> {
  return client.scrubAll(await rollbackInner(rt, args, raw, defs, client));
}

export async function statusViaServer(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  defs: ArgsDef,
  client: ServerClient,
): Promise<StatusResult> {
  return client.scrubAll(await statusInner(rt, args, raw, defs, client));
}

export async function runRolloutCommand(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  client: ServerClient | undefined,
): Promise<RolloutCommandResult> {
  const result = await rolloutInner(rt, args, raw, client);
  return client === undefined ? result : client.scrubAll(result);
}

export async function runKillCommand(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  restore: boolean,
  client: ServerClient | undefined,
): Promise<KillCommandResult> {
  const result = await killInner(rt, args, raw, restore, client);
  return client === undefined ? result : client.scrubAll(result);
}

export function formatServerAction(result: RolloutCommandResult | KillCommandResult): string {
  if (result.command === 'rollout') {
    if (result.action === 'status' && result.report !== undefined) {
      const r = result.report;
      const verdict =
        r.gate.verdict === 'ok'
          ? 'ok'
          : `${r.gate.verdict}${r.gate.reason === null ? '' : `: ${r.gate.reason}`}`;
      return [
        `${result.remote} in ${result.env}: ${result.candidate ?? ''} is at ${String(result.percent)}%${r.steps.length === 0 ? '' : `, then ${r.steps.map((n) => `${String(n)}%`).join(', ')}`}; everyone else is on ${result.stable ?? ''}.`,
        `Candidate: ${rate(r.candidateCounts)} from ${String(r.candidateCounts.clients)} browsers.`,
        `Stable: ${rate(r.stableCounts)} from ${String(r.stableCounts.clients)} browsers.`,
        `Gate: ${verdict}.${r.reporterCapFull ? ' The reporter cap is full: new browsers are no longer counted.' : ''}`,
      ].join('\n');
    }
    if (result.dryRun)
      return `Dry run: would ${result.action} the rollout of ${result.remote} in ${result.env} (${result.host}). Nothing was sent.`;
    const head = `Rollout ${result.action} for ${result.remote} in ${result.env}: `;
    if (result.action === 'complete')
      return `${head}${result.env} now serves ${result.candidate ?? ''} for everyone.`;
    if (result.action === 'abort')
      return `${head}back to ${result.stable ?? ''} for everyone; ${result.candidate ?? ''} was dropped.`;
    return `${head}${result.candidate ?? ''} is at ${String(result.percent)}%; everyone else stays on ${result.stable ?? ''}.`;
  }
  const verb = result.command === 'kill' ? 'kill' : 'restore';
  if (result.dryRun)
    return `Dry run: would ${verb} ${result.remote} in ${result.env} (${result.host}). Nothing was sent.`;
  if (result.changed === false)
    return `${result.remote} was already ${result.killed === true ? 'killed' : 'live'} in ${result.env}. Nothing to do.`;
  return result.command === 'kill'
    ? `${result.remote} is killed in ${result.env}: it is out of the index. Bring it back with mfeflow restore.`
    : `${result.remote} is live again in ${result.env}.`;
}
