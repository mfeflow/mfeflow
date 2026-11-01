import type { ReadFile } from '../plan';

/** The bundler an adopted app builds with, judged from its config file name. */
export type BuildTool = 'rsbuild' | 'rspack' | 'webpack';

/** `remote` when the app exposes modules, `shell` (a host) when it only consumes them. */
export type FederationRole = 'shell' | 'remote';

/** A remote an app loads, as written in its `remotes`. */
export interface DetectedRemote {
  /** The remote's federation name: the part before `@` in `name@url`. Absent for a bare URL. */
  name?: string;
  /** The URL after `@`, or the whole string for a bare URL. */
  entry: string;
  /** `manifest` for an `mf-manifest.json` style entry, `script` for a `remoteEntry.js`. */
  type: 'manifest' | 'script';
}

/** One shared package, with the two settings adopt carries over. */
export interface DetectedShared {
  singleton?: boolean;
  /** A semver range, or `false` to turn the version check off. */
  requiredVersion?: string | false;
}

/** One app with a Module Federation config, as far as it could be read without running it. */
export interface DetectedApp {
  /** Folder of the app relative to the scanned folder, with `/` separators. `.` for the folder itself. */
  dir: string;
  /** The federation `name`, when it is a literal. */
  name?: string;
  /** The `name` in the app's package.json, when there is one. */
  packageName?: string;
  role: FederationRole;
  buildTool: BuildTool;
  /** The build config, relative to the scanned folder. */
  configFile: string;
  /** The file the federation options were read from, when it is not `configFile`. */
  federationFile?: string;
  /** Remote alias (the key in `remotes`) to where it loads from. */
  remotes: Record<string, DetectedRemote>;
  /** Expose key (`./Button`) to the module path it points at. */
  exposes: Record<string, string>;
  shared: Record<string, DetectedShared>;
  /** The dev server port, when it is a literal number. */
  port?: number;
}

/** A part of a config the detector would not read, and why. Nothing here is guessed. */
export interface NotAdopted {
  /** The app folder, as in {@link DetectedApp.dir}. */
  dir: string;
  /** The file the part is in, relative to the scanned folder. */
  file: string;
  /** Where in the config: `remotes`, `shared.react.requiredVersion`, `port`, `options`, … */
  field: string;
  /** Plain words, e.g. "comes from a function call (getRemotes())". */
  reason: string;
}

export interface FederationReport {
  apps: DetectedApp[];
  notAdopted: NotAdopted[];
}

export interface DetectFederationOptions {
  /** Reads a file by absolute path; undefined when it does not exist. Defaults to the disk. */
  read?: ReadFile;
  /**
   * Names of the sub-folders of an absolute path, used to expand workspace
   * globs; an empty list when the folder does not exist. Defaults to the disk.
   */
  listDirs?: (dir: string) => Promise<string[]>;
}
