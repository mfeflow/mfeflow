// Error pages whose fix text names a docs URL (the schema links) are generated from ERROR_CATALOGUE, so the
// URL has one source. The files stay committed; the docs tests fail when they drift from the catalogue.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_URL } from '@mfeflow/contracts';
import { ERROR_CATALOGUE } from '@mfeflow/core';

export const ERRORS_DIR = path.join(import.meta.dirname, '../docs/errors');

export function generatedCodes() {
  return Object.keys(ERROR_CATALOGUE).filter((code) =>
    ERROR_CATALOGUE[code].fix.includes(DOCS_URL),
  );
}

export function errorPage(code) {
  const { title, fix } = ERROR_CATALOGUE[code];
  return `# MFEFLOW_${code}\n\n${title}.\n\n## Fix\n\n${fix}\n`;
}

/** Writes the generated pages under `dir` and returns their codes. */
export async function emitErrorPages(dir = ERRORS_DIR) {
  const codes = generatedCodes();
  await fs.mkdir(dir, { recursive: true });
  for (const code of codes) await fs.writeFile(path.join(dir, `${code}.md`), errorPage(code));
  return codes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const codes = await emitErrorPages();
  console.log(`emitted ${String(codes.length)} error pages: ${codes.join(', ')}`);
}
