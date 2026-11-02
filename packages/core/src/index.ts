import { readPackageJson } from './version';

/** Name and version of this package. */
export function packageInfo(): { name: string; version: string } {
  const { name, version } = readPackageJson();
  return { name, version };
}

export {
  ERROR_CATALOGUE,
  hasErrno,
  isMfeflowError,
  messageOf,
  MfeflowError,
  type ErrorCode,
  type MfeflowErrorOptions,
} from './errors';
export {
  APP_FILE,
  LEGACY_APP_FILE,
  legacyAppFileNotice,
  readAppFile,
  type AppFileName,
  type AppFileText,
} from './app-file';
export { hashContent } from './hash';
export { inOrder } from './sequence';
export { realFs, symlinkedPrefix, writeFileAtomic, type FsOps } from './fs';
export {
  findDiverged,
  findProjectRoot,
  loadProject,
  parseProject,
  PROJECT_FILE,
  recordPlan,
  saveProject,
  serializeProject,
  type DivergedFile,
  type MfeflowProject,
} from './project';
export {
  emptyPlan,
  PlanBuilder,
  renderDiff,
  summarize,
  type ChangeAction,
  type DependencyAdd,
  type EnvKeyAdd,
  type FileChange,
  type Plan,
  type PlanBuilderOptions,
  type PlanFeature,
  type ReadFile,
  type ScriptAdd,
} from './plan';
export {
  applyPlan,
  type ApplyOptions,
  type ApplyResult,
  type InstallContext,
  type InstallStep,
} from './apply';
export {
  detectBaseline,
  isEnvKeyFile,
  planUpgrade,
  recordEnvKey,
  type DivergedUpgrade,
  type DivergeReason,
  type Migration,
  type UpgradeDecisions,
  type UpgradeInput,
  type UpgradePlan,
} from './upgrade';
export { renderTemplate, substitute, type TemplateData } from './templates';
export { RUNTIME_CONFIG_FILE, runtimeConfigFiles } from './runtime-config';
export { applyTransform, dotenvKeys, schemaKeys, type SchemaKey } from './transforms';
export {
  detectFederation,
  planAdoption,
  type AdoptAppFile,
  type AdoptInput,
  type AdoptPlan,
  type AdoptRemote,
  type BuildTool,
  type DetectedApp,
  type DetectedRemote,
  type DetectedShared,
  type DetectFederationOptions,
  type FederationReport,
  type FederationRole,
  type NotAdopted,
} from './adopt';
export {
  buildRegistry,
  fetchFeatureIndex,
  fetchRemoteText,
  isProtectedPath,
  listLocalFeatures,
  loadFeature,
  parseFeature,
  addTrusted,
  configDirOf,
  parseTrustEnv,
  readTrusted,
  removeTrusted,
  TRUST_ENV,
  trustedNamespaces,
  trustFileIn,
  type EnvTrust,
  type Trusted,
  type TrustedRegistry,
  getHttps,
  checkIntegrity,
  indexedVersion,
  integrityOf,
  readCappedText,
  registryUrl,
  resolveFeature,
  resolveOptions,
  type FetchLike,
  type FetchResponse,
  type LoadedFeature,
  type LoadOptions,
  type RegistryBuild,
  type RegistryFile,
  type ResolveInput,
  type Trust,
} from './features';
