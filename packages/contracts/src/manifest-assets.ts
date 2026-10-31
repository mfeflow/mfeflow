import { ENTRY_TYPES, GLOBAL_NAME } from './entry.js';
import { isObj, isUrl } from './validate.js';

/** What the registry needs from a built remote's `mf-manifest.json`. */
export interface RemoteAssets {
  /** Absolute URL of the remote's entry script. */
  remoteEntry: string;
  /** Per expose (`./App`), absolute URLs of the JS and CSS files it loads before it renders. */
  exposes: Record<string, string[]>;
  /** How the entry script is loaded (`module` for ESM). Absent when the manifest does not say. */
  type?: string;
  /** The global the entry script defines, when the manifest names one. */
  entryGlobalName?: string;
}

function fail(why: string): never {
  throw new Error(`mf-manifest.json: ${why}`);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Module Federation's `simpleJoinRemoteEntry` (sdk), so paths join exactly as its runtime joins them. */
function joinEntry(dir: string, name: string): string {
  if (dir === '') return name;
  let path = dir;
  if (path === '.') path = '';
  else if (path.startsWith('./')) path = path.slice(2);
  else if (path.startsWith('/')) {
    path = path.slice(1);
    if (path.endsWith('/')) path = path.slice(0, -1);
  }
  if (path === '') return name;
  return path.endsWith('/') ? `${path}${name}` : `${path}/${name}`;
}

/**
 * Where a manifest's files live: an absolute `publicPath` as is, `auto` or empty
 * as the manifest's own directory (the sdk's `inferAutoPublicPath`), a
 * root-relative or relative one resolved against the manifest URL.
 */
function publicBase(publicPath: string, manifestUrl: string): string {
  if (isUrl(publicPath)) return publicPath;
  if (publicPath === '' || publicPath === 'auto') return new URL('.', manifestUrl).href;
  return new URL(publicPath, manifestUrl).href;
}

function sync(assets: unknown, kind: 'js' | 'css'): string[] {
  const group = isObj(assets) ? assets[kind] : undefined;
  return isObj(group) ? strings(group.sync) : [];
}

/**
 * Reads the entry script and each expose's synchronous files out of a Module
 * Federation `mf-manifest.json`, resolved against where it is served from
 * (`manifestUrl`, or the manifest's absolute `publicPath`). Run at publish or
 * build time; the browser never parses a manifest. Throws on a manifest
 * without an entry, because a registry entry without one cannot be loaded.
 */
export function assetsFromManifest(manifest: unknown, manifestUrl: string): RemoteAssets {
  if (!isUrl(manifestUrl)) fail(`manifest URL "${manifestUrl}" is not an http(s) URL`);
  if (!isObj(manifest)) fail('must be an object');
  const meta = manifest.metaData;
  if (!isObj(meta)) fail('has no metaData');
  const entry = meta.remoteEntry;
  if (!isObj(entry) || typeof entry.name !== 'string' || entry.name === '')
    fail('metaData.remoteEntry has no name');
  const publicPath = typeof meta.publicPath === 'string' ? meta.publicPath : '';
  const base = publicBase(publicPath, manifestUrl);
  const at = (file: string) => new URL(file, base).href;
  const exposes: Record<string, string[]> = {};
  for (const expose of list(manifest.exposes)) {
    if (!isObj(expose) || typeof expose.path !== 'string') continue;
    const files = [...sync(expose.assets, 'css'), ...sync(expose.assets, 'js')];
    exposes[expose.path] = [...new Set(files)].map(at);
  }
  const entryPath = typeof entry.path === 'string' ? entry.path : '';
  const type = typeof entry.type === 'string' && entry.type !== '' ? entry.type : undefined;
  if (type !== undefined && !ENTRY_TYPES.includes(type))
    fail(`metaData.remoteEntry.type "${type}" is not a Module Federation entry type`);
  const globalName =
    typeof meta.globalName === 'string' && meta.globalName !== '' ? meta.globalName : undefined;
  if (globalName !== undefined && !GLOBAL_NAME.test(globalName))
    fail(`metaData.globalName "${globalName}" is not a valid global name`);
  return {
    remoteEntry: at(joinEntry(entryPath, entry.name)),
    exposes,
    ...(type === undefined ? {} : { type }),
    ...(globalName === undefined ? {} : { entryGlobalName: globalName }),
  };
}
