import { readPackageJson } from './version.js';

/** Name and version of this package. */
export function packageInfo(): { name: string; version: string } {
  const { name, version } = readPackageJson();
  return { name, version };
}

export {
  DOCS_BASE,
  ERROR_CATALOGUE,
  isMfeflowError,
  MfeflowError,
  type ErrorCode,
  type MfeflowErrorOptions,
} from './errors.js';
export { hashContent } from './hash.js';
export { realFs, type FsOps } from './fs.js';
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
} from './project.js';
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
} from './plan.js';
export {
  applyPlan,
  type ApplyOptions,
  type ApplyResult,
  type InstallContext,
  type InstallStep,
} from './apply.js';
export { renderTemplate, substitute, type TemplateData } from './templates.js';
export { applyTransform } from './transforms/index.js';
export {
  fetchRemoteText,
  isProtectedPath,
  listLocalFeatures,
  loadFeature,
  parseFeature,
  registryUrl,
  resolveFeature,
  resolveOptions,
  type FetchLike,
  type FetchResponse,
  type LoadedFeature,
  type LoadOptions,
  type ResolveInput,
  type Trust,
} from './features/index.js';
