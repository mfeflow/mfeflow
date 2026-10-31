import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  validateMfeflowProject,
  validateMfeManifest,
  validateRegistryEntry,
} from '@mfeflow/contracts';
import { findDiverged, loadProject } from '@mfeflow/core';
import { main } from '.';
import { REPO, readTree, removeDir, tempDir, testRuntime } from './testing';

// The generated tree for `mfeflow init --yes --no-install --local <this checkout>`.
// Needs the packages built (`pnpm build`), like the `--local` flag itself.
describe('mfeflow init --local --yes --no-install', () => {
  const cwd = tempDir();
  afterAll(async () => {
    await removeDir(await cwd);
  });

  it('generates the project the docs describe', async () => {
    const parent = await cwd;
    const rt = testRuntime();
    const code = await main(
      ['init', 'my-platform', '--yes', '--no-install', '--local', REPO, '--cwd', parent],
      rt,
    );
    expect(rt.io.err).toEqual([]);
    expect(code).toBe(0);

    const root = path.join(parent, 'my-platform');
    const tree = await readTree(root);
    expect(Object.keys(tree).toSorted()).toEqual(
      [
        '.gitignore',
        '.nvmrc',
        '.oxlintrc.json',
        '.prettierignore',
        '.prettierrc.json',
        'AGENTS.md',
        'README.md',
        'mfeflow.json',
        'package.json',
        'pnpm-workspace.yaml',
        'turbo.json',
        ...['shell', 'catalog', 'cart'].flatMap((app) => [
          `apps/${app}/mfe.json`,
          `apps/${app}/package.json`,
          `apps/${app}/rsbuild.config.ts`,
          `apps/${app}/tsconfig.json`,
          `apps/${app}/src/api/endpoints.ts`,
          `apps/${app}/src/bootstrap.tsx`,
          `apps/${app}/src/env.d.ts`,
          `apps/${app}/src/index.ts`,
        ]),
        'apps/shell/public/config/runtime-config.json',
        'apps/shell/src/App.tsx',
        'apps/shell/src/pages/Home.tsx',
        'apps/shell/src/remotes/cart.tsx',
        'apps/shell/src/remotes/catalog.tsx',
        'apps/shell/src/remotes/route-table.tsx',
        'apps/catalog/src/exposed/App.tsx',
        'apps/cart/src/exposed/App.tsx',
        ...['dev', 'staging', 'prod'].flatMap((env) => [
          `registry/envs/${env}/.gitkeep`,
          `registry/envs/${env}/catalog.json`,
          `registry/envs/${env}/cart.json`,
        ]),
      ].toSorted(),
    );

    const project = await loadProject(root);
    expect(validateMfeflowProject(project)).toEqual([]);
    expect(project).toMatchObject({
      topology: 'monorepo',
      packageManager: 'pnpm',
      scope: '@my-platform',
      apps: {
        shell: { kind: 'shell', path: 'apps/shell', port: 4300 },
        catalog: { kind: 'remote', path: 'apps/catalog', port: 4311 },
        cart: { kind: 'remote', path: 'apps/cart', port: 4312 },
      },
    });
    expect(Object.keys(project.features)).toEqual([
      'core',
      'tsconfig',
      'lint-oxlint',
      'url-factory',
    ]);
    expect(await findDiverged(root, project)).toEqual([]);

    for (const app of ['shell', 'catalog', 'cart']) {
      expect(validateMfeManifest(JSON.parse(tree[`apps/${app}/mfe.json`] ?? ''))).toEqual([]);
    }
    for (const env of ['dev', 'staging', 'prod']) {
      for (const remote of ['catalog', 'cart']) {
        const entry: unknown = JSON.parse(tree[`registry/envs/${env}/${remote}.json`] ?? '');
        expect(validateRegistryEntry(entry)).toEqual([]);
      }
    }
    expect(tree['apps/shell/rsbuild.config.ts']).toContain('port: 4300');
    expect(tree['apps/cart/rsbuild.config.ts']).toContain(
      "exposes: { './App': './src/exposed/App.tsx' }",
    );
  });

  it('links @mfeflow packages from the checkout and keeps the rest in the catalog', async () => {
    const root = path.join(await cwd, 'my-platform');
    const shell = JSON.parse(
      await fs.readFile(path.join(root, 'apps/shell/package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(shell.dependencies['@mfeflow/runtime']).toMatch(/^link:.*\/packages\/runtime$/);
    expect(shell.devDependencies['@mfeflow/rsbuild']).toMatch(/^link:.*\/packages\/rsbuild$/);
    expect(shell.dependencies.react).toBe('catalog:');
    expect(shell.scripts).toEqual({
      dev: 'rsbuild dev',
      build: 'rsbuild build',
      typecheck: 'tsc --noEmit',
    });
    const workspace = await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('react: 19.3.1');
    expect(workspace).not.toContain('link:');
  });

  it('writes relative imports without file extensions, like the rest of the codebase', async () => {
    const tree = await readTree(path.join(await cwd, 'my-platform'));
    for (const [file, content] of Object.entries(tree)) {
      if (!/\.tsx?$/.test(file)) continue;
      expect(content, file).not.toMatch(/from '\.{1,2}\/[^']*\.(?:tsx?|jsx?)'/);
    }
  });
});
