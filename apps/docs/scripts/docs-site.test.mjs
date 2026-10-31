import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOCS_URL, SCHEMA_URLS } from '@mfeflow/contracts';
import { ERROR_CATALOGUE } from '@mfeflow/core';
import config from '../rspress.config';
import { emitSchemas, schemaPath } from './emit-schemas.mjs';

const DOCS_DIR = path.join(import.meta.dirname, '../docs');

async function markdownFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

describe('schemas', () => {
  let publicDir;
  beforeEach(async () => {
    publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-docs-'));
  });
  afterEach(async () => {
    await fs.rm(publicDir, { recursive: true, force: true });
  });

  it('emits a file for every URL in SCHEMA_URLS, at the path the URL names', async () => {
    const written = await emitSchemas(publicDir);
    expect(written).toHaveLength(Object.keys(SCHEMA_URLS).length);
    for (const [name, url] of Object.entries(SCHEMA_URLS)) {
      const file = path.join(publicDir, schemaPath(name));
      expect(`${DOCS_URL}/${path.relative(publicDir, file)}`).toBe(url);
      const schema = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(schema.$id).toBe(url);
    }
  });

  it('writes again over an earlier build', async () => {
    await emitSchemas(publicDir);
    await expect(emitSchemas(publicDir)).resolves.toHaveLength(Object.keys(SCHEMA_URLS).length);
  });
});

describe('error pages', () => {
  it('has a page for every code in the error catalogue', async () => {
    const missing = [];
    for (const code of Object.keys(ERROR_CATALOGUE)) {
      const page = await fs
        .readFile(path.join(DOCS_DIR, 'errors', `${code}.md`), 'utf8')
        .catch(() => '');
      if (!page.startsWith(`# MFEFLOW_${code}\n`)) missing.push(code);
    }
    expect(missing).toEqual([]);
  });

  it('has no page for a code the catalogue lacks', async () => {
    const pages = (await fs.readdir(path.join(DOCS_DIR, 'errors'))).map((f) =>
      f.replace(/\.md$/, ''),
    );
    expect(pages.toSorted()).toEqual(Object.keys(ERROR_CATALOGUE).toSorted());
  });
});

describe('site', () => {
  it('serves under the path of DOCS_URL, with llms.txt on', () => {
    expect(config.base).toBe('/mfeflow/');
    expect(config.llms).toBe(true);
  });

  it('keeps the unregistered domain out of the pages', async () => {
    for (const file of await markdownFiles(DOCS_DIR)) {
      expect(await fs.readFile(file, 'utf8'), file).not.toContain('mfeflow.dev');
    }
  });
});
