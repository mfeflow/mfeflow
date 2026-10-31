export type { Issue } from './validate.js';
export {
  ANALYTICS_EVENT,
  EVENT_NAME,
  EXPOSE,
  isMfeManifest,
  MFE_NAME,
  ROUTE,
  validateMfeManifest,
  type MfeManifest,
} from './mfe-manifest.js';
export { assetsFromManifest, type RemoteAssets } from './manifest-assets.js';
export { injectIntoHead, registryInjection, type RouteNeed } from './html-injection.js';
export {
  isRegistryEntry,
  isRegistryIndex,
  validateRegistryEntry,
  validateRegistryIndex,
  type RegistryEntry,
  type RegistryIndex,
  type RegistryIndexRemote,
} from './registry.js';
export { isMfeflowProject, validateMfeflowProject, type MfeflowProject } from './project.js';

/** Where the JSON Schemas are published, for `$schema` in editors. */
export const SCHEMA_URLS = {
  mfe: 'https://mfeflow.dev/schema/mfe.json',
  project: 'https://mfeflow.dev/schema/mfeflow.json',
  registryEntry: 'https://mfeflow.dev/schema/registry-entry.json',
  registryIndex: 'https://mfeflow.dev/schema/registry-index.json',
} as const;
