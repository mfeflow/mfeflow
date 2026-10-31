export { isSafeRelativePath, type Issue } from './validate';
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
export { assetsFromManifest, type RemoteAssets } from './manifest-assets';
export {
  injectIntoHead,
  registryInjection,
  type InjectionOptions,
  type RouteNeed,
} from './html-injection';
export {
  isRegistryEntry,
  isRegistryIndex,
  validateRegistryEntry,
  validateRegistryIndex,
  type RegistryEntry,
  type RegistryIndex,
  type RegistryIndexRemote,
} from './registry';
export {
  FILE_HASH,
  isMfeflowProject,
  validateMfeflowProject,
  type MfeflowProject,
  type ProjectBudget,
} from './project';
export {
  COST_MODEL,
  judgeCost,
  splitScripts,
  type CostLine,
  type CostModel,
  type CostSample,
  type CostVerdict,
} from './cost-model';
export {
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

/** Where the JSON Schemas are published, for `$schema` in editors. */
export const SCHEMA_URLS = {
  mfe: 'https://mfeflow.dev/schema/mfe.json',
  project: 'https://mfeflow.dev/schema/mfeflow.json',
  feature: 'https://mfeflow.dev/schema/feature.json',
  registryEntry: 'https://mfeflow.dev/schema/registry-entry.json',
  registryIndex: 'https://mfeflow.dev/schema/registry-index.json',
} as const;
