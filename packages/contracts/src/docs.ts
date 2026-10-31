/** Where the documentation site lives. Change this and `base` in `apps/docs/rspress.config.ts` together. */
export const DOCS_URL = 'https://mfeflow.github.io/mfeflow';

/** Where the JSON Schemas are published, for `$schema` in editors. */
export const SCHEMA_URLS = {
  mfe: `${DOCS_URL}/schema/mfe.json`,
  project: `${DOCS_URL}/schema/mfeflow.json`,
  feature: `${DOCS_URL}/schema/feature.json`,
  registryEntry: `${DOCS_URL}/schema/registry-entry.json`,
  registryIndex: `${DOCS_URL}/schema/registry-index.json`,
} as const;

export type SchemaName = keyof typeof SCHEMA_URLS;

/** The docs page for an error code such as `E102`. */
export function errorDocsUrl(code: string): string {
  return `${DOCS_URL}/errors/${code}`;
}
