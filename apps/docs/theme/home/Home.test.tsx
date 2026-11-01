import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import cli from '../../../../packages/cli/package.json';
import { Home } from './Home';
import { DOCUMENTED_FEATURES, FEATURE_GROUPS } from './content';

vi.mock('@rspress/core/runtime', () => ({ withBase: (url: string) => `/mfeflow${url}` }));

const ROOT = path.join(import.meta.dirname, '../../../..');
const FEATURES_DIR = path.join(import.meta.dirname, '../../docs/features');
const html = renderToStaticMarkup(<Home />);

describe('home page', () => {
  it('has exactly one h1, the headline', () => {
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('One command.');
    expect(html).toContain('Every remote.');
    expect(html).toContain('Pick only what you need.');
  });

  it('reads the version from the mfeflow package', () => {
    expect(html).toContain(`${cli.version} ON NPM`);
  });

  it('renders the key copy', () => {
    for (const copy of [
      'pnpm create mfeflow my-platform',
      'Read the docs',
      '5.3 s',
      '+160 ms',
      'From empty folder to a running platform.',
      'Many teams, one platform that holds.',
      'Roll back by pointer, not by rebuild.',
      'Start with one command.',
      'MIT licensed · built in the open',
    ]) {
      expect(html).toContain(copy);
    }
  });

  it('renders the install command as plain text with no copy button before hydration', () => {
    expect(html).not.toContain('mf-install__copy');
  });

  it('links to the quickstart under the site base', () => {
    expect(html).toContain('href="/mfeflow/guide/quickstart"');
  });

  it('links a feature chip only when its page exists', () => {
    const pages = fs
      .readdirSync(FEATURES_DIR)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.replace(/\.md$/, ''))
      .filter((name) => name !== 'index' && name !== 'third-party');
    expect(new Set(DOCUMENTED_FEATURES)).toEqual(new Set(pages));

    const linked = [...html.matchAll(/href="\/mfeflow\/features\/([a-z0-9-]+)"/g)].map((m) => m[1]);
    for (const name of linked) expect(pages).toContain(name);
    for (const group of FEATURE_GROUPS) {
      for (const feature of group.features) {
        expect(html).toContain(feature);
        expect(linked.includes(feature)).toBe(pages.includes(feature));
      }
    }
  });

  it('keeps the 23 features and 19 packages counts true to the repo', () => {
    expect(fs.readdirSync(path.join(ROOT, 'features'))).toHaveLength(23);
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('There are 23 first-party features.');
    expect(readme).toContain('- 23 features you add one at a time');
    expect(fs.readdirSync(path.join(ROOT, 'packages'))).toHaveLength(19);
  });

  it('embeds JSON-LD for the source code', () => {
    const raw = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1] ?? '';
    const data: unknown = JSON.parse(raw.replaceAll('&quot;', '"'));
    expect(data).toMatchObject({
      '@type': 'SoftwareSourceCode',
      programmingLanguage: 'TypeScript',
      codeRepository: 'https://github.com/mfeflow/mfeflow',
    });
  });
});
