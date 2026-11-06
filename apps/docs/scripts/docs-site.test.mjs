import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOCS_URL, SCHEMA_ALIASES, SCHEMA_URLS } from '@mfeflow/contracts';
import { ERROR_CATALOGUE } from '@mfeflow/core';
import cli from '../../../packages/cli/package.json';
import config from '../rspress.config';
import { breadcrumbList, breadcrumbScript, LLMS_SUMMARY, renderLlmsTxt } from '../seo';
import {
  clampDescription,
  emitErrorPages,
  errorPage,
  generatedCodes,
  yamlString,
} from './emit-error-pages.mjs';
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

const unquote = (value) => value.slice(1, -1).replaceAll("''", "'");

describe('error pages', () => {
  it('has a page for every code in the error catalogue', async () => {
    const missing = [];
    for (const code of Object.keys(ERROR_CATALOGUE)) {
      const page = await fs
        .readFile(path.join(DOCS_DIR, 'errors', `${code}.md`), 'utf8')
        .catch(() => '');
      if (!page.replace(/^---\n[\s\S]*?\n---\n\n/, '').startsWith(`# MFEFLOW_${code}\n`))
        missing.push(code);
    }
    expect(missing).toEqual([]);
  });

  it('titles every page with the code and the catalogue title, and keeps descriptions short', async () => {
    for (const [code, { title }] of Object.entries(ERROR_CATALOGUE)) {
      const page = await fs.readFile(path.join(DOCS_DIR, 'errors', `${code}.md`), 'utf8');
      const meta = /^---\ntitle: (.+)\ndescription: (.+)\n---\n/.exec(page);
      expect(meta, code).not.toBeNull();
      expect(unquote(meta[1]), code).toBe(`MFEFLOW_${code}: ${title}`);
      expect(unquote(meta[2]).length, code).toBeLessThanOrEqual(151);
    }
  });

  it('quotes YAML strings the way prettier does', () => {
    expect(yamlString('a: b')).toBe("'a: b'");
    expect(yamlString("it's")).toBe('"it\'s"');
  });

  it('clamps long text at a word boundary', () => {
    expect(clampDescription('short `text`')).toBe('short text');
    const clamped = clampDescription('word '.repeat(60));
    expect(clamped.length).toBeLessThanOrEqual(151);
    expect(clamped.endsWith('word…')).toBe(true);
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
  it('serves under the path of DOCS_URL, with clean URLs and a custom llms.txt', () => {
    expect(config.base).toBe('/mfeflow/');
    expect(config.route?.cleanUrls).toBe(true);
    expect(config.llms).toEqual({ llmsTxt: renderLlmsTxt });
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

async function sidebarPages(section, folder = '') {
  const dir = path.join(DOCS_DIR, section, folder);
  const meta = JSON.parse(await fs.readFile(path.join(dir, '_meta.json'), 'utf8'));
  const pages = [];
  for (const item of meta) {
    if (item.type === 'file') pages.push(path.posix.join(folder, item.name));
    if (item.type === 'dir')
      pages.push(...(await sidebarPages(section, path.posix.join(folder, item.name))));
    if (item.type === 'custom-link' && item.link?.startsWith(`/${section}/`))
      pages.push(item.link.slice(`/${section}/`.length));
  }
  return pages;
}

async function pagesIn(section, folder = '') {
  const found = [];
  for (const entry of await fs.readdir(path.join(DOCS_DIR, section, folder), {
    withFileTypes: true,
  })) {
    const name = path.posix.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await pagesIn(section, name)));
    else if (entry.name.endsWith('.md')) found.push(name.slice(0, -'.md'.length));
  }
  return found;
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

  it('puts every page of a section in its sidebar, apart from the old addresses', async () => {
    const stubs = new Set(['guide/cli', 'guide/deploying', 'reference/mfe-json']);
    for (const section of SECTIONS) {
      const listed = new Set(await sidebarPages(section));
      const unlisted = (await pagesIn(section)).filter(
        (f) => !listed.has(f) && !stubs.has(`${section}/${f}`),
      );
      expect(unlisted, `${section} pages missing from _meta.json`).toEqual([]);
    }
  });

  it('opens the Deploy group with its overview and lists every Deploy page', async () => {
    const meta = JSON.parse(
      await fs.readFile(path.join(DOCS_DIR, 'guide/deploy/_meta.json'), 'utf8'),
    );
    expect(meta[0]).toMatchObject({ type: 'file', name: 'index' });
    const guide = JSON.parse(await fs.readFile(path.join(DOCS_DIR, 'guide/_meta.json'), 'utf8'));
    expect(guide).toContainEqual(expect.objectContaining({ type: 'dir', name: 'deploy' }));
    const names = new Set(meta.filter((i) => i.type === 'file').map((i) => i.name));
    for (const file of await fs.readdir(path.join(DOCS_DIR, 'guide/deploy'))) {
      if (file.endsWith('.md')) expect(names.has(file.slice(0, -3)), file).toBe(true);
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

describe('deploy pages', () => {
  it('keep prose light: at most three inline code spans per paragraph or list item', async () => {
    const dense = [];
    for (const file of await markdownFiles(path.join(DOCS_DIR, 'guide/deploy'))) {
      const body = (await fs.readFile(file, 'utf8'))
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/```[\s\S]*?```/g, '');
      for (const block of body.split(/\n\s*\n/)) {
        const lines = block.split('\n').filter((l) => !l.startsWith('|') && !l.startsWith('#'));
        const units = lines.some((l) => /^\s*[-*] /.test(l))
          ? lines.join('\n').split(/\n(?=\s*[-*] )/)
          : [lines.join(' ')];
        for (const unit of units) {
          const spans = unit.match(/`[^`]+`/g) ?? [];
          if (spans.length > 3) dense.push(`${path.basename(file)}: ${unit.slice(0, 60)}`);
        }
      }
    }
    expect(dense).toEqual([]);
  });

  it('say that hosting is the reader choice, on the overview', async () => {
    const overview = await fs.readFile(path.join(DOCS_DIR, 'guide/deploy/index.md'), 'utf8');
    expect(overview).toContain('stays out of how you host them');
  });
});

const file = (name) => path.join(DOCS_DIR, name);

describe('breadcrumbs', () => {
  it('lists the home page, the page itself and its title, with absolute URLs', () => {
    const list = breadcrumbList('/guide/quickstart', file('guide/quickstart.md'));
    expect(list['@type']).toBe('BreadcrumbList');
    expect(list.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(list.itemListElement[0]).toMatchObject({ name: 'mfeflow', item: `${DOCS_URL}/` });
    expect(list.itemListElement.at(-1)).toMatchObject({
      name: expect.stringContaining('Quickstart'),
      item: `${DOCS_URL}/guide/quickstart`,
    });
  });

  it('adds a parent only when that parent is a real page', () => {
    const deploy = breadcrumbList('/guide/deploy/own-server', file('guide/deploy/own-server.md'));
    expect(deploy.itemListElement.map((i) => i.item)).toEqual([
      `${DOCS_URL}/`,
      `${DOCS_URL}/guide/deploy/`,
      `${DOCS_URL}/guide/deploy/own-server`,
    ]);
  });

  it('has none for the home page or the 404 page, and escapes < in the script', () => {
    expect(breadcrumbList('/', file('index.mdx'))).toBeUndefined();
    expect(breadcrumbScript('/404', file('index.mdx'))).toBeUndefined();
    const script = breadcrumbScript('/guide/quickstart', file('guide/quickstart.md'));
    expect(script).toMatch(/^<script type="application\/ld\+json">\{.*\}<\/script>$/);
  });
});

const page = (routePath, title) => ({
  routePath,
  link: `${DOCS_URL}${routePath}.md`,
  title,
  description: `About ${title}`,
  frontmatter: {},
  lang: 'en',
  version: '',
});

describe('llms.txt', () => {
  const out = renderLlmsTxt({
    title: 'mfeflow',
    sections: [
      { title: 'Guide', pages: [page('/guide/quickstart', 'Quickstart')] },
      {
        title: 'Reference',
        pages: [page('/errors/E101', 'MFEFLOW_E101'), page('/reference/cli', 'CLI')],
      },
    ],
  });

  it('opens with the summary, which names the version, license, bundlers and limits', () => {
    expect(out.startsWith(`# mfeflow\n\n> ${LLMS_SUMMARY}\n`)).toBe(true);
    for (const fact of [cli.version, 'MIT', 'Rsbuild', 'Vite', 'Module Federation 2', 'not for']) {
      expect(LLMS_SUMMARY).toContain(fact);
    }
  });

  it('lists the error pages last, in their own section', () => {
    expect(out.indexOf('## Error codes')).toBeGreaterThan(out.indexOf('## Reference'));
    expect(out.slice(out.indexOf('## Error codes'))).toContain('MFEFLOW_E101');
    expect(out.slice(0, out.indexOf('## Error codes'))).not.toContain('MFEFLOW_E101');
  });
});
