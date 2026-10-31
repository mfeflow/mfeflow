import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseLocal, createRangeRewriter, PLACEHOLDER_RANGE, scanCheckout } from './local';
import { REPO, removeDir, tempDir } from './testing';
import { thrown } from './testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function checkout(packages: Record<string, { built: boolean; exports?: unknown }>) {
  const root = await tempDir('mfeflow-local-');
  dirs.push(root);
  for (const [name, { built, exports }] of Object.entries(packages)) {
    const dir = path.join(root, 'packages', name.split('/')[1] ?? name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, exports: exports ?? { '.': './dist/index.js' } }),
    );
    if (built) await fs.mkdir(path.join(dir, 'dist'));
  }
  return root;
}

describe('createRangeRewriter', () => {
  it('uses ^version for @mfeflow packages without --local', () => {
    const rewrite = createRangeRewriter('0.3.1');
    expect(rewrite('@mfeflow/runtime', PLACEHOLDER_RANGE)).toBe('^0.3.1');
  });

  it('leaves every other dependency and range alone', () => {
    const rewrite = createRangeRewriter('0.3.1');
    expect(rewrite('react', PLACEHOLDER_RANGE)).toBeUndefined();
    expect(rewrite('@mfeflow/runtime', '^1.0.0')).toBeUndefined();
  });

  it('links to the checkout package folder with forward slashes', async () => {
    const root = await checkout({ '@mfeflow/runtime': { built: true } });
    const link = createRangeRewriter('0.3.1', root)('@mfeflow/runtime', PLACEHOLDER_RANGE);
    expect(link).toBe(`link:${path.join(root, 'packages', 'runtime').split(path.sep).join('/')}`);
    expect(link).not.toContain('\\');
  });

  it('works against this checkout', () => {
    const link = createRangeRewriter('0.0.0', REPO)('@mfeflow/rsbuild', PLACEHOLDER_RANGE);
    expect(link).toMatch(/^link:.*\/packages\/rsbuild$/);
  });

  it('names a package the checkout does not have (E110)', async () => {
    const root = await checkout({ '@mfeflow/runtime': { built: true } });
    const error = thrown(() =>
      createRangeRewriter('1.0.0', root)('@mfeflow/missing', PLACEHOLDER_RANGE),
    );
    expect(error.code).toBe('MFEFLOW_E110');
    expect(error.message).toContain('@mfeflow/missing');
  });

  it('asks for a build when a package has no dist yet (E110)', async () => {
    const root = await checkout({
      '@mfeflow/runtime': { built: false },
      '@mfeflow/tsconfig': { built: false, exports: { './base.json': './base.json' } },
    });
    const error = thrown(() => createRangeRewriter('1.0.0', root));
    expect(error.code).toBe('MFEFLOW_E110');
    expect(error.message).toContain('@mfeflow/runtime');
    expect(error.message).not.toContain('tsconfig');
  });

  it('rejects a folder that is not a checkout (E110)', async () => {
    const root = await tempDir('mfeflow-local-');
    dirs.push(root);
    expect(thrown(() => scanCheckout(root)).code).toBe('MFEFLOW_E110');
  });

  it('skips folders and files that are not @mfeflow packages', async () => {
    const root = await checkout({ '@mfeflow/runtime': { built: true } });
    await fs.mkdir(path.join(root, 'packages', 'docs'));
    await fs.writeFile(path.join(root, 'packages', 'stray.txt'), 'x');
    await fs.mkdir(path.join(root, 'packages', 'other'));
    await fs.writeFile(path.join(root, 'packages', 'other', 'package.json'), '{"name":"other"}');
    await fs.mkdir(path.join(root, 'packages', 'noname'));
    await fs.writeFile(path.join(root, 'packages', 'noname', 'package.json'), '{}');
    expect([...scanCheckout(root).keys()]).toEqual(['@mfeflow/runtime']);
  });
});

describe('chooseLocal', () => {
  const root = path.resolve('/work/app');
  const project = {
    version: 1,
    topology: 'monorepo',
    packageManager: 'pnpm',
    scope: '@a',
    apps: {},
    features: {},
  } as const;

  it('records a path given as a flag, relative to the project root', () => {
    const chosen = chooseLocal(project, root, path.resolve('/work'), '../src/mfeflow');
    expect(chosen.checkout).toBe(path.resolve('/src/mfeflow'));
    expect(chosen.project.local).toBe('../../src/mfeflow');
  });

  it('keeps the project mode when there is no flag', () => {
    const linked = { ...project, local: '../mfeflow' };
    expect(chooseLocal(linked, root, root, undefined)).toEqual({
      checkout: path.resolve('/work/mfeflow'),
      project: linked,
    });
    expect(chooseLocal(project, root, root, undefined)).toEqual({ checkout: undefined, project });
  });

  it('clears the mode with none', () => {
    const linked = { ...project, local: '../mfeflow' };
    expect(chooseLocal(linked, root, root, 'none')).toEqual({ checkout: undefined, project });
  });

  it('refuses the project itself as the checkout (E107)', () => {
    expect(thrown(() => chooseLocal(project, root, root, '.')).code).toBe('MFEFLOW_E107');
  });

  it('follows a checkout recorded as an absolute path', () => {
    const elsewhere = path.resolve('/other/mfeflow');
    const linked = { ...project, local: elsewhere.split(path.sep).join('/') };
    expect(chooseLocal(linked, root, root, undefined).checkout).toBe(elsewhere);
  });

  it('compares real paths when the root is reached through a symlink', async () => {
    const base = await tempDir('mfeflow-local-');
    dirs.push(base);
    const realRoot = path.join(base, 'real', 'app');
    await fs.mkdir(realRoot, { recursive: true });
    await fs.mkdir(path.join(base, 'src', 'mfeflow'), { recursive: true });
    const viaRoot = path.join(base, 'via');
    await fs.symlink(path.join(base, 'real'), viaRoot);
    const chosen = chooseLocal(
      project,
      path.join(viaRoot, 'app'),
      base,
      path.join('src', 'mfeflow'),
    );
    const real = await fs.realpath(base);
    expect(chosen.project.local).toBe('../../src/mfeflow');
    expect(chosen.checkout).toBe(path.join(real, 'src', 'mfeflow'));
    const linked = chosen.project;
    expect(chooseLocal(linked, path.join(viaRoot, 'app'), base, undefined).checkout).toBe(
      chosen.checkout,
    );
  });
});
