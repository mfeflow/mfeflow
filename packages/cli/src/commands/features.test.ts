import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addTrusted, serializeProject } from '@mfeflow/core';
import type { FetchLike } from '@mfeflow/core';
import { main, validateResult, type FeaturesResult } from '..';
import { removeDir, tempDir, testRuntime } from '../testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function emptyFolder(): Promise<string> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

function jsonOf(out: string[]): FeaturesResult {
  const value: unknown = JSON.parse(out.join(''));
  expect(validateResult(value)).toEqual([]);
  return value as FeaturesResult;
}

describe('mfeflow features', () => {
  it('lists every first-party feature with version, description and how it is chosen', async () => {
    const rt = testRuntime();
    expect(await main(['features', '--cwd', await emptyFolder()], rt)).toBe(0);
    const text = rt.io.out.join('\n');
    expect(text).toMatch(/core\s+\d+\.\d+\.\d+\s+.*\[always\]/);
    expect(text).toMatch(/lint-oxlint\s+.*\[default\]/);
    expect(text).toMatch(/git-hooks\s+.*\[opt-in\]/);
    expect(text).toContain('mfeflow add @namespace/name');
  });

  it('filters by name or description, ignoring case', async () => {
    const rt = testRuntime();
    await main(['features', 'OXLINT', '--json', '--cwd', await emptyFolder()], rt);
    const result = jsonOf(rt.io.out);
    expect(result.search).toBe('OXLINT');
    expect(result.features.map((f) => f.name)).toEqual(['lint-oxlint']);
    const byDescription = testRuntime();
    await main(['features', 'commitlint', '--json', '--cwd', await emptyFolder()], byDescription);
    expect(jsonOf(byDescription.io.out).features.map((f) => f.name)).toEqual([
      'git-hooks',
      'commit-prompt',
    ]);
  });

  it('says when nothing matches, and still exits 0', async () => {
    const rt = testRuntime();
    expect(await main(['features', 'zzz', '--cwd', await emptyFolder()], rt)).toBe(0);
    expect(rt.io.out.join('\n')).toContain('No features match "zzz".');
  });

  it('marks what the project in the working folder already has', async () => {
    const cwd = await emptyFolder();
    await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime());
    const rt = testRuntime();
    await main(['features', '--json', '--cwd', path.join(cwd, 'app')], rt);
    const installed = Object.fromEntries(
      jsonOf(rt.io.out).features.map((f) => [f.name, f.installed]),
    );
    expect(installed).toEqual({
      core: true,
      tsconfig: true,
      'lint-oxlint': true,
      'url-factory': true,
      'env-t3': true,
      testing: true,
      'analytics-gtm': false,
      'telemetry-otel': false,
      'event-bus': false,
      'route-factory': false,
      http: false,
      theming: false,
      i18n: false,
      tailwind: false,
      'ui-shadcn': false,
      forms: false,
      'data-react-query': false,
      'analytics-clarity': false,
      storybook: false,
      'ci-github': false,
      'git-hooks': false,
      'commit-prompt': false,
      'registry-static': false,
      release: false,
    });
    const outside = testRuntime();
    await main(['features', '--json', '--cwd', cwd], outside);
    expect(jsonOf(outside.io.out).features.every((f) => !f.installed)).toBe(true);
  });
});

describe('mfeflow features across registries', () => {
  const ALPHA = 'https://alpha.example/{name}.json';
  const BETA = 'https://beta.example/r/{name}.json';
  const ALL = ['@alpha', '@beta', '@gamma'];
  const index = (...items: object[]) => JSON.stringify({ items });
  const hello = {
    name: 'hello',
    version: '1.2.0',
    description: 'Says hello',
    keywords: ['greeting', 'demo'],
  };
  const analytics = { name: 'segment', version: '0.3.0', description: 'Segment analytics' };

  async function project(registries: Record<string, string>, installed: string[] = []) {
    const cwd = await emptyFolder();
    await fs.writeFile(
      path.join(cwd, 'mfeflow.json'),
      serializeProject({
        version: 1,
        topology: 'monorepo',
        packageManager: 'pnpm',
        scope: '@acme',
        apps: { shell: { kind: 'shell', path: 'apps/shell', port: 4300 } },
        features: Object.fromEntries(installed.map((name) => [name, { version: '1.0.0' }])),
        registries,
      }),
    );
    return cwd;
  }

  /** Answers by URL; anything else is a 404. Records what was asked, in order. */
  function serving(answers: Record<string, string | Error>) {
    const asked: string[] = [];
    const fetch: FetchLike = (url) => {
      asked.push(url);
      const answer = answers[url];
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({
        ok: answer !== undefined,
        status: answer === undefined ? 404 : 200,
        text: () => Promise.resolve(answer ?? ''),
      });
    };
    return { fetch, asked };
  }

  it('lists first-party and registry features with their source, name, version and description', async () => {
    const cwd = await project({ '@alpha': ALPHA, '@beta': BETA }, ['@alpha/hello']);
    const { fetch, asked } = serving({
      'https://alpha.example/index.json': index(hello),
      'https://beta.example/r/index.json': index(analytics),
    });
    const rt = testRuntime({ fetch, trust: ALL });
    expect(await main(['features', '--cwd', cwd], rt)).toBe(0);
    const text = rt.io.out.join('\n');
    expect(text).toMatch(/^ {2}mfeflow core +\d+\.\d+\.\d+ .*\[always\]/m);
    expect(text).toMatch(
      /^ {2}@alpha {2}@alpha\/hello +1\.2\.0 +Says hello \[registry, installed\]/m,
    );
    expect(text).toMatch(/^ {2}@beta {3}@beta\/segment +0\.3\.0 +Segment analytics \[registry\]/m);
    expect(asked.toSorted()).toEqual([
      'https://alpha.example/index.json',
      'https://beta.example/r/index.json',
    ]);
  });

  it('asks every registry at the same time', async () => {
    const cwd = await project({ '@alpha': ALPHA, '@beta': BETA });
    let open = 0;
    let peak = 0;
    const fetch: FetchLike = async () => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise((resolve) => setTimeout(resolve, 20));
      open -= 1;
      return { ok: true, status: 200, text: () => Promise.resolve(index()) };
    };
    await main(['features', '--cwd', cwd], testRuntime({ fetch, trust: ALL }));
    expect(peak).toBe(2);
  });

  it('searches names, descriptions and keywords of registry items', async () => {
    const cwd = await project({ '@alpha': ALPHA });
    const answers = { 'https://alpha.example/index.json': index(hello, analytics) };
    const find = async (search: string) => {
      const rt = testRuntime({ fetch: serving(answers).fetch, trust: ALL });
      await main(['features', search, '--json', '--cwd', cwd], rt);
      return jsonOf(rt.io.out).features.map((f) => f.name);
    };
    expect(await find('greeting')).toEqual(['@alpha/hello']);
    expect(await find('SEGMENT')).toEqual(['@alpha/segment']);
    expect(await find('@alpha')).toEqual(['@alpha/hello', '@alpha/segment']);
    expect(await find('analytics')).toEqual([
      'analytics-gtm',
      'analytics-clarity',
      '@alpha/segment',
    ]);
  });

  it('shows the source of each feature in --json, and a status per registry', async () => {
    const cwd = await project({ '@alpha': ALPHA });
    const rt = testRuntime({
      fetch: serving({ 'https://alpha.example/index.json': index(hello) }).fetch,
      trust: ALL,
    });
    await main(['features', 'hello', '--json', '--cwd', cwd], rt);
    const result = jsonOf(rt.io.out);
    expect(result.features).toEqual([
      {
        source: '@alpha',
        name: '@alpha/hello',
        version: '1.2.0',
        description: 'Says hello',
        always: false,
        default: false,
        installed: false,
      },
    ]);
    expect(result.registries).toEqual([
      {
        namespace: '@alpha',
        index: 'https://alpha.example/index.json',
        trusted: true,
        items: 1,
        error: null,
      },
    ]);
  });

  it('reports a registry that is down and still lists the others and first-party', async () => {
    const cwd = await project({
      '@alpha': ALPHA,
      '@beta': BETA,
      '@gamma': 'https://g.example/{name}.json',
    });
    const { fetch } = serving({
      'https://alpha.example/index.json': new Error('ECONNREFUSED'),
      'https://beta.example/r/index.json': index(analytics),
      'https://g.example/index.json': '<html>not an index</html>',
    });
    const human = testRuntime({ fetch, trust: ALL });
    expect(await main(['features', '--cwd', cwd], human)).toBe(0);
    expect(human.io.out.join('\n')).toContain('@beta/segment');
    expect(human.io.out.join('\n')).toContain('core');
    const complaints = human.io.err.join('\n');
    expect(complaints).toContain('Could not read @alpha');
    expect(complaints).toContain('ECONNREFUSED');
    expect(complaints).toContain('Could not read @gamma');
    expect(complaints).toContain('mfeflow registry build');

    const rt = testRuntime({ fetch, trust: ALL });
    expect(await main(['features', '--json', '--cwd', cwd], rt)).toBe(0);
    const result = jsonOf(rt.io.out);
    expect(result.registries.map((r) => [r.namespace, r.items, r.error?.code ?? null])).toEqual([
      ['@alpha', 0, 'MFEFLOW_E401'],
      ['@beta', 1, null],
      ['@gamma', 0, 'MFEFLOW_E403'],
    ]);
    expect(result.features.some((f) => f.name === '@beta/segment')).toBe(true);
  });

  it('says a 404 means the registry has no index.json', async () => {
    const cwd = await project({ '@alpha': ALPHA });
    const rt = testRuntime({ fetch: serving({}).fetch, trust: ALL });
    await main(['features', '--cwd', cwd], rt);
    expect(rt.io.err.join('\n')).toContain('this registry has no index.json');
  });

  it('does not ask the network outside a project or with no registries', async () => {
    const { fetch, asked } = serving({});
    await main(['features', '--cwd', await emptyFolder()], testRuntime({ fetch, trust: ALL }));
    await main(['features', '--cwd', await project({})], testRuntime({ fetch, trust: ALL }));
    expect(asked).toEqual([]);
  });

  it('lets a broken mfeflow.json through as an error instead of ignoring the registries', async () => {
    const cwd = await emptyFolder();
    await fs.writeFile(path.join(cwd, 'mfeflow.json'), '{');
    const rt = testRuntime();
    expect(await main(['features', '--cwd', cwd], rt)).toBe(3);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E103');
  });

  it('does not ask a registry that only the project names, and says how to trust it', async () => {
    const cwd = await project({ '@alpha': ALPHA, '@beta': BETA });
    const { fetch, asked } = serving({ 'https://beta.example/r/index.json': index(analytics) });
    const rt = testRuntime({ fetch, trust: ['@beta'] });
    expect(await main(['features', '--cwd', cwd], rt)).toBe(0);
    expect(asked).toEqual(['https://beta.example/r/index.json']);
    const text = rt.io.out.join('\n');
    expect(text).toContain('@beta/segment');
    expect(text).toContain('@alpha: not trusted yet');
    expect(text).toContain('mfeflow registry trust @alpha');
    expect(rt.io.err).toEqual([]);
  });

  it('asks nothing at all when no registry is trusted, and reports each as untrusted in --json', async () => {
    const cwd = await project({ '@alpha': ALPHA, '@local': 'http://127.0.0.1:4010/{name}.json' });
    const { fetch, asked } = serving({});
    const rt = testRuntime({ fetch });
    expect(await main(['features', '--json', '--cwd', cwd], rt)).toBe(0);
    expect(asked).toEqual([]);
    expect(jsonOf(rt.io.out).registries).toEqual([
      {
        namespace: '@alpha',
        index: 'https://alpha.example/index.json',
        trusted: false,
        items: 0,
        error: null,
      },
      {
        namespace: '@local',
        index: 'http://127.0.0.1:4010/index.json',
        trusted: false,
        items: 0,
        error: null,
      },
    ]);
  });

  it('trusts a registry from the trust file only for the URL that was trusted', async () => {
    const cwd = await project({ '@alpha': ALPHA });
    const rt = testRuntime();
    await addTrusted(rt.configDir, {
      namespace: '@alpha',
      template: 'https://elsewhere.example/{name}.json',
    });
    const { fetch, asked } = serving({});
    const other = testRuntime({ fetch, configDir: rt.configDir });
    await main(['features', '--cwd', cwd], other);
    expect(asked).toEqual([]);
    await addTrusted(rt.configDir, { namespace: '@alpha', template: ALPHA });
    await main(['features', '--cwd', cwd], other);
    expect(asked).toEqual(['https://alpha.example/index.json']);
  });

  it('asks a trusted loopback registry, and never prints a token from the URL', async () => {
    const cwd = await project({ '@local': 'http://127.0.0.1:4010/{name}.json?token=hunter2' });
    const { fetch, asked } = serving({});
    const pinned = ['@local=http://127.0.0.1:4010/{name}.json?token=hunter2'];
    const rt = testRuntime({ fetch, trust: pinned });
    await main(['features', '--cwd', cwd], rt);
    expect(asked).toEqual(['http://127.0.0.1:4010/index.json']);
    const json = testRuntime({ fetch, trust: pinned });
    await main(['features', '--json', '--cwd', cwd], json);
    expect(rt.io.out.join('\n') + rt.io.err.join('\n') + json.io.out.join('')).not.toContain(
      'hunter2',
    );
  });

  it('redacts a token in the registry URL in the index it reports', async () => {
    const cwd = await project({ '@alpha': 'https://alpha.example/r/{name}.json?sig=abc123' });
    const rt = testRuntime({ fetch: serving({}).fetch, trust: ['@alpha'] });
    await main(['features', '--cwd', cwd], rt);
    expect(rt.io.err.join('\n')).not.toContain('abc123');
    const json = testRuntime({ fetch: serving({}).fetch, trust: ['@alpha'] });
    await main(['features', '--json', '--cwd', cwd], json);
    expect(jsonOf(json.io.out).registries[0]?.index).toBe('https://alpha.example/r/index.json');
  });

  it('does not ask a loopback registry that the environment trusts by namespace only', async () => {
    const cwd = await project({ '@local': 'https://169.254.169.254/{name}.json' });
    const { fetch, asked } = serving({});
    const rt = testRuntime({ fetch, trust: ['@local'] });
    await main(['features', '--json', '--cwd', cwd], rt);
    expect(asked).toEqual([]);
    expect(jsonOf(rt.io.out).registries[0]?.error?.code).toBe('MFEFLOW_E405');
  });
});
