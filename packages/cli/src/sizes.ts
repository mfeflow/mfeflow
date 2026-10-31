import path from 'node:path';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import { assetsFromManifest, round1 } from '@mfeflow/contracts';
import { readText } from './inspect';

export const KB = 1024;
export const kb = (bytes: number): number => round1(bytes / KB);

/** Gzip size at level 6, what a CDN sends. Undefined when the file is not there. */
export async function gzipBytes(file: string): Promise<number | undefined> {
  try {
    return zlib.gzipSync(await fs.readFile(file), { level: 6 }).length;
  } catch {
    return undefined;
  }
}

async function sumGzip(dist: string, files: readonly string[]): Promise<number | undefined> {
  const sizes = await Promise.all(files.map((f) => gzipBytes(path.join(dist, ...f.split('/')))));
  return sizes.some((s) => s === undefined)
    ? undefined
    : sizes.reduce<number>((a, s) => a + (s ?? 0), 0);
}

export interface ShellSize {
  files: string[];
  bytes: number;
}

/** Scripts `dist/index.html` loads, as paths inside dist, and their gzip size. */
export async function shellInitial(dist: string): Promise<ShellSize | undefined> {
  const html = await readText(path.join(dist, 'index.html'));
  if (html === undefined) return undefined;
  const files = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)]
    .map((m) => m[1] ?? '')
    .filter((src) => !/^[a-z]+:\/\//.test(src))
    .map((src) => src.replace(/^\.?\//, '').split(/[?#]/)[0] ?? '');
  const bytes = await sumGzip(dist, files);
  return bytes === undefined ? undefined : { files, bytes };
}

export interface RemoteSize {
  entryBytes: number;
  /** expose (`./App`) → gzip bytes of the files it loads before it renders, without the entry. */
  exposes: Record<string, number>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const ORIGIN = 'http://dist.invalid';
const SCRIPT = /\.[cm]?js$/;

/** A file inside dist from the URL `assetsFromManifest` resolved it to. */
function distPath(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
  } catch {
    return undefined;
  }
}

/** Entry script and each expose's synchronous JS, read from the remote's `mf-manifest.json`. */
export async function remoteSizes(dist: string): Promise<RemoteSize | undefined> {
  const text = await readText(path.join(dist, 'mf-manifest.json'));
  if (text === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObj(manifest) || !isObj(manifest.metaData) || !isObj(manifest.metaData.remoteEntry)) {
    return undefined;
  }
  // Sizes come from the files on disk, whatever the manifest says about where they are served.
  const local = {
    ...manifest,
    metaData: {
      ...manifest.metaData,
      publicPath: 'auto',
      getPublicPath: undefined,
      globalName: undefined,
      remoteEntry: { ...manifest.metaData.remoteEntry, type: undefined },
    },
  };
  let assets;
  try {
    assets = assetsFromManifest(local, `${ORIGIN}/mf-manifest.json`);
  } catch {
    return undefined;
  }
  const entry = assets.remoteEntry === undefined ? undefined : distPath(assets.remoteEntry);
  if (entry === undefined) return undefined;
  const entryBytes = await gzipBytes(path.join(dist, ...entry.split('/')));
  if (entryBytes === undefined) return undefined;
  const exposes: Record<string, number> = {};
  for (const [name, urls] of Object.entries(assets.exposes)) {
    const files = urls.flatMap((url) => distPath(url) ?? []).filter((f) => SCRIPT.test(f));
    // oxlint-disable-next-line no-await-in-loop -- a few exposes
    const bytes = await sumGzip(dist, files);
    if (bytes !== undefined) exposes[name] = bytes;
  }
  return { entryBytes, exposes };
}
