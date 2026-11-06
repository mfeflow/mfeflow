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

const DESCRIPTION_MAX = 150;

/** Plain text of at most about 150 characters, cut at a word boundary. */
export function clampDescription(text, max = DESCRIPTION_MAX) {
  const plain = text.replaceAll('`', '').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/** A YAML string the way prettier writes it: single quotes unless the text has an apostrophe. */
export function yamlString(text) {
  if (text.includes("'") && !text.includes('"')) return `"${text}"`;
  return `'${text.replaceAll("'", "''")}'`;
}

export function errorFrontmatter(code, fix) {
  const { title } = ERROR_CATALOGUE[code];
  const lines = [
    `title: ${yamlString(`MFEFLOW_${code}: ${title}`)}`,
    `description: ${yamlString(clampDescription(`${title}. ${fix}`))}`,
  ];
  return `---\n${lines.join('\n')}\n---\n\n`;
}

export function errorPage(code) {
  const { title, fix } = ERROR_CATALOGUE[code];
  return `${errorFrontmatter(code, fix)}# MFEFLOW_${code}\n\n${title}.\n\n## Fix\n\n${fix}\n`;
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
