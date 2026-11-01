import {
  isRegistryIndexRemote,
  pickRegistryFields,
  registryRemoteIssues,
  type RegistryIndex,
  type RegistryIndexRemote,
} from '@mfeflow/contracts/entry';
import { registerRemotes } from '@module-federation/enhanced/runtime';
import { rememberRemoteVersions, reportRemoteError } from './report';
import { fetchRuntimeConfig, RUNTIME_CONFIG_KEY, type RuntimeConfigValues } from './runtime-config';

export type RegistryRemote = RegistryIndexRemote;
export type { RegistryIndex };

/** Set by the shell build (`@mfeflow/rsbuild`): false when it shipped without the manifest loader. */
// oxlint-disable-next-line no-underscore-dangle -- a bundler define, named like one
declare const __MFEFLOW_SNAPSHOT__: boolean | undefined;

/** Reported for a registry entry that has only a manifest URL in a shell built without the manifest loader. */
export const NO_REMOTE_ENTRY = 'MFE_NO_REMOTE_ENTRY';

function builtWithSnapshot(): boolean {
  return typeof __MFEFLOW_SNAPSHOT__ === 'boolean' ? __MFEFLOW_SNAPSHOT__ : true;
}

/** The first field of a registry remote that is wrong, or undefined when it is valid. The shell never reads `exposes`. */
function remoteProblem(value: unknown): string | undefined {
  const first = registryRemoteIssues(value).find((issue) => !issue.path.startsWith('exposes'));
  if (first === undefined) return undefined;
  return first.path === '' ? 'not an object' : (first.path.split(/[.[]/)[0] ?? first.path);
}

/** True for a valid registry remote. */
export const isRegistryRemote = isRegistryIndexRemote;

/**
 * True for a registry index envelope (what the shell fetches at boot). Remotes
 * are checked one by one in `loadRegistryIndex`, so one bad remote does not
 * take the others down.
 */
export function isRegistryIndex(value: unknown): value is RegistryIndex {
  return (
    typeof value === 'object' &&
    value !== null &&
    'remotes' in value &&
    Array.isArray(value.remotes)
  );
}

/** Reported for a registry remote that is skipped because a field is invalid. */
export const INVALID_REMOTE = 'MFE_INVALID_REMOTE';

/** The index without its invalid remotes, each reported once. The same object when all are valid. */
function withoutInvalidRemotes(index: RegistryIndex): RegistryIndex {
  const remotes = index.remotes.filter((remote) => {
    const problem = remoteProblem(remote);
    if (problem === undefined) return true;
    const name = typeof remote?.name === 'string' ? remote.name : '(unnamed)';
    reportRemoteError(
      name,
      'registry',
      new Error(`${INVALID_REMOTE}: "${name}" is skipped, its ${problem} is invalid`),
    );
    return false;
  });
  return remotes.length === index.remotes.length ? index : { ...index, remotes };
}

export interface LoadRegistryOptions {
  /** The whole time budget for all URLs together, in ms. Default 5000. */
  timeoutMs?: number;
  /** How long each URL except the last gets, in ms. The last one gets what is left. Default 1500. */
  primaryTimeoutMs?: number;
  fetch?: typeof fetch;
  /** Use an index the server or edge inlined as `window.__MFE_REGISTRY__`. Default true. */
  inline?: boolean;
  /** Origins other than the page's that an index URL may be on. */
  allowedOrigins?: readonly string[];
  /** Allow any origin for the index URLs. Default false; prefer `allowedOrigins`. */
  allowCrossOrigin?: boolean;
}

/**
 * Global the server or CDN edge writes into the shell's HTML (see
 * `registryInjection` in `@mfeflow/contracts`), so the shell registers remotes
 * without another request.
 */
export const REGISTRY_GLOBAL = '__MFE_REGISTRY__';

export const DEFAULT_REGISTRY_URL = '/registry/index.json';

/** Reported once when the primary index failed and a later URL served the shell. */
export const REGISTRY_FALLBACK = 'MFE_REGISTRY_FALLBACK';

function originOf(url: string): string | undefined {
  try {
    return new URL(url, typeof location === 'undefined' ? undefined : location.href).origin;
  } catch {
    return undefined;
  }
}

function originAllowed(url: string, options: LoadRegistryOptions): boolean {
  if (options.allowCrossOrigin === true) return true;
  const origin = originOf(url);
  if (origin === undefined) return false;
  if (typeof location === 'undefined' || origin === location.origin) return true;
  return (options.allowedOrigins ?? []).some((allowed) => originOf(allowed) === origin);
}

async function fetchIndex(
  url: string,
  timeoutMs: number,
  options: LoadRegistryOptions,
): Promise<RegistryIndex> {
  if (!originAllowed(url, options))
    throw new Error(`registry index ${url}: must be same-origin or in allowedOrigins`);
  const doFetch = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await doFetch(url, { signal });
  } catch (error) {
    if (signal.aborted)
      throw new Error(`registry index ${url}: timed out after ${String(timeoutMs)} ms`, {
        cause: error,
      });
    throw new Error(
      `registry index ${url}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (res.redirected && !originAllowed(res.url, options))
    throw new Error(`registry index ${url}: redirected to ${res.url}, which is not allowed`);
  if (!res.ok) throw new Error(`registry index ${url}: HTTP ${String(res.status)}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`registry index ${url}: not valid JSON`);
  }
  if (!isRegistryIndex(body)) throw new Error(`registry index ${url}: not a valid index`);
  return body;
}

/**
 * Reads the registry index: `window.__MFE_REGISTRY__` when the edge inlined it,
 * otherwise the first of `source` (one URL or an ordered list, primary first)
 * that answers. A 5xx, network error, timeout, non-JSON body, invalid envelope
 * or disallowed origin moves on to the next URL; each URL except the last gets
 * `primaryTimeoutMs`, the last gets the rest of `timeoutMs`. Each URL must be on
 * the page's origin or in `allowedOrigins`. Falling back is reported once
 * (`MFE_REGISTRY_FALLBACK`). Throws when every URL fails. A remote with an
 * invalid field is skipped and reported (`MFE_INVALID_REMOTE`); the valid ones stay.
 */
export async function loadRegistryIndex(
  source: string | readonly string[] = DEFAULT_REGISTRY_URL,
  options: LoadRegistryOptions = {},
): Promise<RegistryIndex> {
  const inlined: unknown = Reflect.get(globalThis, REGISTRY_GLOBAL);
  if (options.inline !== false && isRegistryIndex(inlined)) return withoutInvalidRemotes(inlined);
  const urls = typeof source === 'string' ? [source] : source;
  if (urls.length === 0) throw new Error('registry index: no URL given');
  const budget = options.timeoutMs ?? 5000;
  const primaryMs = options.primaryTimeoutMs ?? 1500;
  const started = Date.now();
  const failures: Error[] = [];
  for (const [position, url] of urls.entries()) {
    const remaining = budget - (Date.now() - started);
    if (remaining <= 0) {
      failures.push(new Error(`registry index ${url}: no time left`));
      continue;
    }
    const timeoutMs = position === urls.length - 1 ? remaining : Math.min(primaryMs, remaining);
    try {
      // oxlint-disable-next-line no-await-in-loop -- the fallback only runs after the primary failed
      const index = await fetchIndex(url, timeoutMs, options);
      const [first] = failures;
      if (first !== undefined)
        reportRemoteError(
          'registry',
          'registry',
          new Error(`${REGISTRY_FALLBACK}: ${first.message}; using ${url}`),
        );
      return withoutInvalidRemotes(index);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  const [only] = failures;
  if (failures.length === 1 && only !== undefined) throw only;
  throw new Error(
    `registry index: every source failed (${failures.map((e) => e.message).join('; ')})`,
  );
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];

/**
 * The index URLs and extra allowed origins from the shell's runtime config:
 * `registryUrls` (primary first) and `registryOrigins`. Without them it is the
 * default same-origin URL and no extra origins.
 */
export function registrySourcesFromConfig(config: RuntimeConfigValues): RegistrySources {
  const urls = strings(config.registryUrls);
  const allowedOrigins = strings(config.registryOrigins).flatMap((o) => {
    const url = URL.canParse(o) ? new URL(o) : undefined;
    return url?.protocol === 'https:' || url?.protocol === 'http:' ? url.origin : [];
  });
  return { urls: urls.length > 0 ? urls : [DEFAULT_REGISTRY_URL], allowedOrigins };
}

export interface RegistrySources {
  urls: string[];
  allowedOrigins: string[];
}

/**
 * Where the shell loads the registry from, without holding up boot. An inlined runtime config is
 * used as is. When the index is inlined nothing is fetched (inline the runtime config too if its
 * remotes live on another origin). Otherwise the config file is used if it answers within
 * `waitMs`; past that, or when it fails, the same-origin default.
 */
export async function registrySources(waitMs = 1500): Promise<RegistrySources> {
  const configInlined = Reflect.has(globalThis, RUNTIME_CONFIG_KEY);
  if (!configInlined && isRegistryIndex(Reflect.get(globalThis, REGISTRY_GLOBAL)))
    return registrySourcesFromConfig({});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<RuntimeConfigValues>((resolve) => {
    timer = setTimeout(() => resolve({}), waitMs);
  });
  const config = await Promise.race([fetchRuntimeConfig().catch(() => ({})), late]);
  clearTimeout(timer);
  return registrySourcesFromConfig(config);
}

function toMfRemote(r: RegistryRemote) {
  if (r.remoteEntry === undefined) return { name: r.name, entry: r.entry };
  return {
    name: r.name,
    entry: r.remoteEntry,
    ...(r.type === undefined ? {} : { type: r.type }),
    ...(r.entryGlobalName === undefined ? {} : { entryGlobalName: r.entryGlobalName }),
  };
}

let registered: RegistryRemote[] = [];

/** Remotes registered by the last `registerRemotesFromIndex` call (for the dev overlay). */
export function registeredRemotes(): readonly RegistryRemote[] {
  return registered;
}

export interface RegisterOptions {
  /** Only remotes whose registered URL (`remoteEntry`, else `entry`) is on one of these origins are registered. */
  allowedOrigins?: readonly string[];
  /** Whether the shell can load a manifest URL. Default: what the shell build set. */
  snapshot?: boolean;
}

/**
 * Registers the index's remotes with Module Federation, by remote entry URL
 * when the index has one. Call it once the shell's shared scope is set up
 * (after the app entry runs, never from the build config), so Module Federation
 * does not load every remote's entry while resolving shared modules.
 * Remotes from origins outside `allowedOrigins` are skipped and reported.
 * Returns the registered names.
 */
export function registerRemotesFromIndex(
  index: RegistryIndex,
  options: RegisterOptions = {},
): string[] {
  const allowed = options.allowedOrigins?.map((o) => new URL(o).origin);
  const snapshot = options.snapshot ?? builtWithSnapshot();
  const ok: RegistryRemote[] = [];
  for (const remote of index.remotes) {
    if (!snapshot && remote.remoteEntry === undefined) {
      reportRemoteError(
        remote.name,
        'registry',
        new Error(
          `${NO_REMOTE_ENTRY}: "${remote.name}" has only a manifest URL (${remote.entry}) and this shell was built without the manifest loader; publish its remoteEntry or build the shell with snapshot: true`,
        ),
      );
      continue;
    }
    const url = remote.remoteEntry ?? remote.entry;
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      reportRemoteError(remote.name, 'registry', new Error(`invalid entry URL "${url}"`));
      continue;
    }
    if (allowed && !allowed.includes(origin)) {
      reportRemoteError(remote.name, 'registry', new Error(`origin ${origin} is not allowed`));
      continue;
    }
    ok.push(remote);
  }
  registerRemotes(ok.map(toMfRemote));
  rememberRemoteVersions(ok);
  registered = ok.map((r) => pickRegistryFields(r));
  return ok.map((r) => r.name);
}
