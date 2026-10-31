import path from 'node:path';
import { createRequire } from 'node:module';
import type { RsbuildConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { pluginMfEsmRuntime } from './esm-runtime.js';
import {
  installedVersionFrom,
  resolvableFrom,
  sharedSingletons,
  type SharedConfig,
} from './shared.js';

export { esmTwin, isMfCjs, pluginMfEsmRuntime } from './esm-runtime.js';
export {
  DEFAULT_SINGLETONS,
  installedVersionFrom,
  packageNameOf,
  resolvableFrom,
  sharedSingletons,
  type SharedConfig,
} from './shared.js';

const NAME = /^[a-z][a-z0-9_]*$/;

function checkName(name: string): void {
  if (!NAME.test(name)) {
    throw new Error(
      `@mfeflow/rsbuild: "${name}" is not a valid Module Federation name (lowercase letters, digits, _)`,
    );
  }
}

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
  /** Swap the CommonJS Module Federation runtime for its ESM build. Default true. */
  esmRuntime?: boolean;
  /** App directory. Default `process.cwd()`. */
  cwd?: string;
}

export interface FederationOptimization {
  disableRemote?: true;
  disableSnapshot?: true;
  target?: 'web';
}

export interface FederationOptions {
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
  experiments: {
    externalRuntime?: true;
    provideExternalRuntime?: true;
    optimization: FederationOptimization;
  };
}

/** Module Federation options for a remote. Exported for tests and custom setups. */
export function remoteFederationOptions(
  o: RemoteOptions,
  canResolve: (s: string) => boolean,
  versionOf?: (s: string) => string | undefined,
): FederationOptions {
  checkName(o.name);
  if (Object.keys(o.exposes).length === 0)
    throw new Error(`@mfeflow/rsbuild: remote "${o.name}" exposes nothing`);
  return {
    name: o.name,
    exposes: { ...o.exposes },
    shared: sharedSingletons(canResolve, o.shared, versionOf),
    manifest: true,
    dts: o.types === false ? false : { generateTypes: true, consumeTypes: false },
    // The shell provides the Module Federation runtime; remotes do not bundle their own.
    experiments: {
      externalRuntime: true,
      optimization: {
        target: 'web',
        ...(o.consumesRemotes === true ? {} : { disableRemote: true as const }),
      },
    },
  };
}

/** Rsbuild config for a remote. `rsbuild.config.ts`: `export default createRemoteConfig({ name, exposes })`. */
export function createRemoteConfig(o: RemoteOptions): RsbuildConfig {
  const cwd = o.cwd ?? process.cwd();
  return {
    plugins: [
      pluginReact(),
      ...(o.esmRuntime === false ? [] : [pluginMfEsmRuntime()]),
      pluginModuleFederation(
        remoteFederationOptions(o, resolvableFrom(cwd), installedVersionFrom(cwd)),
      ),
    ],
    source: { entry: { index: './src/index.ts' } },
    // Assets resolve relative to wherever the remote entry was loaded from (versioned CDN paths).
    output: { assetPrefix: 'auto' },
    server: o.port === undefined ? {} : { port: o.port },
  };
}

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
  /** Swap the CommonJS Module Federation runtime for its ESM build. Default true. */
  esmRuntime?: boolean;
  /** Ship shared singletons in the initial chunk so the shell needs no async bootstrap boundary. Default true. */
  eager?: boolean;
  /**
   * Keep the manifest/snapshot loader. Default: only in non-production builds,
   * where dev overrides point at a local remote's manifest. Production shells
   * register remote entry URLs and need no snapshot code.
   */
  snapshot?: boolean;
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

/** Module Federation options for a shell. Exported for tests and custom setups. */
export function shellFederationOptions(
  o: ShellOptions,
  canResolve: (s: string) => boolean,
  resolvePath: (s: string) => string,
  versionOf?: (s: string) => string | undefined,
): FederationOptions {
  checkName(o.name);
  const env = o.env ?? process.env;
  const typesBuild = env.MFEFLOW_TYPES === '1' && o.typesFrom !== undefined;
  const snapshot = o.snapshot ?? env.NODE_ENV !== 'production';
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
    experiments: {
      provideExternalRuntime: true,
      optimization: { target: 'web', ...(snapshot ? {} : { disableSnapshot: true as const }) },
    },
  };
}

/** Rsbuild config for the shell (host). */
export function createShellConfig(o: ShellOptions): RsbuildConfig {
  const cwd = o.cwd ?? process.cwd();
  const require = createRequire(path.join(cwd, 'package.json'));
  return {
    plugins: [
      pluginReact(),
      ...(o.esmRuntime === false ? [] : [pluginMfEsmRuntime()]),
      pluginModuleFederation(
        shellFederationOptions(o, resolvableFrom(cwd), (s) => require.resolve(s)),
      ),
    ],
    source: { entry: { index: './src/index.ts' } },
    server: { historyApiFallback: true, ...(o.port === undefined ? {} : { port: o.port }) },
  };
}
