import { Checker, isObj, isUrl, type Issue, type Obj } from './validate.js';
import { EXPOSE, MFE_NAME, ROUTE } from './mfe-manifest.js';

/** `registry/envs/<env>/<name>.json`: what one remote serves in one environment. */
export interface RegistryEntry {
  version: string;
  manifestUrl: string;
  /** The remote's entry script, read from `mf-manifest.json` at publish time. Production shells register this, not the manifest. */
  remoteEntry?: string;
  /** How `remoteEntry` loads (`module` for ESM). Needed by shells that register it directly. */
  type?: string;
  /** The global `remoteEntry` defines when it differs from the remote's name. */
  entryGlobalName?: string;
  /** Per expose (`./App`), the JS and CSS files it needs before it renders. The edge turns these into preload hints. */
  exposes?: Record<string, string[]>;
  previous?: string;
  owner?: string;
  rollout?: { candidate: string; stable: string; percent: number };
}

/** What the shell fetches at boot. */
export interface RegistryIndex {
  shell?: string;
  env?: string;
  generatedAt?: string;
  remotes: RegistryIndexRemote[];
}

export interface RegistryIndexRemote {
  name: string;
  /** `mf-manifest.json` URL. */
  entry: string;
  /** Entry script URL; shells register it in place of `entry` when present. */
  remoteEntry?: string;
  /** How `remoteEntry` loads (`module` for ESM). */
  type?: string;
  /** The global `remoteEntry` defines when it differs from `name`. */
  entryGlobalName?: string;
  /** Per expose, the files to preload. Not inlined into the shell's HTML. */
  exposes?: Record<string, string[]>;
  version?: string;
  routes?: string[];
  owner?: string;
}

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
const ENTRY_TYPE = new RegExp(`^(?:${ENTRY_TYPES.join('|')})$`);

const VERSION = /^[0-9A-Za-z.+-]+$/;

function checkRemoteFiles(c: Checker, obj: Obj, at: string): void {
  const entry = c.string(obj, 'remoteEntry', at, { required: false });
  if (entry !== undefined && !isUrl(entry))
    c.add(at ? `${at}.remoteEntry` : 'remoteEntry', 'must be an http(s) URL');
  c.string(obj, 'type', at, {
    required: false,
    pattern: ENTRY_TYPE,
    hint: `must be a Module Federation entry type: ${ENTRY_TYPES.join(', ')}`,
  });
  c.string(obj, 'entryGlobalName', at, {
    required: false,
    pattern: MFE_NAME,
    hint: 'must be a Module Federation name (lowercase letters, digits, _)',
  });
  const exposes = c.object(obj, 'exposes', at, false);
  if (!exposes) return;
  const base = at ? `${at}.exposes` : 'exposes';
  for (const [expose, files] of Object.entries(exposes)) {
    if (!EXPOSE.test(expose)) c.add(`${base}.${expose}`, 'must look like "./App"');
    if (!Array.isArray(files)) {
      c.add(`${base}.${expose}`, 'must be an array of URLs');
      continue;
    }
    files.forEach((file: unknown, i) => {
      if (typeof file !== 'string' || !isUrl(file))
        c.add(`${base}.${expose}[${String(i)}]`, 'must be an http(s) URL');
    });
  }
}

export function validateRegistryEntry(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  c.string(value, 'version', '', {
    pattern: VERSION,
    hint: 'must be a version like 1.4.2+a1b2c3d',
  });
  const url = c.string(value, 'manifestUrl', '');
  if (url !== undefined && !isUrl(url)) c.add('manifestUrl', 'must be an http(s) URL');
  checkRemoteFiles(c, value, '');
  c.string(value, 'previous', '', { required: false, pattern: VERSION, hint: 'must be a version' });
  c.string(value, 'owner', '', { required: false });
  const rollout = c.object(value, 'rollout', '', false);
  if (rollout) {
    c.string(rollout, 'candidate', 'rollout', { pattern: VERSION, hint: 'must be a version' });
    c.string(rollout, 'stable', 'rollout', { pattern: VERSION, hint: 'must be a version' });
    c.number(rollout, 'percent', 'rollout', { min: 0, max: 100 });
  }
  return c.issues;
}

export function validateRegistryIndex(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  for (const key of ['shell', 'env', 'generatedAt']) c.string(value, key, '', { required: false });
  const remotes = value.remotes;
  if (!Array.isArray(remotes)) {
    c.add('remotes', 'must be an array');
    return c.issues;
  }
  const names = new Set<string>();
  const claimed = new Map<string, string>();
  remotes.forEach((remote: unknown, i) => {
    const at = `remotes[${String(i)}]`;
    if (!isObj(remote)) {
      c.add(at, 'must be an object');
      return;
    }
    const name = c.string(remote, 'name', at, {
      pattern: MFE_NAME,
      hint: 'must be a Module Federation name',
    });
    const entry = c.string(remote, 'entry', at);
    if (entry !== undefined && !isUrl(entry)) c.add(`${at}.entry`, 'must be an http(s) URL');
    checkRemoteFiles(c, remote, at);
    c.string(remote, 'version', at, { required: false });
    c.string(remote, 'owner', at, { required: false });
    const routes = c.stringArray(remote, 'routes', at, {
      required: false,
      pattern: ROUTE,
      hint: 'must start with "/"',
    });
    if (name !== undefined) {
      if (names.has(name)) c.add(`${at}.name`, `duplicate remote "${name}"`);
      names.add(name);
      for (const route of routes) {
        const owner = claimed.get(route);
        if (owner !== undefined && owner !== name)
          c.add(`${at}.routes`, `route "${route}" is already claimed by "${owner}"`);
        claimed.set(route, name);
      }
    }
  });
  return c.issues;
}

export function isRegistryEntry(value: unknown): value is RegistryEntry {
  return validateRegistryEntry(value).length === 0;
}

export function isRegistryIndex(value: unknown): value is RegistryIndex {
  return validateRegistryIndex(value).length === 0;
}
