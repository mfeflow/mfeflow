import crypto from 'node:crypto';
import {
  isPortableRelativePath,
  remoteDistFiles,
  ROUTE_OVERLAP,
  validateRegistryIndex,
  type MfeManifest,
  type RegistryIndex,
  type RegistryIndexRemote,
} from '@mfeflow/contracts';
import { artifactPrefix, buildIndex, type GateFailure } from '../static';
import type { Log } from './fallback';
import { DEFAULT_GATE, evaluateGate, type GateSettings } from './gate';
import { inRollout } from './rollout';
import {
  RevisionConflictError,
  type AuditEntry,
  type EnvChange,
  type EnvState,
  type PointerRecord,
  type RegistryStorage,
  type RolloutRecord,
  type TokenRecord,
  type VersionRecord,
} from './storage';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const bad = (message: string): ApiError => new ApiError(400, 'bad_request', message);
const conflict = (code: string, message: string): ApiError => new ApiError(409, code, message);

/** Reads files the artifact host serves. The server never writes to it. */
export interface ArtifactSource {
  /** The bytes, or undefined for a 404. Throws on anything else; throws `ArtifactTooLargeError` past `maxBytes`. */
  get(url: string, options?: { maxBytes?: number }): Promise<Uint8Array | undefined>;
}

export class ArtifactTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`larger than ${String(maxBytes)} bytes`);
    this.name = 'ArtifactTooLargeError';
  }
}

/** Raised inside an operation when another remote's change moved the env; the operation runs again. */
class RetryOperation extends Error {}

/** The most a single deploy reads from the artifact host, all files together. */
export const DEPLOY_READ_BUDGET = 32 * 1024 * 1024;

/** 1.4.2, 1.4.2-rc.1, 1.4.2+a1b2c3d: no path or URL characters, no `..`. */
export const SAFE_VERSION =
  /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** `base/path`, refused unless the normalised URL stays under `base`. */
export function artifactUrl(base: string, path: string): string {
  const url = new URL(`${base}/${path}`).href;
  if (!url.startsWith(`${base}/`) || /[?#]/.test(path))
    throw new ApiError(400, 'bad_request', 'the artifact path leaves the artifact base URL');
  return url;
}

const REMOTE_NAME = /^[A-Za-z_$][\w$-]{0,127}$/;
export const ENV_NAME = /^[a-z][a-z0-9-]*$/;
const MAX_FILES = 64;

export interface ServiceOptions {
  storage: RegistryStorage;
  artifacts?: ArtifactSource | undefined;
  /** `deploy` accepts only manifest URLs under this. */
  artifactBaseUrl?: string | undefined;
  now?: () => Date;
  /** Called after every committed change, with the env. The fallback republish hangs off it. */
  onChange?: (env: string) => void;
  /** When a rollout candidate is halted. */
  gate?: GateSettings;
  /** Browsers counted per rollout. Default 20000. */
  maxReporters?: number;
  log?: Log;
}

export interface MoveResult {
  ok: true;
  /** False when the env already served this version. */
  changed: boolean;
  env: string;
  fromEnv?: string;
  remote: string;
  version: string;
  servedBefore: string | null;
  previous: string | null;
  rolledBackFrom: string | null;
  warnings: string[];
  /** Set when the deploy started a rollout: `version` is the candidate and `servedBefore` stays stable. */
  rollout?: RolloutSummary;
}

export interface RolloutSummary {
  id: string;
  stable: string;
  candidate: string;
  percent: number;
  steps: number[];
}

export interface RolloutResult {
  ok: true;
  env: string;
  remote: string;
  action: 'step' | 'complete' | 'abort';
  stable: string;
  candidate: string;
  percent: number;
  /** What the index serves now: the candidate after `complete`, stable otherwise. */
  serves: string;
}

/** A page reports each remote once, and a page has few remotes. */
export const BEACON_MAX_ENTRIES = 20;
export const DEFAULT_MAX_REPORTERS = 20_000;
const CLIENT_ID = /^[\w.:-]{1,128}$/;

export interface RolloutStatus extends RolloutSummary {
  env: string;
  remote: string;
  startedAt: string;
  candidateCounts: { loads: number; errors: number; clients: number };
  stableCounts: { loads: number; errors: number; clients: number };
  gate: {
    verdict: 'wait' | 'ok' | 'halt';
    /** Why it is waiting, or why it would halt. */
    reason?: string;
    settings: GateSettings;
    /** `full` means new browsers are no longer counted, so the gate has stopped learning. */
    reporterCap: { max: number; full: boolean };
  };
}

export interface KillResult {
  ok: true;
  changed: boolean;
  env: string;
  remote: string;
  killed: boolean;
}

type Body = Record<string, unknown>;

function asBody(raw: unknown): Body {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw bad('the body must be a JSON object');
  return Object.fromEntries(Object.entries(raw));
}

function field(body: Body, key: string, pattern?: RegExp): string {
  const value = body[key];
  if (typeof value !== 'string' || value === '' || value.length > 512)
    throw bad(`"${key}" must be a non-empty string`);
  if (pattern !== undefined && !pattern.test(value)) throw bad(`"${key}" is not valid`);
  return value;
}

function optionalField(body: Body, key: string, pattern?: RegExp): string | undefined {
  return body[key] === undefined ? undefined : field(body, key, pattern);
}

function rejectUnknown(body: Body, allowed: readonly string[]): void {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length === 0) return;
  throw bad(`unknown field ${extra.map((k) => `"${k}"`).join(', ')}`);
}

const envOf = (body: Body, key = 'env'): string => field(body, key, ENV_NAME);
const nameOf = (body: Body, key = 'remote'): string => {
  const name = field(body, key);
  if (!REMOTE_NAME.test(name)) throw bad(`"${key}" is not a valid remote name`);
  return name;
};

function stringMap(value: unknown, key: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw bad(`"${key}" must be an object of strings`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') throw bad(`"${key}.${k}" must be a string`);
    out[k] = v;
  }
  return out;
}

function budgetsOf(value: unknown): { initialJsKb?: number } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw bad('"budgets" must be an object');
  const kb: unknown = Object.entries(value).find(([k]) => k === 'initialJsKb')?.[1];
  if (kb === undefined) return {};
  if (typeof kb !== 'number' || !Number.isFinite(kb) || kb <= 0)
    throw bad('"budgets.initialJsKb" must be a positive number');
  return { initialJsKb: kb };
}

function routesOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64)
    throw bad('"routes" must be a list of 1 to 64 route patterns');
  return value.map((route) => {
    if (typeof route !== 'string' || route.length > 256) throw bad('"routes" must be strings');
    return route;
  });
}

function wholeNumber(value: unknown, key: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw bad(`"${key}" must be a whole number from ${String(min)} to ${String(max)}`);
  return value;
}

function rolloutOf(value: unknown): { percent: number; steps: number[] } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw bad('"rollout" must be an object like {"percent": 10, "steps": [50, 100]}');
  const body = asBody(value);
  rejectUnknown(body, ['percent', 'steps']);
  const percent = wholeNumber(body.percent, 'rollout.percent', 1, 99);
  const raw = body.steps ?? [];
  if (!Array.isArray(raw) || raw.length > 20)
    throw bad('"rollout.steps" must be a list of up to 20 percents');
  const steps = raw.map((step) => wholeNumber(step, 'rollout.steps', 1, 100));
  let last = percent;
  for (const step of steps) {
    if (step <= last)
      throw bad('"rollout.steps" must rise, and each step must be over "rollout.percent"');
    last = step;
  }
  return { percent, steps };
}

const sha256 = (bytes: Uint8Array): string =>
  crypto.createHash('sha256').update(bytes).digest('hex');

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function indexOf(state: EnvState): RegistryIndex {
  return {
    env: state.env,
    generatedAt: state.updatedAt,
    remotes: state.remotes.filter((r) => !r.killed).map((r) => r.remote),
  };
}

/** The pointer as it is, for a change that only touches the rollout. */
const stay = (p: PointerRecord): EnvChange['pointer'] => ({
  name: p.name,
  version: p.version,
  remote: p.remote,
  killed: p.killed,
  ...(p.killReason === undefined ? {} : { killReason: p.killReason }),
});

const summaryOf = (r: RolloutRecord): RolloutSummary => ({
  id: r.id,
  stable: r.stable,
  candidate: r.candidate,
  percent: r.percent,
  steps: r.steps.filter((s) => s > r.percent),
});

const failuresOf = (failures: readonly GateFailure[]): Record<string, unknown> => ({
  failures: failures.map((f) => ({ ...f })),
});

function mfeOf(record: VersionRecord, origin: RegistryIndexRemote | undefined): MfeManifest {
  return {
    name: record.remote,
    owner: origin?.owner ?? record.owner,
    shells: [],
    routes: origin?.routes ?? record.routes,
    exposes: [],
    ...(record.platform === undefined ? {} : { platform: record.platform }),
    ...(record.budgets === undefined ? {} : { budgets: record.budgets }),
  };
}

export class RegistryService {
  private readonly storage: RegistryStorage;
  private readonly now: () => Date;

  constructor(private readonly options: ServiceOptions) {
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * What `GET /v1/index/:env` serves. Killed remotes are left out. A client that falls in a remote's
   * rollout group gets the candidate for it; a client without an id, or outside the group, gets stable.
   */
  async index(env: string, clientId?: string): Promise<RegistryIndex | undefined> {
    const state = await this.storage.readEnv(env);
    if (state === undefined) return undefined;
    const stable = indexOf(state);
    if (clientId === undefined) return stable;
    const rollouts = await this.storage.listRollouts(env);
    if (rollouts.length === 0) return stable;
    return {
      ...stable,
      remotes: stable.remotes.map((remote) => {
        const rollout = rollouts.find((r) => r.remote === remote.name);
        return rollout !== undefined &&
          inRollout(clientId, remote.name, rollout.id, rollout.percent)
          ? rollout.candidateRemote
          : remote;
      }),
    };
  }

  /** What the static fallback holds: stable only. A rollout candidate never goes in it. */
  stableIndex(env: string): Promise<RegistryIndex | undefined> {
    return this.index(env);
  }

  async audit(
    token: TokenRecord,
    query: { env?: string | undefined; remote?: string | undefined; limit?: number },
  ): Promise<AuditEntry[]> {
    if (query.env === undefined && token.env !== '*')
      throw new ApiError(403, 'forbidden', 'this token reads one env: pass ?env=');
    const remote = token.remote === '*' ? query.remote : token.remote;
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    return this.storage.audit({
      ...(query.env === undefined ? {} : { env: query.env }),
      ...(remote === undefined ? {} : { remote }),
      limit,
    });
  }

  deploy(actor: string | null, raw: unknown): Promise<MoveResult> {
    return this.retrying(() => this.deployOnce(actor, raw));
  }

  promote(actor: string | null, raw: unknown): Promise<MoveResult> {
    return this.retrying(() => this.promoteOnce(actor, raw));
  }

  rollback(actor: string | null, raw: unknown): Promise<MoveResult> {
    return this.retrying(() => this.rollbackOnce(actor, raw));
  }

  /**
   * An env has one revision, so a change to another remote also fails the compare-and-swap. When
   * the remote this request touches is unchanged, nothing it checked is stale: run it again.
   */
  private async retrying<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each attempt re-reads the env
        return await run();
      } catch (error) {
        if (!(error instanceof RetryOperation)) throw error;
        if (attempt >= 3) throw conflict('conflict', 'the env keeps changing; retry');
      }
    }
  }

  private async deployOnce(actor: string | null, raw: unknown): Promise<MoveResult> {
    const body = asBody(raw);
    rejectUnknown(body, [
      'env',
      'remote',
      'version',
      'manifestUrl',
      'owner',
      'routes',
      'platform',
      'budgets',
      'rollout',
    ]);
    const rolloutPlan = rolloutOf(body.rollout);
    const env = envOf(body);
    const name = nameOf(body, 'remote');
    const version = field(body, 'version', SAFE_VERSION);
    const manifestUrl = field(body, 'manifestUrl');
    const owner = field(body, 'owner');
    const routes = routesOf(body.routes);
    const platform = stringMap(body.platform, 'platform');
    const budgets = budgetsOf(body.budgets);
    const base = this.options.artifactBaseUrl;
    if (base === undefined)
      throw new ApiError(
        503,
        'not_configured',
        'deploy is off: set MFEFLOW_REGISTRY_ARTIFACT_BASE_URL to where artifacts are served from',
      );
    const prefix = artifactPrefix(name, version);
    const expected = `${base}/${prefix}/mf-manifest.json`;
    if (manifestUrl !== expected) throw bad(`"manifestUrl" must be ${expected}`);

    const state = await this.storage.readEnv(env);
    const current = state?.remotes.find((r) => r.name === name);
    if (current?.killed === true)
      throw conflict(
        'killed',
        `${name} is killed in ${env}; restore it with POST /v1/kill {"restore":true} first`,
      );
    await this.assertNoRollout(env, name);
    if (rolloutPlan !== undefined) {
      if (current === undefined)
        throw conflict(
          'no_stable',
          `${name} has no stable version in ${env}; deploy it without a rollout first`,
        );
      if (current.version === version)
        throw conflict('no_target', `${env} already serves ${name}@${version}`);
    }

    const { manifest, manifestBytes, files } = await this.fetchVersion(base, prefix);
    const hash = sha256(manifestBytes);
    const existing = await this.storage.getVersion(env, name, version);
    if (existing !== undefined && existing.manifestSha256 !== hash)
      throw conflict(
        'version_immutable',
        `${name}@${version} is already registered in ${env} with a different manifest; publish a new version`,
      );

    const shell = await this.shellManifest(base, env);
    const at = this.now().toISOString();
    const mfe: MfeManifest = {
      name,
      owner,
      shells: [],
      routes,
      exposes: [],
      ...(platform === undefined ? {} : { platform }),
      ...(budgets === undefined ? {} : { budgets }),
    };
    const built = buildIndex({
      remote: mfe,
      version,
      manifest,
      files,
      env,
      baseUrl: base,
      ...(state === undefined ? {} : { currentIndex: indexOf(state) }),
      ...(shell.manifest === undefined ? {} : { shellManifest: shell.manifest }),
      generatedAt: at,
    });
    if (built.failures.length > 0)
      throw new ApiError(
        422,
        'gates_failed',
        `${name}@${version} was refused: ${built.failures.map((f) => f.message).join('; ')}`,
        failuresOf(built.failures),
      );
    const remote = built.index.remotes.find((r) => r.name === name);
    if (remote === undefined) throw new ApiError(500, 'internal_error', 'index has no remote');
    const warnings = [...shell.warnings, ...built.warnings];
    if (rolloutPlan === undefined && current?.version === version && existing !== undefined)
      return this.result('deploy', env, remote, current.version, false, warnings);
    const record: VersionRecord = {
      env,
      remote: name,
      version,
      manifestUrl,
      manifestSha256: hash,
      manifest,
      owner,
      routes,
      ...(platform === undefined ? {} : { platform }),
      ...(budgets === undefined ? {} : { budgets }),
      createdAt: at,
      createdBy: actor,
    };
    if (rolloutPlan !== undefined && current !== undefined) {
      const rollout: RolloutRecord = {
        env,
        remote: name,
        id: crypto.randomBytes(6).toString('hex'),
        stable: current.version,
        candidate: version,
        candidateRemote: remote,
        percent: rolloutPlan.percent,
        steps: rolloutPlan.steps,
        startedAt: at,
        updatedAt: at,
      };
      await this.commit(
        {
          env,
          expectedRev: state?.rev ?? 0,
          at,
          versions: [record],
          pointer: stay(current),
          rollout: { set: rollout },
          audit: {
            at,
            tokenId: actor,
            action: 'deploy',
            env,
            remote: name,
            before: current.version,
            after: version,
            detail: {
              warnings: warnings.length,
              rollout: { id: rollout.id, percent: rollout.percent, steps: rollout.steps },
            },
          },
        },
        { seen: current },
      );
      return {
        ...this.result('deploy', env, remote, current.version, true, warnings),
        rollout: summaryOf(rollout),
      };
    }
    await this.commit(
      {
        env,
        expectedRev: state?.rev ?? 0,
        at,
        versions: [record],
        pointer: { name, version, remote, killed: false },
        audit: {
          at,
          tokenId: actor,
          action: 'deploy',
          env,
          remote: name,
          before: current?.version ?? null,
          after: version,
          detail: { warnings: warnings.length },
        },
      },
      { seen: current },
    );
    return this.result('deploy', env, remote, current?.version, true, warnings);
  }

  private async promoteOnce(actor: string | null, raw: unknown): Promise<MoveResult> {
    const body = asBody(raw);
    rejectUnknown(body, ['from', 'to', 'remote']);
    const from = envOf(body, 'from');
    const to = envOf(body, 'to');
    const name = nameOf(body);
    if (from === to) throw bad(`"from" and "to" are both "${from}"`);
    const source = await this.storage.readEnv(from);
    const served = source?.remotes.find((r) => r.name === name);
    if (served === undefined || served.killed)
      throw new ApiError(404, 'not_deployed', `${name} is not deployed to ${from}`);
    const record = await this.storage.getVersion(from, name, served.version);
    if (record === undefined)
      throw conflict('version_missing', `${name}@${served.version} has no record in ${from}`);
    return this.move(actor, {
      action: 'promote',
      env: to,
      fromEnv: from,
      name,
      version: served.version,
      record,
      origin: served.remote,
      force: false,
    });
  }

  private async rollbackOnce(actor: string | null, raw: unknown): Promise<MoveResult> {
    const body = asBody(raw);
    rejectUnknown(body, ['env', 'remote', 'to', 'force']);
    const env = envOf(body);
    const name = nameOf(body);
    const explicit = optionalField(body, 'to');
    if (body.force !== undefined && typeof body.force !== 'boolean')
      throw bad('"force" must be true or false');
    await this.assertNoRollout(env, name);
    const state = await this.storage.readEnv(env);
    const current = state?.remotes.find((r) => r.name === name);
    if (current === undefined)
      throw new ApiError(404, 'not_deployed', `${name} is not deployed to ${env}`);
    if (current.killed) throw conflict('killed', `${name} is killed in ${env}; restore it first`);
    const remote = current.remote;
    const known = [...new Set([remote.previous, ...(remote.history ?? [])])].filter(
      (v): v is string => v !== undefined,
    );
    const to = explicit ?? remote.previous;
    if (to === undefined)
      throw conflict('no_target', `${name} in ${env} has no previous version to go back to`);
    if (to === current.version) throw conflict('no_target', `${env} already serves ${name}@${to}`);
    if (!known.includes(to))
      throw conflict(
        'no_target',
        `${name}@${to} is not in the history of ${env} (${known.length === 0 ? 'empty' : known.join(', ')})`,
      );
    const record = await this.storage.getVersion(env, name, to);
    if (record === undefined)
      throw conflict('version_missing', `${name}@${to} has no record in ${env}`);
    return this.move(actor, {
      action: 'rollback',
      env,
      name,
      version: to,
      record,
      origin: remote,
      force: body.force === true,
      seen: { state },
    });
  }

  private async assertNoRollout(env: string, name: string): Promise<void> {
    const active = (await this.storage.listRollouts(env)).find((r) => r.remote === name);
    if (active !== undefined)
      throw conflict(
        'rollout_active',
        `${name} is rolling out ${active.candidate} in ${env}; complete or abort that first`,
      );
  }

  rolloutStep(actor: string | null, raw: unknown): Promise<RolloutResult> {
    return this.retrying(() => this.endOrMove(actor, raw, 'step'));
  }

  rolloutComplete(actor: string | null, raw: unknown): Promise<RolloutResult> {
    return this.retrying(() => this.endOrMove(actor, raw, 'complete'));
  }

  rolloutAbort(actor: string | null, raw: unknown): Promise<RolloutResult> {
    return this.retrying(() => this.endOrMove(actor, raw, 'abort'));
  }

  private async endOrMove(
    actor: string | null,
    raw: unknown,
    action: RolloutResult['action'],
    halt?: { reason: string; detail: Record<string, unknown>; rolloutId: string },
  ): Promise<RolloutResult> {
    const body = asBody(raw);
    rejectUnknown(body, action === 'abort' ? ['env', 'remote', 'reason'] : ['env', 'remote']);
    const env = envOf(body);
    const name = nameOf(body);
    const reason = action === 'abort' ? optionalField(body, 'reason') : undefined;
    const state = await this.storage.readEnv(env);
    const pointer = state?.remotes.find((r) => r.name === name);
    const rollout = (await this.storage.listRollouts(env)).find((r) => r.remote === name);
    if (state === undefined || pointer === undefined || rollout === undefined)
      throw new ApiError(404, 'no_rollout', `${name} has no rollout in ${env}`);
    if (halt !== undefined && halt.rolloutId !== rollout.id)
      throw new ApiError(404, 'no_rollout', `${name} has no rollout in ${env}`);
    const at = this.now().toISOString();
    const audit = (
      name_: string,
      after: string | null,
      detail: Record<string, unknown>,
    ): EnvChange['audit'] => ({
      at,
      tokenId: actor,
      action: name_,
      env,
      remote: name,
      before: rollout.stable,
      after,
      detail: { rolloutId: rollout.id, candidate: rollout.candidate, ...detail },
    });
    const result = (percent: number, serves: string): RolloutResult => ({
      ok: true,
      env,
      remote: name,
      action,
      stable: rollout.stable,
      candidate: rollout.candidate,
      percent,
      serves,
    });

    if (action === 'step') {
      const next = rollout.steps.find((s) => s > rollout.percent);
      if (next === undefined)
        throw conflict(
          'no_next_step',
          `${name} is at ${String(rollout.percent)}% with no step left; complete it or abort it`,
        );
      await this.commit(
        {
          env,
          expectedRev: state.rev,
          at,
          versions: [],
          pointer: stay(pointer),
          rollout: { set: { ...rollout, percent: next, updatedAt: at } },
          audit: audit('rollout.step', rollout.candidate, {
            fromPercent: rollout.percent,
            toPercent: next,
          }),
        },
        { seen: pointer },
      );
      return result(next, rollout.stable);
    }

    if (action === 'complete') {
      if (pointer.killed) throw conflict('killed', `${name} is killed in ${env}; restore it first`);
      const others = state.remotes.filter((r) => !r.killed && r.name !== name).map((r) => r.remote);
      const overlap = validateRegistryIndex({
        remotes: [...others, rollout.candidateRemote],
      }).filter((i) => i.code === ROUTE_OVERLAP);
      if (overlap.length > 0)
        throw conflict(
          'route_overlap',
          `${name}@${rollout.candidate} cannot become stable: ${overlap.map((i) => i.message).join('; ')}. The rollout is still running; abort it or change the other remote`,
        );
      await this.commit(
        {
          env,
          expectedRev: state.rev,
          at,
          versions: [],
          pointer: {
            name,
            version: rollout.candidate,
            remote: rollout.candidateRemote,
            killed: false,
          },
          rollout: { clear: rollout.id },
          audit: audit('rollout.complete', rollout.candidate, { percent: rollout.percent }),
        },
        { seen: pointer },
      );
      return result(100, rollout.candidate);
    }

    await this.commit(
      {
        env,
        expectedRev: state.rev,
        at,
        versions: [],
        pointer: stay(pointer),
        rollout: { clear: rollout.id },
        audit: audit(halt === undefined ? 'rollout.abort' : 'rollout.halt', rollout.stable, {
          percent: rollout.percent,
          ...(halt === undefined
            ? reason === undefined
              ? {}
              : { reason }
            : { reason: halt.reason, ...halt.detail }),
        }),
      },
      { seen: pointer },
    );
    return result(0, rollout.stable);
  }

  /**
   * One page's report: its client id `u` and up to 20 `{remote, version, loads, errors}` entries,
   * each `loads` 0 or 1 and `errors` no more than `loads`. A browser counts once per rollout side,
   * however often it reports (the dedupe is a table in storage). Entries for anything that is not
   * the candidate or stable of a running rollout are dropped without a write, and so is an entry
   * for the side `u` is not assigned to (candidate when `u` falls inside the percent, else stable).
   * A remote named twice in one body is refused. Then the gate runs.
   */
  async beacon(raw: unknown): Promise<void> {
    const body = asBody(raw);
    rejectUnknown(body, ['env', 'u', 'entries']);
    const env = envOf(body);
    const client = field(body, 'u', CLIENT_ID);
    const list = body.entries;
    if (!Array.isArray(list) || list.length === 0 || list.length > BEACON_MAX_ENTRIES)
      throw bad(`"entries" must be a list of 1 to ${String(BEACON_MAX_ENTRIES)} reports`);
    const entries = list.map((item) => {
      const entry = asBody(item);
      rejectUnknown(entry, ['remote', 'version', 'loads', 'errors']);
      const loads = wholeNumber(entry.loads, 'loads', 0, 1);
      const errors = wholeNumber(entry.errors, 'errors', 0, 1);
      if (errors > loads) throw bad('"errors" cannot be more than "loads"');
      return {
        remote: nameOf(entry),
        version: field(entry, 'version', SAFE_VERSION),
        loads,
        errors,
      };
    });
    const names = entries.map((e) => e.remote);
    if (new Set(names).size !== names.length) throw bad('"entries" names a remote more than once');
    const rollouts = await this.storage.listRollouts(env);
    const maxReporters = this.options.maxReporters ?? DEFAULT_MAX_REPORTERS;
    const judged = new Map<string, RolloutRecord>();
    for (const { remote, version, loads, errors } of entries) {
      const rollout = rollouts.find((r) => r.remote === remote);
      if (loads === 0 || rollout === undefined) continue;
      const side = inRollout(client, remote, rollout.id, rollout.percent)
        ? rollout.candidate
        : rollout.stable;
      if (version !== side) continue;
      // oxlint-disable-next-line no-await-in-loop -- at most 20 small writes
      await this.storage.addRolloutReport(rollout.id, version, client, errors === 1, maxReporters);
      if (version === rollout.candidate) judged.set(rollout.id, rollout);
    }
    for (const rollout of judged.values()) {
      // oxlint-disable-next-line no-await-in-loop -- a page rarely has more than a couple
      await this.judge(rollout);
    }
  }

  /** A running rollout's numbers and what the gate thinks of them right now. */
  async rolloutStatus(env: string, remote: string): Promise<RolloutStatus> {
    const rollout = (await this.storage.listRollouts(env)).find((r) => r.remote === remote);
    if (rollout === undefined)
      throw new ApiError(404, 'no_rollout', `${remote} has no rollout in ${env}`);
    const settings = this.options.gate ?? DEFAULT_GATE;
    const counts = await this.storage.rolloutCounts(rollout.id);
    const none = { loads: 0, errors: 0, clients: 0 };
    const candidate = counts[rollout.candidate] ?? none;
    const stable = counts[rollout.stable] ?? none;
    const verdict = evaluateGate(candidate, stable, settings);
    const maxReporters = this.options.maxReporters ?? DEFAULT_MAX_REPORTERS;
    const full = candidate.clients + stable.clients >= maxReporters;
    return {
      env,
      remote,
      ...summaryOf(rollout),
      startedAt: rollout.startedAt,
      candidateCounts: candidate,
      stableCounts: stable,
      gate: {
        verdict: verdict.verdict,
        ...('reason' in verdict ? { reason: verdict.reason } : {}),
        settings,
        reporterCap: { max: maxReporters, full },
      },
    };
  }

  private async judge(rollout: RolloutRecord): Promise<void> {
    const settings = this.options.gate ?? DEFAULT_GATE;
    const counts = await this.storage.rolloutCounts(rollout.id);
    const none = { loads: 0, errors: 0, clients: 0 };
    const candidate = counts[rollout.candidate] ?? none;
    const stable = counts[rollout.stable] ?? none;
    const verdict = evaluateGate(candidate, stable, settings);
    if (verdict.verdict !== 'halt') return;
    try {
      await this.retrying(() =>
        this.endOrMove(null, { env: rollout.env, remote: rollout.remote }, 'abort', {
          reason: verdict.reason,
          rolloutId: rollout.id,
          detail: {
            gate: 'error-rate',
            candidateCounts: candidate,
            stableCounts: stable,
            candidateRate: verdict.candidateRate,
            stableRate: verdict.stableRate,
            settings,
          },
        }),
      );
    } catch (error) {
      // Another request ended this rollout first: nothing left to halt.
      if (error instanceof ApiError && error.code === 'no_rollout') return;
      this.options.log?.(
        'error',
        `could not halt ${rollout.remote}@${rollout.candidate} in ${rollout.env}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /** Removes a remote from the served index at once, or with `restore` puts it back. Retries a lost race: a kill must land. */
  async kill(actor: string | null, raw: unknown): Promise<KillResult> {
    const body = asBody(raw);
    rejectUnknown(body, ['env', 'remote', 'reason', 'restore']);
    const env = envOf(body);
    const name = nameOf(body);
    const reason = optionalField(body, 'reason');
    if (body.restore !== undefined && typeof body.restore !== 'boolean')
      throw bad('"restore" must be true or false');
    const restore = body.restore === true;
    for (let attempt = 0; ; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- each attempt re-reads the env
        return await this.killOnce(actor, env, name, restore, reason);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'conflict' && attempt < 4)) throw error;
      }
    }
  }

  private async killOnce(
    actor: string | null,
    env: string,
    name: string,
    restore: boolean,
    reason: string | undefined,
  ): Promise<KillResult> {
    const state = await this.storage.readEnv(env);
    const pointer = state?.remotes.find((r) => r.name === name);
    if (state === undefined || pointer === undefined)
      throw new ApiError(404, 'not_deployed', `${name} is not deployed to ${env}`);
    if (pointer.killed === !restore)
      return { ok: true, changed: false, env, remote: name, killed: !restore };
    if (restore) {
      const others = state.remotes.filter((r) => !r.killed && r.name !== name).map((r) => r.remote);
      const overlap = validateRegistryIndex({ remotes: [...others, pointer.remote] }).filter(
        (i) => i.code === ROUTE_OVERLAP,
      );
      if (overlap.length > 0)
        throw conflict(
          'route_overlap',
          `${name} cannot come back: ${overlap.map((i) => i.message).join('; ')}`,
        );
    }
    const at = this.now().toISOString();
    await this.commit({
      env,
      expectedRev: state.rev,
      at,
      versions: [],
      pointer: {
        name,
        version: pointer.version,
        remote: pointer.remote,
        killed: !restore,
        ...(restore || reason === undefined ? {} : { killReason: reason }),
      },
      audit: {
        at,
        tokenId: actor,
        action: restore ? 'restore' : 'kill',
        env,
        remote: name,
        before: restore ? null : pointer.version,
        after: restore ? pointer.version : null,
        detail: reason === undefined ? {} : { reason },
      },
    });
    return { ok: true, changed: true, env, remote: name, killed: !restore };
  }

  private async move(
    actor: string | null,
    m: {
      action: 'promote' | 'rollback';
      env: string;
      fromEnv?: string;
      name: string;
      version: string;
      record: VersionRecord;
      origin: RegistryIndexRemote;
      force: boolean;
      /** The env as the caller checked its intent against; the commit then fails if it has moved since. */
      seen?: { state: EnvState | undefined };
    },
  ): Promise<MoveResult> {
    await this.assertNoRollout(m.env, m.name);
    const state = m.seen === undefined ? await this.storage.readEnv(m.env) : m.seen.state;
    const before = state?.remotes.find((r) => r.name === m.name);
    if (before?.killed === true)
      throw conflict('killed', `${m.name} is killed in ${m.env}; restore it first`);
    if (before?.version === m.version)
      return this.result(m.action, m.env, before.remote, before.version, false, [], m.fromEnv);
    const suffix = `/${artifactPrefix(m.name, m.version)}/mf-manifest.json`;
    if (!m.record.manifestUrl.endsWith(suffix))
      throw conflict('version_missing', `${m.name}@${m.version} has an unusable manifest URL`);
    const base = m.record.manifestUrl.slice(0, -suffix.length);
    const shell = await this.shellManifest(base, m.env);
    const at = this.now().toISOString();
    const built = buildIndex({
      remote: mfeOf(m.record, m.origin),
      version: m.version,
      manifest: m.record.manifest,
      files: {},
      env: m.env,
      baseUrl: base,
      ...(state === undefined ? {} : { currentIndex: indexOf(state) }),
      ...(shell.manifest === undefined ? {} : { shellManifest: shell.manifest }),
      generatedAt: at,
    });
    // No files were read, so size was not measured: that gate's failure is not a verdict.
    const gates = built.failures.filter((f) => f.code !== 'budget');
    const blocking = m.force ? [] : gates;
    if (blocking.length > 0)
      throw new ApiError(
        422,
        'gates_failed',
        `${m.name}@${m.version} was refused: ${blocking.map((f) => f.message).join('; ')}`,
        failuresOf(blocking),
      );
    const warnings = [...shell.warnings, ...built.warnings];
    if (gates.length > 0) {
      const invalid = validateRegistryIndex(built.index).filter((i) => i.code !== ROUTE_OVERLAP);
      if (invalid.length > 0)
        throw new ApiError(
          422,
          'invalid_index',
          `even force cannot write an invalid index: ${invalid.map((i) => `${i.path} ${i.message}`).join('; ')}`,
        );
      warnings.push(
        `FORCED: skipped ${String(gates.length)} failed check(s): ${gates.map((f) => f.message).join(' | ')}`,
      );
    }
    const remote = built.index.remotes.find((r) => r.name === m.name);
    if (remote === undefined) throw new ApiError(500, 'internal_error', 'index has no remote');
    const copy: VersionRecord = { ...m.record, env: m.env };
    await this.commit(
      {
        env: m.env,
        expectedRev: state?.rev ?? 0,
        at,
        versions: m.fromEnv === undefined ? [] : [copy],
        pointer: { name: m.name, version: m.version, remote, killed: false },
        audit: {
          at,
          tokenId: actor,
          action: m.action,
          env: m.env,
          remote: m.name,
          before: before?.version ?? null,
          after: m.version,
          detail: {
            ...(m.fromEnv === undefined ? {} : { fromEnv: m.fromEnv }),
            ...(m.force ? { forced: true } : {}),
          },
        },
      },
      { seen: before },
    );
    return this.result(m.action, m.env, remote, before?.version, true, warnings, m.fromEnv);
  }

  private result(
    _action: string,
    env: string,
    remote: RegistryIndexRemote,
    servedBefore: string | undefined,
    changed: boolean,
    warnings: string[],
    fromEnv?: string,
  ): MoveResult {
    return {
      ok: true,
      changed,
      env,
      ...(fromEnv === undefined ? {} : { fromEnv }),
      remote: remote.name,
      version: remote.version ?? '',
      servedBefore: servedBefore ?? null,
      previous: remote.previous ?? null,
      rolledBackFrom: remote.rolledBackFrom ?? null,
      warnings,
    };
  }

  private async commit(
    change: Parameters<RegistryStorage['commit']>[0],
    retry?: { seen: PointerRecord | undefined },
  ): Promise<void> {
    try {
      await this.storage.commit(change);
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      if (retry !== undefined) {
        const fresh = (await this.storage.readEnv(change.env))?.remotes.find(
          (r) => r.name === change.pointer.name,
        );
        if (JSON.stringify(fresh) === JSON.stringify(retry.seen)) throw new RetryOperation();
      }
      throw conflict('conflict', error.message);
    }
    this.options.onChange?.(change.env);
  }

  private async fetchVersion(
    base: string,
    prefix: string,
  ): Promise<{ manifest: unknown; manifestBytes: Uint8Array; files: Record<string, Uint8Array> }> {
    const artifacts = this.options.artifacts;
    if (artifacts === undefined)
      throw new ApiError(503, 'not_configured', 'deploy is off: no artifact reader');
    const missing = (what: string): ApiError =>
      new ApiError(422, 'artifact_missing', `${prefix}: ${what}`);
    const budget = { left: DEPLOY_READ_BUDGET };
    const manifestBytes = await this.readArtifact(
      artifacts,
      artifactUrl(base, `${prefix}/mf-manifest.json`),
      budget,
    );
    if (manifestBytes === undefined) throw missing('mf-manifest.json is not on the artifact host');
    const manifest = parseJson(manifestBytes);
    if (manifest === undefined) throw missing('mf-manifest.json is not valid JSON');
    const dist = remoteDistFiles(manifest);
    const files: Record<string, Uint8Array> = {};
    if (dist === undefined) return { manifest, manifestBytes, files };
    const wanted = [...new Set([dist.entry, ...Object.values(dist.exposes).flat()])];
    if (wanted.length > MAX_FILES) throw missing(`more than ${String(MAX_FILES)} first-load files`);
    const unsafe = wanted.filter((f) => !isPortableRelativePath(f) || /[?#%]/.test(f));
    if (unsafe.length > 0)
      throw new ApiError(
        422,
        'artifact_invalid',
        `${prefix}: mf-manifest.json names files that are not plain relative paths`,
      );
    const gone: string[] = [];
    for (const file of wanted) {
      // oxlint-disable-next-line no-await-in-loop -- a handful of files
      const bytes = await this.readArtifact(
        artifacts,
        artifactUrl(base, `${prefix}/${file}`),
        budget,
      );
      if (bytes === undefined) gone.push(file);
      else files[file] = bytes;
    }
    if (gone.length > 0)
      throw missing(
        `${gone.slice(0, 5).join(', ')}${gone.length > 5 ? ' and more' : ''} not on the artifact host`,
      );
    return { manifest, manifestBytes, files };
  }

  private async readArtifact(
    artifacts: ArtifactSource,
    url: string,
    budget: { left: number },
  ): Promise<Uint8Array | undefined> {
    try {
      const bytes = await artifacts.get(url, { maxBytes: budget.left });
      budget.left -= bytes?.byteLength ?? 0;
      return bytes;
    } catch (error) {
      if (error instanceof ArtifactTooLargeError)
        throw new ApiError(
          422,
          'artifact_too_large',
          'the artifact files are over the size the server will read for one deploy',
        );
      this.options.log?.(
        'warn',
        `could not read ${url}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new ApiError(
        502,
        'artifact_unreachable',
        'could not read the artifact host; see the server log',
      );
    }
  }

  private async shellManifest(
    base: string,
    env: string,
  ): Promise<{ manifest?: unknown; warnings: string[] }> {
    const artifacts = this.options.artifacts;
    if (artifacts === undefined) return { warnings: [] };
    const key = `envs/${env}/shell/mf-manifest.json`;
    let bytes: Uint8Array | undefined;
    try {
      bytes = await artifacts.get(artifactUrl(base, key), { maxBytes: 1024 * 1024 });
    } catch {
      return { warnings: [`the shell manifest ${key} could not be read; compat was not checked`] };
    }
    if (bytes === undefined)
      return { warnings: [`no shell manifest at ${key}; compat was not checked`] };
    const manifest = parseJson(bytes);
    if (manifest === undefined)
      return { warnings: [`${key} is not valid JSON; compat was not checked`] };
    return { manifest, warnings: [] };
  }
}
