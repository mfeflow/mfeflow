// Writes the JSON Schemas @mfeflow/contracts defines to docs/public/schema, so the site serves them at the
// URLs in SCHEMA_URLS, plus a copy at each old URL in SCHEMA_ALIASES so existing $schema lines resolve. Runs before every docs build and dev start (restart dev after changing contracts); the output is not committed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_URL, JSON_SCHEMAS, SCHEMA_ALIASES, SCHEMA_URLS } from '@mfeflow/contracts';

export const PUBLIC_DIR = path.join(import.meta.dirname, '../docs/public');

/** A schema URL as a path under the public folder, e.g. `schema/mfeflow-app.json`. */
export function urlPath(url) {
  return url.slice(DOCS_URL.length + 1);
}

/** Where a schema lands under the public folder. */
export function schemaPath(name) {
  return urlPath(SCHEMA_URLS[name]);
}

/** Writes every schema, then every alias, under `publicDir` and returns the files written, relative to it. */
export async function emitSchemas(publicDir = PUBLIC_DIR) {
  const files = [
    ...Object.keys(SCHEMA_URLS).map((name) => [schemaPath(name), name]),
    ...Object.entries(SCHEMA_ALIASES).map(([url, name]) => [urlPath(url), name]),
  ];
  const written = [];
  for (const [file, name] of files) {
    const target = path.join(publicDir, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(JSON_SCHEMAS[name], null, 2)}\n`);
    written.push(file);
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const written = await emitSchemas();
  console.log(`emitted ${String(written.length)} schemas to ${PUBLIC_DIR}`);
}
