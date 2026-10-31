import { reportRemoteError } from './report.js';
import type { RegistryIndex } from './registry.js';

export interface DevOverrideOptions {
  /** Must be explicitly true, e.g. `import.meta.env.DEV` or a staging flag. Never on in production. */
  enabled: boolean;
  /** Hostnames overrides may point at. Default `localhost` and `127.0.0.1` (any port). */
  allowedHosts?: readonly string[];
  /** Defaults to `location.search`. */
  search?: string;
  /** Where overrides persist across navigations. Defaults to `sessionStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export const OVERRIDE_PARAM = 'mfe-override';
export const OVERRIDE_STORAGE_KEY = 'shell:mfe-overrides';

function parse(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(',')) {
    const at = part.indexOf('@');
    if (at <= 0) continue;
    out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

/**
 * Points chosen remotes at local or preview builds without touching the
 * registry: `?mfe-override=cart@http://localhost:4312/mf-manifest.json`
 * (comma-separate several). Overrides persist for the session;
 * `?mfe-override=reset` clears them. Only allowlisted hosts are accepted.
 */
export function applyDevOverrides(
  index: RegistryIndex,
  options: DevOverrideOptions,
): RegistryIndex {
  if (!options.enabled) return index;
  const storage =
    options.storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const search = options.search ?? (typeof location === 'undefined' ? '' : location.search);
  const hosts = options.allowedHosts ?? ['localhost', '127.0.0.1'];
  const param = new URLSearchParams(search).get(OVERRIDE_PARAM);

  let overrides: Record<string, string> = {};
  if (param === 'reset') {
    storage?.removeItem(OVERRIDE_STORAGE_KEY);
  } else {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(OVERRIDE_STORAGE_KEY) ?? '{}');
      if (isRecordOfStrings(saved)) overrides = saved;
    } catch {
      // ignore corrupt storage
    }
    if (param) overrides = { ...overrides, ...parse(param) };
  }

  const accepted: Record<string, string> = {};
  for (const [name, entry] of Object.entries(overrides)) {
    let host: string;
    try {
      host = new URL(entry).hostname;
    } catch {
      reportRemoteError(name, 'override', new Error(`invalid override URL "${entry}"`));
      continue;
    }
    if (!hosts.includes(host)) {
      reportRemoteError(name, 'override', new Error(`override host ${host} is not allowed`));
      continue;
    }
    accepted[name] = entry;
  }
  if (Object.keys(accepted).length > 0)
    storage?.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(accepted));

  const known = new Set(index.remotes.map((r) => r.name));
  const remotes = index.remotes.map((r) => {
    const entry = accepted[r.name];
    return entry === undefined ? r : { ...r, entry, version: 'override' };
  });
  for (const [name, entry] of Object.entries(accepted)) {
    if (!known.has(name)) remotes.push({ name, entry, version: 'override' });
  }
  return { ...index, remotes };
}
