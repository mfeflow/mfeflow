import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { stripTypeScriptTypes } from 'node:module';
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
        '.env.example',
        'env.ts',
        'playwright.config.ts',
        'scripts/check-runtime-config.ts',
        'tsconfig.json',
        'vitest.config.ts',
        'e2e/smoke.spec.ts',
        ...['shell', 'catalog', 'cart'].flatMap((app) => [
          `apps/${app}/.env.example`,
          `apps/${app}/env.ts`,
          `apps/${app}/vitest.config.ts`,
          `apps/${app}/src/mocks/handlers.ts`,
          `apps/${app}/src/mocks/handlers.test.ts`,
          `apps/${app}/src/mocks/server.ts`,
          `apps/${app}/src/test/setup.ts`,
          `apps/${app}/mfeflow.app.json`,
          `apps/${app}/package.json`,
          `apps/${app}/rsbuild.config.ts`,
          `apps/${app}/tsconfig.json`,
          `apps/${app}/src/api/endpoints.ts`,
          `apps/${app}/src/bootstrap.tsx`,
          `apps/${app}/src/env.d.ts`,
          `apps/${app}/src/index.ts`,
        ]),
        'apps/shell/public/config/runtime-config.dev.json',
        'apps/shell/public/config/runtime-config.staging.json',
        'apps/shell/public/config/runtime-config.prod.json',
        'apps/shell/src/config/runtime.ts',
        'apps/shell/src/config/schema.ts',
        'apps/shell/src/pages/Home.test.tsx',
        'apps/shell/src/App.tsx',
        'apps/shell/src/assert.ts',
        'apps/shell/src/pages/Home.tsx',
        'apps/shell/src/remotes/cart.tsx',
        'apps/shell/src/remotes/catalog.tsx',
        'apps/shell/src/remotes/route-table.tsx',
        'apps/catalog/src/exposed/App.tsx',
        'apps/cart/src/exposed/App.tsx',
        'apps/catalog/src/exposed/App.test.tsx',
        'apps/cart/src/exposed/App.test.tsx',
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
      'env-t3',
      'testing',
    ]);
    expect(await findDiverged(root, project)).toEqual([]);

    for (const app of ['shell', 'catalog', 'cart']) {
      expect(validateMfeManifest(JSON.parse(tree[`apps/${app}/mfeflow.app.json`] ?? ''))).toEqual(
        [],
      );
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
    // The browser singleton check loads on demand only, so production pays nothing.
    const boot = tree['apps/shell/src/bootstrap.tsx'];
    expect(boot).toContain("if (DEV) void import('./assert');");
    expect(boot).not.toMatch(/^import .* from '\.\/assert'/m);
    expect(tree['apps/shell/src/assert.ts']).toContain('eslint/no-underscore-dangle');
    expect(tree['apps/shell/src/assert.ts']).toContain('checkSingletons(SINGLETONS)');
    expect(tree['apps/shell/src/assert.ts']).toContain(
      "typeof __MFEFLOW_SINGLETONS__ === 'undefined'",
    );
    expect(tree['apps/shell/src/assert.ts']).toContain("reportRemoteError('shell', 'singletons'");
  });

  it('the generated singleton check reports a duplicate but not a package that is not loaded yet', async () => {
    const root = path.join(await cwd, 'my-platform');
    const source = await fs.readFile(path.join(root, 'apps/shell/src/assert.ts'), 'utf8');
    const body = stripTypeScriptTypes(source).replace(
      /^import \{(.*)\} from '@mfeflow\/runtime';/m,
      'const {$1} = runtime;',
    );
    // The runtime is stubbed: only what the template does with a check result is under test.
    const run = (result: { missing: string[]; duplicated: string[] }) => {
      vi.useFakeTimers();
      const reports: string[] = [];
      const runtime = {
        checkSingletons: () => result,
        reportRemoteError: (mfe: string, where: string, error: Error) =>
          reports.push(`${mfe} ${where}: ${error.message}`),
      };
      try {
        const load: unknown = vm.runInThisContext(`(function (runtime) {${body}
})`);
        Reflect.apply(load as () => void, undefined, [runtime]);
        return reports;
      } finally {
        vi.useRealTimers();
        Reflect.deleteProperty(globalThis, 'mfeflowCheckSingletons');
      }
    };
    expect(run({ missing: ['@mfeflow/analytics'], duplicated: [] })).toEqual([]);
    expect(run({ missing: ['@mfeflow/analytics'], duplicated: ['react'] })).toEqual([
      'shell singletons: react is loaded in more than one version',
    ]);
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
      test: 'vitest run',
    });
    const workspace = await fs.readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('react: 19.3.1');
    expect(workspace).not.toContain('link:');
  });

  it('links the CLI and defines the check scripts at the root', async () => {
    const root = JSON.parse(
      await fs.readFile(path.join(await cwd, 'my-platform', 'package.json'), 'utf8'),
    ) as { devDependencies: Record<string, string>; scripts: Record<string, string> };
    expect(root.devDependencies.mfeflow).toMatch(/^link:.*\/packages\/cli$/);
    expect(root.scripts.doctor).toBe('mfeflow doctor');
  });

  it('writes relative imports without file extensions, like the rest of the codebase', async () => {
    const tree = await readTree(path.join(await cwd, 'my-platform'));
    for (const [file, content] of Object.entries(tree)) {
      if (!/\.tsx?$/.test(file)) continue;
      expect(content, file).not.toMatch(/from '\.{1,2}\/[^']*\.(?:tsx?|jsx?)'/);
    }
  });
});
