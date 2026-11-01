import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOCS_URL, SCHEMA_ALIASES, SCHEMA_URLS } from '@mfeflow/contracts';
import { ERROR_CATALOGUE } from '@mfeflow/core';
import config from '../rspress.config';
import { emitErrorPages, errorPage, generatedCodes } from './emit-error-pages.mjs';
import { emitSchemas, schemaPath, urlPath } from './emit-schemas.mjs';

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

  const total = Object.keys(SCHEMA_URLS).length + Object.keys(SCHEMA_ALIASES).length;

  it('emits a file for every URL in SCHEMA_URLS, at the path the URL names', async () => {
    const written = await emitSchemas(publicDir);
    expect(written).toHaveLength(total);
    for (const [name, url] of Object.entries(SCHEMA_URLS)) {
      expect(`${DOCS_URL}/${schemaPath(name)}`).toBe(url);
      const file = path.join(publicDir, ...schemaPath(name).split('/'));
      const schema = JSON.parse(await fs.readFile(file, 'utf8'));
      expect(schema.$id).toBe(url);
    }
  });

  it('serves the app file schema at the old mfe.json URL too, so old $schema lines resolve', async () => {
    await emitSchemas(publicDir);
    const read = async (url) =>
      JSON.parse(await fs.readFile(path.join(publicDir, ...urlPath(url).split('/')), 'utf8'));
    const alias = await read(`${DOCS_URL}/schema/mfe.json`);
    expect(alias).toEqual(await read(SCHEMA_URLS.mfe));
    expect(alias.$id).toBe(`${DOCS_URL}/schema/mfeflow-app.json`);
    expect(alias.title).toBe('mfeflow.app.json');
  });

  it('writes again over an earlier build', async () => {
    await emitSchemas(publicDir);
    await expect(emitSchemas(publicDir)).resolves.toHaveLength(total);
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

describe('generated error pages', () => {
  it('cover the codes whose fix names a docs URL, and match the committed files', async () => {
    const codes = generatedCodes();
    expect(codes).toEqual(expect.arrayContaining(['E104', 'E113', 'E114', 'E202']));
    for (const code of codes) {
      const committed = await fs.readFile(path.join(DOCS_DIR, 'errors', `${code}.md`), 'utf8');
      expect(committed, `${code}: run pnpm --filter @mfeflow/docs generate`).toBe(errorPage(code));
    }
  });

  it('writes the pages to a folder', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-errors-'));
    try {
      const codes = await emitErrorPages(dir);
      expect((await fs.readdir(dir)).toSorted()).toEqual(codes.map((c) => `${c}.md`).toSorted());
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("has the catalogue fix text under each generated page's Fix heading", async () => {
    for (const code of generatedCodes()) {
      const { fix } = ERROR_CATALOGUE[code];
      const page = await fs.readFile(path.join(DOCS_DIR, 'errors', `${code}.md`), 'utf8');
      const section = /\n## Fix\n\n([^\n]+)/.exec(page);
      expect(section?.[1], code).toBe(fix);
    }
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

const SECTIONS = ['guide', 'concepts', 'features', 'reference'];

function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split('\n')) {
    const pair = /^(\w+):\s*(.+)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return fields;
}

async function sidebarPages(section) {
  const meta = JSON.parse(await fs.readFile(path.join(DOCS_DIR, section, '_meta.json'), 'utf8'));
  return meta.filter((item) => item.type === 'file').map((item) => item.name);
}

describe('navigation', () => {
  it('has a nav entry for every section, and a link to the repository', async () => {
    const nav = JSON.parse(await fs.readFile(path.join(DOCS_DIR, '_nav.json'), 'utf8'));
    expect(nav.map((item) => item.text)).toEqual([
      'Guide',
      'Concepts',
      'Features',
      'Reference',
      'GitHub',
    ]);
  });

  it('lists only pages that exist, each with a title and a description', async () => {
    for (const section of SECTIONS) {
      for (const name of await sidebarPages(section)) {
        const file = path.join(DOCS_DIR, section, `${name}.md`);
        const source = await fs.readFile(file, 'utf8').catch(() => '');
        const meta = frontmatter(source);
        expect(source, `${section}/${name}.md is missing`).not.toBe('');
        expect(meta.title, `${section}/${name}.md has no title`).toBeTruthy();
        expect(
          (meta.description ?? '').length,
          `${section}/${name}.md needs a specific description`,
        ).toBeGreaterThan(60);
      }
    }
  });

  it('puts every page of a section in its sidebar, apart from the old CLI and mfe.json addresses', async () => {
    for (const section of SECTIONS) {
      const listed = new Set(await sidebarPages(section));
      const files = (await fs.readdir(path.join(DOCS_DIR, section)))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -'.md'.length));
      const moved = (f) =>
        (section === 'guide' && f === 'cli') || (section === 'reference' && f === 'mfe-json');
      const unlisted = files.filter((f) => !listed.has(f) && !moved(f));
      expect(unlisted, `${section} pages missing from _meta.json`).toEqual([]);
    }
  });

  it('has one h1 on every page', async () => {
    for (const file of await markdownFiles(DOCS_DIR)) {
      const body = (await fs.readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
      const h1 = body.match(/^# .+$/gm) ?? [];
      expect(h1.length, `${file} needs exactly one h1`).toBe(1);
    }
  });
});

describe('links', () => {
  it('resolves every internal link to a page', async () => {
    const pages = new Set();
    for (const file of await markdownFiles(DOCS_DIR)) {
      const route = path.relative(DOCS_DIR, file).split(path.sep).join('/').replace(/\.md$/, '');
      pages.add(route);
      if (route.endsWith('/index')) pages.add(route.slice(0, -'index'.length));
    }
    const broken = [];
    for (const file of await markdownFiles(DOCS_DIR)) {
      const body = (await fs.readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
      for (const [, target] of body.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const route = target.split('#')[0].replace(/^\//, '');
        if (route !== '' && !pages.has(route))
          broken.push(`${path.relative(DOCS_DIR, file)} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
