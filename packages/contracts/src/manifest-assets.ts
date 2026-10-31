import { ENTRY_TYPES, GLOBAL_NAME } from './entry';
import { isObj, isUrl } from './validate';

/** What the registry needs from a built remote's `mf-manifest.json`. */
export interface RemoteAssets {
  /** Absolute URL of the remote's entry script. Absent when `manifestOnly` is set. */
  remoteEntry?: string;
  /** Per expose (`./App`), URLs of the JS and CSS files it loads before it renders. Empty when `manifestOnly` is set. */
  exposes: Record<string, string[]>;
  /**
   * Why the files' URLs cannot be known at publish time (`metaData.getPublicPath`
   * computes them in the browser, or a relative `publicPath` resolves against a
   * page URL that was not given). Keep such a remote manifest-only: publish its
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

export interface AssetsOptions {
  /**
   * The shell page the remote loads into. Module Federation joins a relative or
   * root-relative `publicPath` as `${publicPath}${file}` and the browser
   * resolves that against the page, so it is needed to know those URLs here.
   */
  pageUrl?: string;
}

const RELATIVE_WITHOUT_PAGE =
  'metaData.publicPath is relative, so the file URLs resolve against the shell page; pass pageUrl to compute them';

function isAbsolute(publicPath: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(publicPath) || publicPath.startsWith('//');
}

/**
 * Where a manifest's files live: `auto` or empty is the manifest's own
 * directory (the sdk's `inferAutoPublicPath`). Anything else is joined as
 * `${publicPath}${file}`, exactly as Module Federation's `getResourceUrl`
 * does, and resolved against the page when it is relative.
 */
function resolveFile(
  publicPath: string,
  manifestUrl: string,
  pageUrl: string,
  file: string,
): string {
  if (publicPath === '' || publicPath === 'auto') return new URL(file, manifestUrl).href;
  return new URL(`${publicPath}${file}`, pageUrl).href;
}

function sync(assets: unknown, kind: 'js' | 'css'): string[] {
  const group = isObj(assets) ? assets[kind] : undefined;
  return isObj(group) ? strings(group.sync) : [];
}

/**
 * Reads the entry script and each expose's synchronous files out of a Module
 * Federation `mf-manifest.json`, resolved against where it is served from
 * (`manifestUrl`) for an `auto` `publicPath`, and joined to the `publicPath`
 * otherwise (a relative one against `options.pageUrl`). With
 * `metaData.getPublicPath`, or a relative `publicPath` and no `pageUrl`, the
 * URLs cannot be known here: the result has `manifestOnly` set and no
 * `remoteEntry`. Every URL returned is absolute. Run at
 * publish or build time; the browser never parses a manifest. Throws on a
 * manifest without an entry.
 */
export function assetsFromManifest(
  manifest: unknown,
  manifestUrl: string,
  options: AssetsOptions = {},
): RemoteAssets {
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
  const { pageUrl } = options;
  if (pageUrl !== undefined && !isUrl(pageUrl)) fail(`page URL "${pageUrl}" is not an http(s) URL`);
  const relative = publicPath !== '' && publicPath !== 'auto' && !isAbsolute(publicPath);
  if (relative && pageUrl === undefined)
    return { exposes: {}, manifestOnly: RELATIVE_WITHOUT_PAGE };
  const at = (file: string) => resolveFile(publicPath, manifestUrl, pageUrl ?? manifestUrl, file);
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
