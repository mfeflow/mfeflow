import { ENTRY_TYPES, GLOBAL_NAME } from './entry.js';
import { isObj, isUrl } from './validate.js';

/** What the registry needs from a built remote's `mf-manifest.json`. */
export interface RemoteAssets {
  /**
   * URL of the remote's entry script: absolute, or exactly as Module Federation
   * builds it from a relative `publicPath` (see `assetsFromManifest`). Absent
   * when `manifestOnly` is set.
   */
  remoteEntry?: string;
  /** Per expose (`./App`), URLs of the JS and CSS files it loads before it renders. Empty when `manifestOnly` is set. */
  exposes: Record<string, string[]>;
  /**
   * Why the files' URLs cannot be known at publish time (`metaData.getPublicPath`
   * computes them in the browser). Keep such a remote manifest-only: publish its
   * manifest URL, not a `remoteEntry`.
   */
  manifestOnly?: string;
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
 * Where a manifest's files live: `auto` or empty is the manifest's own
 * directory (the sdk's `inferAutoPublicPath`). Anything else is used as is, so
 * `${publicPath}${file}` joins exactly as Module Federation's `getResourceUrl`
 * does. A root-relative or relative `publicPath` therefore stays relative: the
 * browser resolves it against the page, not the manifest URL.
 */
function resolveFile(publicPath: string, manifestUrl: string, file: string): string {
  if (publicPath === '' || publicPath === 'auto') return new URL(file, manifestUrl).href;
  return `${publicPath}${file}`;
}

function sync(assets: unknown, kind: 'js' | 'css'): string[] {
  const group = isObj(assets) ? assets[kind] : undefined;
  return isObj(group) ? strings(group.sync) : [];
}

/**
 * Reads the entry script and each expose's synchronous files out of a Module
 * Federation `mf-manifest.json`, resolved against where it is served from
 * (`manifestUrl`) for an `auto` `publicPath`, and joined to the `publicPath`
 * as is otherwise (so a root-relative one stays root-relative). With
 * `metaData.getPublicPath` the URLs are computed in the browser and cannot be
 * known here: the result has `manifestOnly` set and no `remoteEntry`. Run at
 * publish or build time; the browser never parses a manifest. Throws on a
 * manifest without an entry.
 */
export function assetsFromManifest(manifest: unknown, manifestUrl: string): RemoteAssets {
  if (!isUrl(manifestUrl)) fail(`manifest URL "${manifestUrl}" is not an http(s) URL`);
  if (!isObj(manifest)) fail('must be an object');
  const meta = manifest.metaData;
  if (!isObj(meta)) fail('has no metaData');
  const entry = meta.remoteEntry;
  if (!isObj(entry) || typeof entry.name !== 'string' || entry.name === '')
    fail('metaData.remoteEntry has no name');
  if (typeof meta.getPublicPath === 'string' && meta.getPublicPath !== '')
    return {
      exposes: {},
      manifestOnly:
        'metaData.getPublicPath computes the file URLs in the browser, so they cannot be known at publish time',
    };
  const publicPath = typeof meta.publicPath === 'string' ? meta.publicPath : '';
  const at = (file: string) => resolveFile(publicPath, manifestUrl, file);
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
