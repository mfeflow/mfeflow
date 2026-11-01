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

const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

/** A Module Federation name that is also safe as a plain object key. */
export const isRemoteName = (value: string): boolean =>
  GLOBAL_NAME.test(value) && !RESERVED_NAMES.has(value);

export const ROUTE = /^\/[A-Za-z0-9/_:*.-]*$/;
export const EXPOSE = /^\.\/[A-Za-z0-9_/-]+$/;

/** One remote of the registry index, the shape the shell, the edge, the CLI and the dev registry share. */
export interface RegistryIndexRemote {
  /** Module Federation name. */
  name: string;
  /** `mf-manifest.json` URL. */
  entry: string;
  /** Entry script URL; shells register it in place of `entry` when present. */
  remoteEntry?: string;
  /** How `remoteEntry` loads (`module` for ESM). */
  type?: string;
  /** The global `remoteEntry` defines when it differs from `name`. */
  entryGlobalName?: string;
  /** Per expose (`./App`), the files to preload. Not inlined into the shell's HTML. */
  exposes?: Record<string, string[]>;
  version?: string;
  routes?: string[];
  owner?: string;
  /** The version served before `version`; what a rollback returns to. */
  previous?: string;
  /** Older versions served, newest first and bounded. */
  history?: string[];
  /** Set after a rollback: the version that was served and was moved away from. Never a rollback target. */
  rolledBackFrom?: string;
}

/** What the shell fetches at boot. */
export interface RegistryIndex {
  shell?: string;
  env?: string;
  generatedAt?: string;
  remotes: RegistryIndexRemote[];
}

export interface RegistryIssue {
  /** Relative to the value checked, e.g. `type` or `exposes./App[0]`. */
  path: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function stringField(
  obj: Record<string, unknown>,
  key: string,
  out: RegistryIssue[],
  check?: { test: (value: string) => boolean; hint: string },
  required = false,
): void {
  const value = obj[key];
  if (value === undefined) {
    if (required) out.push({ path: key, message: 'is required' });
  } else if (typeof value !== 'string') out.push({ path: key, message: 'must be a string' });
  else if (check && !check.test(value)) out.push({ path: key, message: check.hint });
}

const URL_CHECK = { test: isHttpUrl, hint: 'must be an http(s) URL' };

/** Problems with the entry script fields a registry entry and an index remote share. */
export function remoteFileIssues(obj: Record<string, unknown>): RegistryIssue[] {
  const out: RegistryIssue[] = [];
  stringField(obj, 'remoteEntry', out, URL_CHECK);
  stringField(obj, 'type', out, {
    test: (value) => ENTRY_TYPES.includes(value),
    hint: `must be a Module Federation entry type: ${ENTRY_TYPES.join(', ')}`,
  });
  stringField(obj, 'entryGlobalName', out, {
    test: (value) => GLOBAL_NAME.test(value),
    hint: 'must be a JavaScript global name (letters, digits, _, $, -; not starting with a digit)',
  });
  const exposes = obj.exposes;
  if (exposes === undefined) return out;
  if (!isRecord(exposes)) return [...out, { path: 'exposes', message: 'must be an object' }];
  for (const [expose, files] of Object.entries(exposes)) {
    const at = `exposes.${expose}`;
    if (!EXPOSE.test(expose)) out.push({ path: at, message: 'must look like "./App"' });
    if (!Array.isArray(files)) {
      out.push({ path: at, message: 'must be an array of URLs' });
      continue;
    }
    files.forEach((file: unknown, i) => {
      if (typeof file !== 'string' || !isHttpUrl(file))
        out.push({ path: `${at}[${String(i)}]`, message: 'must be an http(s) URL' });
    });
  }
  return out;
}

/** Every problem with one registry index remote; empty when it is valid. Browser-safe: the shell runs it. */
export function registryRemoteIssues(value: unknown): RegistryIssue[] {
  if (!isRecord(value)) return [{ path: '', message: 'must be an object' }];
  const out: RegistryIssue[] = [];
  stringField(
    value,
    'name',
    out,
    { test: isRemoteName, hint: 'must be a Module Federation name' },
    true,
  );
  stringField(value, 'entry', out, URL_CHECK, true);
  stringField(value, 'version', out);
  stringField(value, 'owner', out);
  stringField(value, 'previous', out);
  stringField(value, 'rolledBackFrom', out);
  const history = value.history;
  if (history !== undefined) {
    if (!Array.isArray(history))
      out.push({ path: 'history', message: 'must be an array of strings' });
    else
      history.forEach((version: unknown, i) => {
        if (typeof version !== 'string')
          out.push({ path: `history[${String(i)}]`, message: 'must be a string' });
      });
  }
  const routes = value.routes;
  if (routes !== undefined) {
    if (!Array.isArray(routes))
      out.push({ path: 'routes', message: 'must be an array of strings' });
    else
      routes.forEach((route: unknown, i) => {
        const at = `routes[${String(i)}]`;
        if (typeof route !== 'string') out.push({ path: at, message: 'must be a string' });
        else if (!ROUTE.test(route)) out.push({ path: at, message: 'must start with "/"' });
      });
  }
  return [...out, ...remoteFileIssues(value)];
}

export function isRegistryIndexRemote(value: unknown): value is RegistryIndexRemote {
  return registryRemoteIssues(value).length === 0;
}

/** The registry remote fields the shell and the edge read; everything else is dropped. */
export const REGISTRY_REMOTE_FIELDS: readonly string[] = [
  'name',
  'entry',
  'remoteEntry',
  'type',
  'entryGlobalName',
  'exposes',
  'version',
  'owner',
  'routes',
  'previous',
  'history',
  'rolledBackFrom',
];

/** A copy of `remote` with only the whitelisted fields that are set. */
export function pickRegistryFields<T extends object>(remote: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(remote))
    if (value !== undefined && REGISTRY_REMOTE_FIELDS.includes(key)) out[key] = value;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a subset of T's own optional fields
  return out as T;
}
