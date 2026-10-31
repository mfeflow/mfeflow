import { isObj, isUrl } from './validate.js';

/** What the registry needs from a built remote's `mf-manifest.json`. */
export interface RemoteAssets {
  /** Absolute URL of the remote's entry script. */
  remoteEntry: string;
  /** Per expose (`./App`), absolute URLs of the JS and CSS files it loads before it renders. */
  exposes: Record<string, string[]>;
}

function fail(why: string): never {
  throw new Error(`mf-manifest.json: ${why}`);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map((v: unknown) => v) : [];
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
  const base = isUrl(publicPath) ? publicPath : new URL('.', manifestUrl).href;
  const at = (file: string) => new URL(file, base).href;
  const prefix = typeof entry.path === 'string' && entry.path !== '' ? `${entry.path}/` : '';
  const exposes: Record<string, string[]> = {};
  for (const expose of list(manifest.exposes)) {
    if (!isObj(expose) || typeof expose.path !== 'string') continue;
    const files = [...sync(expose.assets, 'css'), ...sync(expose.assets, 'js')];
    exposes[expose.path] = [...new Set(files)].map(at);
  }
  return { remoteEntry: at(`${prefix}${entry.name}`), exposes };
}
