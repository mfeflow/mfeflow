import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRangeRewriter, PLACEHOLDER_RANGE, scanCheckout } from './local';
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
