import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'es-module-lexer/js';
import { packageNameOf, sharedSingletons, type SharedConfig } from './shared';

const NAME = /^[a-z][a-z0-9_]*$/;

/** Throws unless `name` is a valid Module Federation name (lowercase letters, digits, _). */
export function checkName(name: string): void {
  if (!NAME.test(name)) {
    throw new Error(
      `mfeflow: "${name}" is not a valid Module Federation name (lowercase letters, digits, _)`,
    );
  }
}

/** Options every bundler preset takes for a remote. */
export interface RemoteOptions {
  /** Module Federation name, e.g. `cart`. */
  name: string;
  /** `{ './App': './src/exposed/App.tsx' }`. */
  exposes: Readonly<Record<string, string>>;
  port?: number;
  /** Extra packages to share as singletons. */
  shared?: readonly string[];
  /** Generate types for the shell (`@mf-types.zip`). Default true. */
  types?: boolean;
  /**
   * Set when this remote loads other remotes. By default remote code for
   * consuming remotes is stripped from the build (smaller entry).
   */
  consumesRemotes?: boolean;
  /** App directory. Default `process.cwd()`. */
  cwd?: string;
}

/** Options every bundler preset takes for the shell (host). */
export interface ShellOptions {
  name: string;
  port?: number;
  shared?: readonly string[];
  /**
   * Remotes whose types the shell typechecks against, as `{ cart: 'https://…/mf-manifest.json' }`.
   * Used only when `MFEFLOW_TYPES=1` is set (types-only builds); normal builds
   * register remotes at runtime from the registry index.
   */
  typesFrom?: Readonly<Record<string, string>>;
  /** More Module Federation runtime plugins (absolute paths). Must not import shared modules. */
  runtimePlugins?: readonly string[];
  /**
   * Ship shared singletons in the initial chunk so the shell needs no async
   * bootstrap boundary. Default true. With `false` the singletons load
   * asynchronously, so the entry (`src/index.ts`) must only `import('./bootstrap')`;
   * a synchronous bootstrap fails at runtime with "Shared module is not available
   * for eager consumption". `createShellConfig` throws when the entry has no
   * dynamic `import()`.
   */
  eager?: boolean;
  /**
   * Keep the manifest/snapshot loader. Default: only in non-production builds,
   * where dev overrides point at a local remote's manifest. Production shells
   * register remote entry URLs and need no snapshot code, so the runtime
   * refuses (and reports `MFE_NO_REMOTE_ENTRY` for) a registry entry that has
   * only a manifest URL. Pass `snapshot: true` while publishing does not yet
   * write `remoteEntry`.
   */
  snapshot?: boolean;
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

/** The Module Federation options both bundler plugins understand. */
export interface CommonFederationOptions {
  name: string;
  exposes?: Record<string, string>;
  remotes?: Record<string, string>;
  shared: Record<string, SharedConfig>;
  manifest: boolean;
  dts:
    | false
    | {
        generateTypes: boolean;
        consumeTypes: false | { typesOnBuild: true; abortOnError: boolean };
      };
  runtimePlugins?: string[];
}

/** Module Federation options for a remote, before bundler-specific settings. */
export function commonRemoteOptions(
  o: RemoteOptions,
  canResolve: (s: string) => boolean,
  versionOf?: (s: string) => string | undefined,
): CommonFederationOptions {
  checkName(o.name);
  if (Object.keys(o.exposes).length === 0)
    throw new Error(`mfeflow: remote "${o.name}" exposes nothing`);
  return {
    name: o.name,
    exposes: { ...o.exposes },
    shared: sharedSingletons(canResolve, o.shared, versionOf),
    manifest: true,
    dts: o.types === false ? false : { generateTypes: true, consumeTypes: false },
  };
}

/** Whether the shell keeps the manifest/snapshot loader. */
export function snapshotEnabled(o: Pick<ShellOptions, 'snapshot' | 'env'>): boolean {
  return o.snapshot ?? (o.env ?? process.env).NODE_ENV !== 'production';
}

/** Module Federation options for a shell, before bundler-specific settings. */
export function commonShellOptions(
  o: ShellOptions,
  canResolve: (s: string) => boolean,
  resolvePath: (s: string) => string,
  versionOf?: (s: string) => string | undefined,
): CommonFederationOptions {
  checkName(o.name);
  const env = o.env ?? process.env;
  const typesBuild = env.MFEFLOW_TYPES === '1' && o.typesFrom !== undefined;
  const remotes: Record<string, string> = {};
  if (typesBuild) {
    for (const [remote, url] of Object.entries(o.typesFrom ?? {})) {
      checkName(remote);
      remotes[remote] = `${remote}@${url}`;
    }
  }
  return {
    name: o.name,
    remotes,
    shared: sharedSingletons(canResolve, o.shared, versionOf, o.eager !== false),
    manifest: true,
    // Production builds skip remote types unless typesOnBuild is set (dts-plugin 2.9.2).
    dts: typesBuild
      ? { generateTypes: false, consumeTypes: { typesOnBuild: true, abortOnError: true } }
      : false,
    runtimePlugins: [
      ...(canResolve('@mfeflow/runtime/plugins/report')
        ? [resolvePath('@mfeflow/runtime/plugins/report')]
        : []),
      ...(canResolve('@mfeflow/runtime/plugins/entry-retry')
        ? [resolvePath('@mfeflow/runtime/plugins/entry-retry')]
        : []),
      ...(o.runtimePlugins ?? []),
    ],
  };
}

const RELATIVE_SPECIFIER = /^\.\.?\//;

/** True when `source` calls `import()` of a relative module, outside comments and strings. */
function importsRelativeModule(source: string): boolean {
  try {
    return parse(source)[0].some(
      (i) =>
        i.type === 'dynamic' &&
        !i.glob &&
        !i.probablyTypeOnly &&
        i.specifier !== undefined &&
        RELATIVE_SPECIFIER.test(i.specifier),
    );
  } catch {
    // Source the lexer cannot read is a syntax error; the bundler reports it with its own location.
    return true;
  }
}

/**
 * Throws when a shell built with `eager: false` has an entry that never calls
 * `import()`: its shared singletons would not be ready when the entry runs.
 * An entry file that does not exist is left for the bundler to report.
 */
export function assertAsyncBoundary(
  entryFile: string,
  read: (file: string) => string | undefined = (f) =>
    fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined,
): void {
  const source = read(entryFile);
  if (source === undefined || importsRelativeModule(source)) return;
  throw new Error(
    `mfeflow: eager: false needs an async bootstrap boundary, but ${entryFile} has no import() of a relative module. ` +
      `Make it \`import('./bootstrap')\` (shared singletons load asynchronously, so a synchronous bootstrap fails with ` +
      `"Shared module is not available for eager consumption"), or drop eager: false.`,
  );
}

/** The `version` of the app's `package.json`, or `0.0.0` when it has none. */
export function appVersion(cwd: string): string {
  try {
    const pkg: unknown = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    const version: unknown =
      typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, 'version') : undefined;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The shared packages of an app, once each: `react-dom/client` and `react-dom` count as `react-dom`. */
export function sharedPackages(
  canResolve: (s: string) => boolean,
  extra: readonly string[] = [],
): string[] {
  return [...new Set(Object.keys(sharedSingletons(canResolve, extra)).map(packageNameOf))];
}

/**
 * The compile-time constants a shell defines, as source text: the runtime reads `__MFEFLOW_SNAPSHOT__`
 * to refuse a remote with no remoteEntry when the manifest loader is gone, `__MFEFLOW_APP_VERSION__` is
 * the app's own version, and `__MFEFLOW_SINGLETONS__` names the shared packages for the browser
 * singleton check (`checkSingletons`).
 */
export function shellDefines(
  o: Pick<ShellOptions, 'snapshot' | 'env' | 'shared'>,
  cwd: string,
  canResolve: (s: string) => boolean,
): Record<string, string> {
  return {
    __MFEFLOW_SNAPSHOT__: JSON.stringify(snapshotEnabled(o)),
    __MFEFLOW_APP_VERSION__: JSON.stringify(appVersion(cwd)),
    __MFEFLOW_SINGLETONS__: JSON.stringify(sharedPackages(canResolve, o.shared)),
  };
}
