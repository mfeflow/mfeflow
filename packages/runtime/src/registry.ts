import { registerRemotes } from '@module-federation/enhanced/runtime';
import { reportRemoteError } from './report.js';

export interface RegistryRemote {
  /** Module Federation name, e.g. `cart`. */
  name: string;
  /** `mf-manifest.json` URL of the version to load. Used when `remoteEntry` is absent. */
  entry: string;
  /**
   * The remote's entry script. Registered in place of the manifest in
   * production, so the shell fetches no manifest and ships no snapshot code.
   */
  remoteEntry?: string;
  version?: string;
  routes?: string[];
  owner?: string;
}

export interface RegistryIndex {
  shell?: string;
  env?: string;
  generatedAt?: string;
  remotes: RegistryRemote[];
}

const NAME = /^[A-Za-z_$][\w$-]*$/;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isRemote(value: unknown): value is RegistryRemote {
  if (typeof value !== 'object' || value === null) return false;
  if (!('name' in value) || !('entry' in value)) return false;
  if (typeof value.name !== 'string' || !NAME.test(value.name) || typeof value.entry !== 'string')
    return false;
  if ('remoteEntry' in value && typeof value.remoteEntry !== 'string') return false;
  if ('version' in value && typeof value.version !== 'string') return false;
  if ('owner' in value && typeof value.owner !== 'string') return false;
  if ('routes' in value && !isStringArray(value.routes)) return false;
  return true;
}

/** True for a valid registry index (what the shell fetches at boot). */
export function isRegistryIndex(value: unknown): value is RegistryIndex {
  return (
    typeof value === 'object' &&
    value !== null &&
    'remotes' in value &&
    Array.isArray(value.remotes) &&
    value.remotes.every(isRemote)
  );
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
 * and cross-origin URLs.
 */
export async function loadRegistryIndex(
  url: string = DEFAULT_REGISTRY_URL,
  options: LoadRegistryOptions = {},
): Promise<RegistryIndex> {
  const inlined: unknown = Reflect.get(globalThis, REGISTRY_GLOBAL);
  if (options.inline !== false && isRegistryIndex(inlined)) return inlined;
  if (options.allowCrossOrigin !== true && !sameOrigin(url))
    throw new Error(`registry index ${url}: must be same-origin`);
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 5000) });
  if (!res.ok) throw new Error(`registry index ${url}: HTTP ${String(res.status)}`);
  const body: unknown = await res.json();
  if (!isRegistryIndex(body)) throw new Error(`registry index ${url}: not a valid index`);
  return body;
}

let registered: RegistryRemote[] = [];

/** Remotes registered by the last `registerRemotesFromIndex` call (for the dev overlay). */
export function registeredRemotes(): readonly RegistryRemote[] {
  return registered;
}

export interface RegisterOptions {
  /** Only remotes whose registered URL (`remoteEntry`, else `entry`) is on one of these origins are registered. */
  allowedOrigins?: readonly string[];
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
  const ok: RegistryRemote[] = [];
  for (const remote of index.remotes) {
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
  registerRemotes(ok.map((r) => ({ name: r.name, entry: r.remoteEntry ?? r.entry })));
  registered = [...ok];
  return ok.map((r) => r.name);
}
