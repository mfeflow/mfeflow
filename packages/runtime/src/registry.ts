import { registerRemotes } from '@module-federation/enhanced/runtime';
import { reportRemoteError } from './report.js';

export interface RegistryRemote {
  /** Module Federation name, e.g. `cart`. */
  name: string;
  /** `mf-manifest.json` (or remote entry) URL of the version to load. */
  entry: string;
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
}

/** Fetches and validates the registry index. Throws on HTTP errors, timeouts and invalid JSON. */
export async function loadRegistryIndex(
  url: string,
  options: LoadRegistryOptions = {},
): Promise<RegistryIndex> {
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 5000) });
  if (!res.ok) throw new Error(`registry index ${url}: HTTP ${String(res.status)}`);
  const body: unknown = await res.json();
  if (!isRegistryIndex(body)) throw new Error(`registry index ${url}: not a valid index`);
  return body;
}

export interface RegisterOptions {
  /** Only remotes whose entry URL starts with one of these origins are registered. */
  allowedOrigins?: readonly string[];
}

/**
 * Registers the index's remotes with Module Federation. Remotes from origins
 * outside `allowedOrigins` are skipped and reported. Returns the registered names.
 */
export function registerRemotesFromIndex(
  index: RegistryIndex,
  options: RegisterOptions = {},
): string[] {
  const allowed = options.allowedOrigins?.map((o) => new URL(o).origin);
  const ok: RegistryRemote[] = [];
  for (const remote of index.remotes) {
    let origin: string;
    try {
      origin = new URL(remote.entry).origin;
    } catch {
      reportRemoteError(remote.name, 'registry', new Error(`invalid entry URL "${remote.entry}"`));
      continue;
    }
    if (allowed && !allowed.includes(origin)) {
      reportRemoteError(remote.name, 'registry', new Error(`origin ${origin} is not allowed`));
      continue;
    }
    ok.push(remote);
  }
  registerRemotes(ok.map((r) => ({ name: r.name, entry: r.entry })));
  return ok.map((r) => r.name);
}
