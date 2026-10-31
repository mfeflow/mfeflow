// Writes the JSON Schemas @mfeflow/contracts defines to docs/public/schema, so the site serves them at the
// URLs in SCHEMA_URLS. Runs before every docs build and dev start (restart dev after changing contracts); the output is not committed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_URL, JSON_SCHEMAS, SCHEMA_URLS } from '@mfeflow/contracts';

export const PUBLIC_DIR = path.join(import.meta.dirname, '../docs/public');

/** Where a schema lands under the public folder, e.g. `schema/mfe.json`. */
export function schemaPath(name) {
  return SCHEMA_URLS[name].slice(DOCS_URL.length + 1);
}

/** Writes every schema under `publicDir` and returns the files written, relative to it. */
export async function emitSchemas(publicDir = PUBLIC_DIR) {
  const written = [];
  for (const name of Object.keys(SCHEMA_URLS)) {
    const file = schemaPath(name);
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
