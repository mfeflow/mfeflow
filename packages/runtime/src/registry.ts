import {
  isRegistryIndexRemote,
  pickRegistryFields,
  registryRemoteIssues,
  type RegistryIndex,
  type RegistryIndexRemote,
} from '@mfeflow/contracts/entry';
import { registerRemotes } from '@module-federation/enhanced/runtime';
import { reportRemoteError } from './report';

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

/** The first field of a registry remote that is wrong, or undefined when it is valid. */
function remoteProblem(value: unknown): string | undefined {
  const [first] = registryRemoteIssues(value);
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
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Use an index the server or edge inlined as `window.__MFE_REGISTRY__`. Default true. */
  inline?: boolean;
  /** Allow the fallback fetch to leave the page's origin. Default false. */
  allowCrossOrigin?: boolean;
}

/**
 * Global the server or CDN edge writes into the shell's HTML (see
 * `registryInjection` in `@mfeflow/contracts`), so the shell registers remotes
 * without another request.
 */
export const REGISTRY_GLOBAL = '__MFE_REGISTRY__';

export const DEFAULT_REGISTRY_URL = '/registry/index.json';

function sameOrigin(url: string): boolean {
  if (typeof location === 'undefined') return true;
  return new URL(url, location.href).origin === location.origin;
}

/**
 * Reads the registry index: `window.__MFE_REGISTRY__` when the edge inlined it,
 * otherwise a same-origin fetch. Throws on HTTP errors, timeouts, invalid JSON
 * and cross-origin URLs. A remote with an invalid field is skipped and reported
 * (`MFE_INVALID_REMOTE`); the valid ones stay.
 */
export async function loadRegistryIndex(
  url: string = DEFAULT_REGISTRY_URL,
  options: LoadRegistryOptions = {},
): Promise<RegistryIndex> {
  const inlined: unknown = Reflect.get(globalThis, REGISTRY_GLOBAL);
  if (options.inline !== false && isRegistryIndex(inlined)) return withoutInvalidRemotes(inlined);
  if (options.allowCrossOrigin !== true && !sameOrigin(url))
    throw new Error(`registry index ${url}: must be same-origin`);
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 5000) });
  if (!res.ok) throw new Error(`registry index ${url}: HTTP ${String(res.status)}`);
  const body: unknown = await res.json();
  if (!isRegistryIndex(body)) throw new Error(`registry index ${url}: not a valid index`);
  return withoutInvalidRemotes(body);
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
  registered = ok.map((r) => pickRegistryFields(r));
  return ok.map((r) => r.name);
}
