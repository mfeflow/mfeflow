export { isPortableRelativePath, isSafeRelativePath, type Issue } from './validate';
export {
  ANALYTICS_EVENT,
  EVENT_NAME,
  EXPOSE,
  isMfeManifest,
  MFE_NAME,
  ROUTE,
  validateMfeManifest,
  type MfeManifest,
} from './mfe-manifest';
export { routesOverlap } from './routes';
export { assetsFromManifest, type RemoteAssets } from './manifest-assets';
export { remoteDistFiles, type RemoteDistFiles } from './remote-dist';
export { judgeRemoteInitial, primaryExpose, type RemoteInitialVerdict } from './remote-budget';
export {
  injectIntoHead,
  registryInjection,
  type InjectionOptions,
  type RouteNeed,
} from './html-injection';
export {
  isRegistryEntry,
  isRegistryIndex,
  isRegistryIndexRemote,
  registryRemoteIssues,
  ROUTE_OVERLAP,
  validateRegistryEntry,
  validateRegistryIndex,
  type RegistryEntry,
  type RegistryIndex,
  type RegistryIndexRemote,
} from './registry';
export {
  isFeatureRegistryIndex,
  isLoopbackHttp,
  isRegistryProtocol,
  registryIndexUrl,
  registryTemplateProblem,
  validateFeatureRegistryIndex,
  MAX_DESCRIPTION,
  MAX_INDEX_ITEMS,
  REGISTRY_ITEM_NAME,
  type FeatureRegistryIndex,
  type FeatureRegistryItem,
} from './feature-registry';
export {
  FILE_HASH,
  REGISTRY_HOST,
  REGISTRY_NAMESPACE,
  isMfeflowProject,
  validateMfeflowProject,
  type MfeflowProject,
  type ProjectBudget,
  type ProjectRegistry,
} from './project';
export {
  COST_MODEL,
  judgeCost,
  round1,
  splitScripts,
  type CostLine,
  type CostModel,
  type CostSample,
  type CostVerdict,
} from './cost-model';
export {
  FEATURE_CONDITION,
  FEATURE_NAME,
  isFeatureManifest,
  TRANSFORM_OPS,
  validateFeatureManifest,
  type AddBootStepOp,
  type AddEnvKeyOp,
  type AddImportOp,
  type AddRouteOp,
  type AddSharedOp,
  type AddWorkflowStepOp,
  type EnvValidator,
  type FeatureCondition,
  type FeatureDependency,
  type FeatureFile,
  type FeatureManifest,
  type FeatureMigration,
  type FeaturePrompt,
  type FeatureScript,
  type FeatureTarget,
  type Literal,
  type PromptValue,
  type TransformOp,
  type TransformOpName,
  type WorkflowStep,
  type WrapProviderOp,
} from './feature';

export { DOCS_URL, SCHEMA_URLS, errorDocsUrl, type SchemaName } from './docs';
export { JSON_SCHEMAS } from './json-schema';
