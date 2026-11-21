export {
  BASE_PATH_GLOBAL,
  BASE_SCRIPT_NAME,
  REGISTRY_URL_GLOBAL,
  applyBaseHeadScript,
  baseHeadScript,
  defaultRegistryUrlFor,
  normalizeBasePath,
  resolveBasePath,
  resolveRegistryUrl,
} from './base';
export {
  appVersion,
  assertAsyncBoundary,
  checkName,
  commonRemoteOptions,
  commonShellOptions,
  sharedPackages,
  shellDefines,
  snapshotEnabled,
  type CommonFederationOptions,
  type RemoteOptions,
  type ShellOptions,
} from './federation';
export {
  headScripts,
  registerHeadScript,
  resetHeadScriptsForTests,
  unregisterHeadScript,
} from './head-scripts';
export {
  RUNTIME_CONFIG_URL,
  runtimeConfigEnv,
  runtimeConfigEnvs,
  runtimeConfigHandler,
} from './runtime-config';
export {
  DEFAULT_SINGLETONS,
  installedVersionFrom,
  packageNameOf,
  resolvableFrom,
  sharedSingletons,
  type SharedConfig,
} from './shared';
