import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike, FetchResponse } from '@mfeflow/core';
import { main, validateResult, type ReportResult } from '..';
import { removeDir, tempDir, testRuntime } from '../testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function project(): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  expect(await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime())).toBe(0);
  return path.join(cwd, 'app');
}

async function install(app: string, name: string, version: string): Promise<void> {
  const dir = path.join(app, 'node_modules', ...name.split('/'));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
}

const manifest = (react: string | undefined, extra: object[] = []): string =>
  JSON.stringify({
    name: 'shell',
    shared: [
      ...(react === undefined ? [] : [{ name: 'react', version: react, singleton: true }]),
      ...extra,
    ],
  });

async function write(root: string, file: string, text: string): Promise<string> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
  return target;
}

async function run(
  root: string,
  args: string[],
  fetch?: FetchLike,
): Promise<{ code: number; result: ReportResult; err: string }> {
  const rt = testRuntime(fetch === undefined ? {} : { fetch });
  const code = await main(['check-compat', ...args, '--json', '--cwd', root], rt);
  const text = rt.io.out.join('');
  const value: unknown = JSON.parse(text);
  if (text.includes('"command"')) expect(validateResult(value)).toEqual([]);
  return { code, result: value as ReportResult, err: text + rt.io.err.join('') };
}

function answer(body: string, init: Partial<FetchResponse> = {}): FetchResponse {
  return { ok: true, status: 200, text: () => Promise.resolve(body), ...init };
}

function serving(files: Record<string, FetchResponse>): FetchLike & { asked: string[] } {
  const asked: string[] = [];
  const fetch: FetchLike = (url) => {
    asked.push(url);
    return Promise.resolve(files[url] ?? answer('', { ok: false, status: 404 }));
  };
  return Object.assign(fetch, { asked });
}

async function polyrepo(): Promise<string> {
  const root = await project();
  await fs.rm(path.join(root, 'apps/shell'), { recursive: true });
  for (const remote of ['cart', 'catalog'])
    await install(path.join(root, 'apps', remote), 'react', '18.3.1');
  return root;
}

describe('check-compat without the shell in this repo', () => {
  it('warns what to pass instead of passing silently, and exits 0', async () => {
    const root = await polyrepo();
    const { code, result } = await run(root, []);
    expect(code).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.summary.warnings).toBe(1);
    expect(result.findings).toMatchObject([{ code: 'MFEFLOW_E302', severity: 'warning' }]);
    expect(result.findings[0]?.message).toContain(
      'shell is not in this repo, pass --against <url|file>',
    );
    expect(result.checks[0]?.status).toBe('warn');
    expect(result.against).toBeUndefined();
  });

  it('does not warn when there is no remote to check', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'apps/shell'), { recursive: true });
    for (const name of ['cart', 'catalog'])
      await fs.rm(path.join(root, 'apps', name), { recursive: true });
    expect((await run(root, [])).result.findings).toEqual([]);
  });
});

describe('check-compat --against a file', () => {
  it('rejects a remote whose react is skewed from the shell', async () => {
    const root = await polyrepo();
    const file = await write(root, 'shell.json', manifest('19.1.0'));
    const { code, result } = await run(root, ['--against', file]);
    expect(code).toBe(5);
    expect(result.ok).toBe(false);
    expect(result.against).toBe(file);
    expect(result.findings).toMatchObject([
      { code: 'MFEFLOW_E302', severity: 'error', app: 'catalog' },
      { code: 'MFEFLOW_E302', severity: 'error', app: 'cart' },
    ]);
    expect(result.findings[1]?.message).toContain(
      'cart uses react 18.3.1, the shell provides 19.1.0',
    );
  });

  it('passes when the shell satisfies every remote, and resolves a relative path from --cwd', async () => {
    const root = await polyrepo();
    await write(root, 'shell.json', manifest('18.3.1'));
    const { code, result } = await run(root, ['--against', 'shell.json']);
    expect(code).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.checks[0]?.status).toBe('pass');
  });

  it("checks the remote's mfeflow.app.json platform ranges", async () => {
    const root = await polyrepo();
    const mfe = path.join(root, 'apps/cart/mfeflow.app.json');
    const doc = JSON.parse(await fs.readFile(mfe, 'utf8')) as Record<string, unknown>;
    await fs.writeFile(mfe, JSON.stringify({ ...doc, platform: { '@mfeflow/runtime': '^0.2' } }));
    const file = await write(
      root,
      'shell.json',
      manifest('18.3.1', [{ name: '@mfeflow/runtime', version: '0.3.0' }]),
    );
    const { result } = await run(root, ['--against', file]);
    expect(result.findings[0]?.message).toContain(
      'cart needs @mfeflow/runtime ^0.2 (mfeflow.app.json platform) but the shell has 0.3.0',
    );
  });

  it('reports versions that cannot be compared (workspace:, catalog:) as warnings', async () => {
    const root = await polyrepo();
    const file = await write(
      root,
      'shell.json',
      manifest('workspace:*', [{ name: 'react-dom', version: 'catalog:' }]),
    );
    await install(path.join(root, 'apps/cart'), 'react-dom', '18.3.1');
    const { code, result } = await run(root, ['--against', file]);
    expect(code).toBe(0);
    const messages = result.findings.map((f) => f.message);
    expect(result.findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(messages.some((m) => m.includes('react is the shell workspace:*'))).toBe(true);
    expect(messages.some((m) => m.includes('react-dom is the shell catalog:'))).toBe(true);
  });

  it("reports a remote's own unresolved version", async () => {
    const root = await polyrepo();
    await install(path.join(root, 'apps/cart'), 'react', 'workspace:*');
    const file = await write(root, 'shell.json', manifest('18.3.1'));
    const { code, result } = await run(root, ['--against', file]);
    expect(code).toBe(0);
    expect(result.findings).toMatchObject([{ severity: 'warning' }]);
    expect(result.findings[0]?.message).toContain('cart workspace:*');
  });

  it('reads the shell manifest beside a registry index file', async () => {
    const root = await polyrepo();
    const index = await write(root, 'envs/prod/index.json', JSON.stringify({ remotes: [] }));
    await write(root, 'envs/prod/shell/mf-manifest.json', manifest('19.1.0'));
    const { code, result } = await run(root, ['--against', index]);
    expect(code).toBe(5);
    expect(result.findings[0]?.message).toContain('the shell provides 19.1.0');
  });

  it('fails with E307 when the index has no shell manifest beside it', async () => {
    const root = await polyrepo();
    const index = await write(root, 'envs/prod/index.json', JSON.stringify({ remotes: [] }));
    const { code, err } = await run(root, ['--against', index]);
    expect(code).toBe(5);
    expect(err).toContain('MFEFLOW_E307');
  });

  it('fails with E307 for a missing file, bad JSON and an unrelated document', async () => {
    const root = await polyrepo();
    const bad = await write(root, 'bad.json', '{ nope');
    const other = await write(root, 'other.json', JSON.stringify({ name: 'x' }));
    for (const source of [path.join(root, 'missing.json'), bad, other]) {
      const { code, err } = await run(root, ['--against', source]);
      expect(code).toBe(5);
      expect(err).toContain('MFEFLOW_E307');
    }
  });
});

describe('check-compat --against a URL', () => {
  const SHELL = 'https://cdn.example.com/envs/prod/shell/mf-manifest.json';
  const INDEX = 'https://cdn.example.com/envs/prod/index.json';

  it('reads a deployed shell manifest', async () => {
    const root = await polyrepo();
    const fetch = serving({ [SHELL]: answer(manifest('19.1.0')) });
    const { code, result } = await run(root, ['--against', SHELL], fetch);
    expect(code).toBe(5);
    expect(fetch.asked).toEqual([SHELL]);
    expect(result.against).toBe(SHELL);
  });

  it('reads the index, then the shell manifest beside it', async () => {
    const root = await polyrepo();
    const fetch = serving({
      [INDEX]: answer(JSON.stringify({ env: 'prod', remotes: [] })),
      [SHELL]: answer(manifest('18.3.1')),
    });
    const { code, result } = await run(root, ['--against', INDEX], fetch);
    expect(code).toBe(0);
    expect(fetch.asked).toEqual([INDEX, SHELL]);
    expect(result.findings).toEqual([]);
  });

  it('allows plain http on loopback', async () => {
    const root = await polyrepo();
    const url = 'http://127.0.0.1:4000/mf-manifest.json';
    const { code } = await run(
      root,
      ['--against', url],
      serving({ [url]: answer(manifest('18.3.1')) }),
    );
    expect(code).toBe(0);
  });

  it('refuses plain http anywhere else without asking', async () => {
    const root = await polyrepo();
    const url = 'http://cdn.example.com/mf-manifest.json';
    const fetch = serving({ [url]: answer(manifest('18.3.1')) });
    const { code, err } = await run(root, ['--against', url], fetch);
    expect(code).toBe(5);
    expect(err).toContain('MFEFLOW_E307');
    expect(fetch.asked).toEqual([]);
  });

  it('refuses a redirect to a private host', async () => {
    const root = await polyrepo();
    const fetch = serving({
      [SHELL]: answer('', {
        ok: false,
        status: 302,
        headers: { get: () => 'https://10.0.0.5/mf-manifest.json' },
      }),
    });
    const { code, err } = await run(root, ['--against', SHELL], fetch);
    expect(code).toBe(5);
    expect(err).toContain('MFEFLOW_E307');
    expect(fetch.asked).toEqual([SHELL]);
  });

  it('refuses an answer over 1 MB', async () => {
    const root = await polyrepo();
    const fetch = serving({ [SHELL]: answer('x'.repeat(1_000_001)) });
    const { code, err } = await run(root, ['--against', SHELL], fetch);
    expect(code).toBe(5);
    expect(err).toContain('larger than 1 MB');
  });

  it('fails with E307 on a 404 and on a network error', async () => {
    const root = await polyrepo();
    expect((await run(root, ['--against', SHELL], serving({}))).err).toContain('answered 404');
    const down: FetchLike = () => Promise.reject(new Error('connect ECONNREFUSED'));
    expect((await run(root, ['--against', SHELL], down)).err).toContain('MFEFLOW_E307');
  });

  it('keeps a token in the URL out of the --json report', async () => {
    const root = await polyrepo();
    const url = `${SHELL}?token=secret123`;
    const { result } = await run(
      root,
      ['--against', url],
      serving({ [url]: answer(manifest('18.3.1')) }),
    );
    expect(result.against).not.toContain('secret123');
  });
});

describe('check-compat --json', () => {
  it('prints the report shape with the against field only when given', async () => {
    const root = await polyrepo();
    const file = await write(root, 'shell.json', manifest('18.3.1'));
    const given = (await run(root, ['--against', file])).result;
    expect(Object.keys(given).toSorted()).toEqual(
      ['against', 'checks', 'command', 'findings', 'ok', 'root', 'summary'].toSorted(),
    );
    expect(given.command).toBe('check-compat');
    expect(given.checks).toMatchObject([{ id: 'compat', status: 'pass', findings: 0 }]);
    const without = (await run(root, [])).result;
    expect(Object.keys(without)).not.toContain('against');
  });
});

describe('check-compat --against edge cases', () => {
  it('masks credentials and tokens in the E307 message, in stderr and in --json', async () => {
    const root = await polyrepo();
    const url = 'https://u:p@cdn.example.com/index.json?token=abc';
    const rt = testRuntime({ fetch: serving({}) });
    expect(await main(['check-compat', '--against', url, '--cwd', root], rt)).toBe(5);
    const down: FetchLike = () => Promise.reject(new Error('connect ECONNREFUSED'));
    for (const fetch of [serving({}), down]) {
      const { err } = await run(root, ['--against', url], fetch);
      expect(err).toContain('MFEFLOW_E307');
      expect(err).not.toContain('abc');
      expect(err).not.toContain('p@');
    }
    const plain = rt.io.err.join('') + rt.io.out.join('');
    expect(plain).not.toContain('abc');
    expect(plain).not.toContain('p@');
  });

  it('carries the index query to the shell manifest beside it', async () => {
    const root = await polyrepo();
    const index = 'https://cdn.example.com/envs/prod/index.json?sig=1';
    const shell = 'https://cdn.example.com/envs/prod/shell/mf-manifest.json?sig=1';
    const fetch = serving({
      [index]: answer(JSON.stringify({ remotes: [] })),
      [shell]: answer(manifest('18.3.1')),
    });
    const { code } = await run(root, ['--against', index], fetch);
    expect(code).toBe(0);
    expect(fetch.asked).toEqual([index, shell]);
  });

  it('reads a file: URL as a file path', async () => {
    const root = await polyrepo();
    const file = await write(root, 'shell.json', manifest('19.1.0'));
    const { code, result } = await run(root, ['--against', pathToFileURL(file).href]);
    expect(code).toBe(5);
    expect(result.findings[0]?.message).toContain('the shell provides 19.1.0');
  });

  it('resolves a relative path with the platform separator from --cwd', async () => {
    const root = await polyrepo();
    await write(root, path.join('sub', 'shell.json'), manifest('18.3.1'));
    const { code } = await run(root, ['--against', path.join('sub', 'shell.json')]);
    expect(code).toBe(0);
  });
});
