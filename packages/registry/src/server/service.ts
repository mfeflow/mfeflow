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
import {
  RevisionConflictError,
  type AuditEntry,
  type EnvState,
  type PointerRecord,
  type RegistryStorage,
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
  if (extra.includes('rollout'))
    throw bad('rollout is not available yet: this server serves the current pointer only');
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

  /** What `GET /v1/index/:env` serves: the current pointers, killed remotes left out. */
  async index(env: string): Promise<RegistryIndex | undefined> {
    const state = await this.storage.readEnv(env);
    return state === undefined ? undefined : indexOf(state);
  }

  /** What the static fallback holds. Rollout candidates, once they exist, never go in it. */
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
  private async retrying(run: () => Promise<MoveResult>): Promise<MoveResult> {
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
    ]);
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
    if (current?.version === version && existing !== undefined)
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
