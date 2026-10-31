import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, validateResult, type BudgetResult } from '..';
import { removeDir, tempDir, testRuntime } from '../testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function project(): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime());
  return path.join(cwd, 'app');
}

/** A file whose gzip size is about `kb` KB: random bytes do not compress. */
async function blob(file: string, kb: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, randomBytes(Math.round(kb * 1024)));
}

async function buildShell(root: string, kbs: number[]): Promise<void> {
  const dist = path.join(root, 'apps/shell/dist');
  const tags = kbs.map((_, i) => `<script defer src="/static/js/${String(i)}.js"></script>`);
  await fs.mkdir(dist, { recursive: true });
  await fs.writeFile(
    path.join(dist, 'index.html'),
    `<html>${tags.join('')}<script src="https://cdn.test/x.js"></script></html>`,
  );
  await Promise.all(kbs.map((kb, i) => blob(path.join(dist, `static/js/${String(i)}.js`), kb)));
}

async function buildRemote(root: string, name: string, entryKb: number, exposeKb: number) {
  const dist = path.join(root, 'apps', name, 'dist');
  await blob(path.join(dist, `static/js/${name}.abc.js`), entryKb);
  await blob(path.join(dist, 'static/js/async/App.js'), exposeKb);
  await fs.writeFile(
    path.join(dist, 'mf-manifest.json'),
    JSON.stringify({
      metaData: { remoteEntry: { name: `static/js/${name}.abc.js`, path: '' } },
      exposes: [{ path: './App', assets: { js: { sync: ['static/js/async/App.js'], async: [] } } }],
    }),
  );
}

async function run(
  root: string,
  ...argv: string[]
): Promise<{ code: number; result: BudgetResult }> {
  const rt = testRuntime();
  const code = await main(['budget', ...argv, '--json', '--cwd', root], rt);
  const value: unknown = JSON.parse(rt.io.out.join(''));
  expect(validateResult(value)).toEqual([]);
  return { code, result: value as BudgetResult };
}

describe('mfeflow budget', () => {
  it('passes remotes under 10 KB and reports the shell without a baseline', async () => {
    const root = await project();
    await buildShell(root, [20, 30]);
    await buildRemote(root, 'catalog', 8, 1);
    await buildRemote(root, 'cart', 8, 1);
    const { code, result } = await run(root);
    expect(code).toBe(0);
    expect(result.model).toEqual({ lcpDeltaMs: 300, shellKb: 32, remoteKb: 10 });
    expect(result.shells[0]).toMatchObject({
      name: 'shell',
      scripts: 2,
      baselineKb: null,
      budgetKb: null,
      pass: null,
    });
    expect(result.shells[0]?.initialKb).toBeGreaterThan(49);
    expect(result.remotes.map((r) => [r.name, r.pass])).toEqual([
      ['catalog', true],
      ['cart', true],
    ]);
    expect(result.remotes[0]?.routes).toMatchObject([
      { route: '/catalog', expose: './App', budgetKb: null },
    ]);
    expect(result.remotes[0]?.routes[0]?.kb).toBeGreaterThan(8.9);
  });

  it('fails a remote whose entry is over the cost-model limit, with a coded error', async () => {
    const root = await project();
    await buildShell(root, [10]);
    await buildRemote(root, 'catalog', 12, 1);
    await buildRemote(root, 'cart', 8, 1);
    const { code, result } = await run(root);
    expect(code).toBe(5);
    expect(result.ok).toBe(false);
    expect(result.findings).toMatchObject([{ code: 'MFEFLOW_E304', app: 'catalog' }]);
    expect(result.findings[0]?.message).toMatch(/catalog's entry is 12(\.\d)? KB/);
  });

  it('takes limits from mfeflow.json and mfe.json', async () => {
    const root = await project();
    await buildShell(root, [100]);
    await buildRemote(root, 'catalog', 12, 1);
    await buildRemote(root, 'cart', 8, 1);
    const file = path.join(root, 'mfeflow.json');
    const doc = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    doc.budget = { remoteKb: 15, baselineKb: 60, shellKb: 32 };
    await fs.writeFile(file, JSON.stringify(doc));
    const mfe = path.join(root, 'apps/cart/mfe.json');
    const cart = JSON.parse(await fs.readFile(mfe, 'utf8')) as Record<string, unknown>;
    cart.budgets = { initialJsKb: 5 };
    await fs.writeFile(mfe, JSON.stringify(cart));
    const { code, result } = await run(root);
    expect(code).toBe(5);
    expect(result.model.remoteKb).toBe(15);
    expect(result.shells[0]).toMatchObject({ baselineKb: 60, budgetKb: 92, pass: false });
    const messages = result.findings.map((f) => f.message).join('\n');
    expect(messages).toContain('baseline is 60 KB');
    expect(messages).toContain('cart on /cart loads');
    expect(result.remotes.find((r) => r.name === 'catalog')?.pass).toBe(true);
  });

  it('asks for a build when there is none, naming the app', async () => {
    const root = await project();
    const { code, result } = await run(root);
    expect(code).toBe(5);
    expect(result.findings.map((f) => f.code)).toEqual([
      'MFEFLOW_E305',
      'MFEFLOW_E305',
      'MFEFLOW_E305',
    ]);
    expect(
      result.findings.map((f) => f.app).toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(['cart', 'catalog', 'shell']);
  });

  it('reads another output folder and prints a readable table', async () => {
    const root = await project();
    for (const app of ['shell', 'catalog', 'cart']) {
      await fs.mkdir(path.join(root, 'apps', app), { recursive: true });
    }
    await fs.mkdir(path.join(root, 'apps/shell/out'));
    await fs.writeFile(path.join(root, 'apps/shell/out/index.html'), '<html></html>');
    await buildRemote(root, 'catalog', 4, 1);
    await fs.rename(path.join(root, 'apps/catalog/dist'), path.join(root, 'apps/catalog/out'));
    await buildRemote(root, 'cart', 4, 1);
    await fs.rename(path.join(root, 'apps/cart/dist'), path.join(root, 'apps/cart/out'));
    const rt = testRuntime();
    expect(await main(['budget', '--dist', 'out', '--cwd', root], rt)).toBe(0);
    const text = rt.io.out.join('\n');
    expect(text).toContain('shell shell: 0 KB in 0 scripts');
    expect(text).toContain('remote catalog: entry 4 KB, limit 10');
    expect(text).toContain('LCP (+300 ms) is measured by the perf job');
  });

  it('treats a broken manifest as not built', async () => {
    const root = await project();
    await buildShell(root, [1]);
    await fs.mkdir(path.join(root, 'apps/catalog/dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'apps/catalog/dist/mf-manifest.json'), '{ nope');
    await buildRemote(root, 'cart', 4, 1);
    const { result } = await run(root);
    expect(result.findings.map((f) => f.app)).toEqual(['catalog']);
  });

  it('refuses unknown flags', async () => {
    const root = await project();
    expect(await main(['budget', '--distt', 'x', '--cwd', root], testRuntime())).toBe(2);
  });
});
