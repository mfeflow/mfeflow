/** Where the documentation site lives. The Rspress `base`, sitemap and llms.txt origin all derive from it. */
export const DOCS_URL = 'https://mfeflow.github.io/mfeflow';

/** Where the JSON Schemas are published, for `$schema` in editors. */
export const SCHEMA_URLS = {
  /** `mfeflow.app.json`, the file in each app's folder. */
  mfe: `${DOCS_URL}/schema/mfeflow-app.json`,
  project: `${DOCS_URL}/schema/mfeflow.json`,
  feature: `${DOCS_URL}/schema/feature.json`,
  registryEntry: `${DOCS_URL}/schema/registry-entry.json`,
  registryIndex: `${DOCS_URL}/schema/registry-index.json`,
  featureRegistryIndex: `${DOCS_URL}/schema/feature-registry-index.json`,
} as const;

export type SchemaName = keyof typeof SCHEMA_URLS;

/**
 * Old schema URLs that still serve a schema, so `$schema` lines written before a rename keep
 * resolving. Each maps to the schema now published at its `SCHEMA_URLS` address.
 */
export const SCHEMA_ALIASES: Readonly<Record<string, SchemaName>> = {
  [`${DOCS_URL}/schema/mfe.json`]: 'mfe',
};

/** The docs page for an error code such as `E102`. */
export function errorDocsUrl(code: string): string {
  return `${DOCS_URL}/errors/${code}`;
}
