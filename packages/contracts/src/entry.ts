// Shared by the registry validators here and the shell runtime. Keep this file free of imports:
// it ships to the browser as `@mfeflow/contracts/entry`.

/** The remote entry types Module Federation loads (`RemoteEntryType` in its sdk, plus `esm`). */
export const ENTRY_TYPES: readonly string[] = [
  'var',
  'module',
  'esm',
  'assign',
  'assign-properties',
  'this',
  'window',
  'self',
  'global',
  'commonjs',
  'commonjs2',
  'commonjs-module',
  'commonjs-static',
  'amd',
  'amd-require',
  'umd',
  'umd2',
  'jsonp',
  'system',
];

/**
 * A global Module Federation can name a remote entry's container: a JS-style identifier that may
 * also hold `-`, as the `globalName` in `mf-manifest.json` does for a remote like `my-app`.
 */
export const GLOBAL_NAME = /^[A-Za-z_$][\w$-]*$/;

/** The registry remote fields the shell and the edge read; everything else is dropped. */
export const REGISTRY_REMOTE_FIELDS: readonly string[] = [
  'name',
  'entry',
  'remoteEntry',
  'type',
  'entryGlobalName',
  'version',
  'owner',
  'routes',
];

/** A copy of `remote` with only the whitelisted fields that are set. */
export function pickRegistryFields<T extends object>(remote: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(remote))
    if (value !== undefined && REGISTRY_REMOTE_FIELDS.includes(key)) out[key] = value;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a subset of T's own optional fields
  return out as T;
}
