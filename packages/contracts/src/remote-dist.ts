import { assetsFromManifest, type RemoteAssets } from './manifest-assets';
import { isObj } from './validate';

const DIST_ORIGIN = 'https://dist.invalid';
const SCRIPT = /\.[cm]?js$/;

/** A path inside the build folder from the URL `assetsFromManifest` resolved it to. */
function distPath(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
  } catch {
    return undefined;
  }
}

export interface RemoteDistFiles {
  /** The entry script, as a path inside the build folder. */
  entry: string;
  /** expose (`./App`) → the JS files it loads before it renders, as paths inside the build folder. */
  exposes: Record<string, string[]>;
}

/**
 * The files a remote's build folder holds for its entry and each expose's synchronous JS, read from
 * its `mf-manifest.json`. Paths resolve against the folder whatever `publicPath` says about where the
 * files are served. Undefined when the manifest has no usable entry.
 */
export function remoteDistFiles(manifest: unknown): RemoteDistFiles | undefined {
  if (!isObj(manifest) || !isObj(manifest.metaData) || !isObj(manifest.metaData.remoteEntry)) {
    return undefined;
  }
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
  let assets: RemoteAssets;
  try {
    assets = assetsFromManifest(local, `${DIST_ORIGIN}/mf-manifest.json`);
  } catch {
    return undefined;
  }
  const entry = assets.remoteEntry === undefined ? undefined : distPath(assets.remoteEntry);
  if (entry === undefined) return undefined;
  const exposes: Record<string, string[]> = {};
  for (const [name, urls] of Object.entries(assets.exposes))
    exposes[name] = urls.flatMap((url) => distPath(url) ?? []).filter((f) => SCRIPT.test(f));
  return { entry, exposes };
}
