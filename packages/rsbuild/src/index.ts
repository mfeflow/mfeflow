import path from 'node:path';
import { createRequire } from 'node:module';
import type { RsbuildConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import {
  assertAsyncBoundary,
  commonRemoteOptions,
  commonShellOptions,
  installedVersionFrom,
  resolvableFrom,
  shellDefines,
  snapshotEnabled,
  type CommonFederationOptions,
  type RemoteOptions as CommonRemoteOptions,
  type ShellOptions as CommonShellOptions,
} from '@mfeflow/bundler-shared';
import { pluginMfEsmRuntime } from './esm-runtime';
import { headScriptTags } from './head-scripts';
import { runtimeConfigSetup } from './runtime-config';

export { esmTwin, isMfCjs, pluginMfEsmRuntime } from './esm-runtime';
export { headScriptTags, registerHeadScript } from './head-scripts';
export {
  RUNTIME_CONFIG_URL,
  runtimeConfigEnv,
  runtimeConfigEnvs,
  runtimeConfigHandler,
  runtimeConfigSetup,
} from './runtime-config';
export {
  DEFAULT_SINGLETONS,
  appVersion,
  assertAsyncBoundary,
  installedVersionFrom,
  packageNameOf,
  resolvableFrom,
  sharedPackages,
  sharedSingletons,
  snapshotEnabled,
  type SharedConfig,
} from '@mfeflow/bundler-shared';

export interface RemoteOptions extends CommonRemoteOptions {
  /** Swap the CommonJS Module Federation runtime for its ESM build. Default true. */
  esmRuntime?: boolean;
}

export interface FederationOptimization {
  disableRemote?: true;
  disableSnapshot?: true;
  target?: 'web';
}

export interface FederationOptions extends CommonFederationOptions {
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
  return {
    ...commonRemoteOptions(o, canResolve, versionOf),
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

export interface ShellOptions extends CommonShellOptions {
  /** Swap the CommonJS Module Federation runtime for its ESM build. Default true. */
  esmRuntime?: boolean;
}

/** Module Federation options for a shell. Exported for tests and custom setups. */
export function shellFederationOptions(
  o: ShellOptions,
  canResolve: (s: string) => boolean,
  resolvePath: (s: string) => string,
  versionOf?: (s: string) => string | undefined,
): FederationOptions {
  const snapshot = snapshotEnabled(o);
  return {
    ...commonShellOptions(o, canResolve, resolvePath, versionOf),
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
  if (o.eager === false) assertAsyncBoundary(path.join(cwd, 'src/index.ts'));
  const setup = runtimeConfigSetup(cwd, o.env ?? process.env);
  const headScripts = headScriptTags();
  return {
    plugins: [
      pluginReact(),
      ...(o.esmRuntime === false ? [] : [pluginMfEsmRuntime()]),
      pluginModuleFederation(
        shellFederationOptions(o, resolvableFrom(cwd), (s) => require.resolve(s)),
      ),
    ],
    ...(headScripts.length === 0 ? {} : { html: { tags: headScripts } }),
    source: {
      entry: { index: './src/index.ts' },
      define: shellDefines(o, cwd, resolvableFrom(cwd)),
    },
    server: {
      historyApiFallback: true,
      ...(o.port === undefined ? {} : { port: o.port }),
      ...(setup === undefined ? {} : { setup }),
    },
  };
}
