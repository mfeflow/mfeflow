import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseProject, serializeProject } from '@mfeflow/core';
import { main } from '.';
import { readTree, removeDir, tempDir, testRuntime } from './testing';

let cwd = '';
let project = '';

beforeEach(async () => {
  cwd = await tempDir();
  project = path.join(cwd, 'app');
  const code = await main(
    ['init', 'app', '--yes', '--no-install', '--features=lint-oxlint', '--cwd', cwd],
    testRuntime(),
  );
  expect(code).toBe(0);
});
afterEach(async () => {
  await removeDir(cwd);
});

const add = (...args: string[]) =>
  main(['add', ...args, '--no-install', '--cwd', project], testRuntime());
const read = (file: string) => fs.readFile(path.join(project, file), 'utf8');
const json = async (file: string): Promise<Record<string, Record<string, string>>> => {
  return JSON.parse(await read(file)) as Record<string, Record<string, string>>;
};

/** Forgets that a feature was added, as `add` would if its files were already there. */
async function forget(feature: string): Promise<void> {
  const saved = parseProject(await read('mfeflow.json'));
  const { [feature]: _gone, ...features } = saved.features;
  await fs.writeFile(path.join(project, 'mfeflow.json'), serializeProject({ ...saved, features }));
}

describe.each(['env-t3', 'testing', 'ci-github'])('mfeflow add %s', (feature) => {
  it('adds the feature, and adding it again after forgetting it changes only mfeflow.json', async () => {
    expect(await add(feature)).toBe(0);
    const once = await readTree(project);
    expect(parseProject(once['mfeflow.json'] ?? '').features).toHaveProperty(feature);
    await forget(feature);
    expect(await add(feature)).toBe(0);
    expect(await readTree(project)).toEqual(once);
  });

  it('with --dry-run prints the diff and writes nothing', async () => {
    const before = await readTree(project);
    const rt = testRuntime();
    expect(await main(['add', feature, '--dry-run', '--cwd', project], rt)).toBe(0);
    expect(await readTree(project)).toEqual(before);
    expect(rt.io.out.join('\n')).toContain('Dry run: nothing was written.');
  });

  it('gives a remote added later the same per-app files', async () => {
    expect(await add(feature)).toBe(0);
    expect(
      await main(['add', 'remote', 'checkout', '--no-install', '--cwd', project], testRuntime()),
    ).toBe(0);
    const tree = await readTree(project);
    const perApp = {
      'env-t3': ['env.ts', '.env.example'],
      testing: ['vitest.config.ts', 'src/test/setup.ts', 'src/exposed/App.test.tsx'],
      'ci-github': [],
    }[feature];
    for (const file of perApp ?? []) expect(tree, file).toHaveProperty([`apps/checkout/${file}`]);
  });
});

describe('env-t3', () => {
  it.each([
    ['zod', "import { z } from 'zod';", ['zod']],
    ['valibot', "import * as v from 'valibot';", ['valibot']],
    ['arktype', "import { type } from 'arktype';", ['arktype']],
  ])(
    '--option env-t3.validator=%s writes %s and installs only that validator',
    async (name, importLine, deps) => {
      expect(await add('env-t3', '--option', `env-t3.validator=${name}`)).toBe(0);
      for (const file of [
        'env.ts',
        'apps/shell/env.ts',
        'apps/cart/env.ts',
        'apps/shell/src/config/schema.ts',
      ]) {
        expect(await read(file), file).toContain(importLine);
      }
      const workspace = await read('pnpm-workspace.yaml');
      for (const validator of ['zod', 'valibot', 'arktype']) {
        expect(workspace.includes(`${validator}:`), validator).toBe(deps.includes(validator));
      }
      expect(workspace).toContain('"@t3-oss/env-core": 0.13.11');
      const saved = parseProject(await read('mfeflow.json'));
      expect(saved.features['env-t3']?.options).toEqual({ validator: name });
    },
  );

  it('rejects a validator it does not know (E214) and writes nothing', async () => {
    const before = await readTree(project);
    expect(await add('env-t3', '--option', 'env-t3.validator=yup')).toBe(4);
    expect(await readTree(project)).toEqual(before);
  });

  it('gives the shell a typed config loader and no validator in any browser entry file', async () => {
    await add('env-t3');
    const runtime = await read('apps/shell/src/config/runtime.ts');
    expect(runtime).toContain("import type { runtimeConfigSchema } from './schema';");
    expect(runtime).not.toMatch(/from 'zod'/);
    expect(await read('apps/shell/src/bootstrap.tsx')).toContain('await loadRuntimeConfig();');
    expect(await read('apps/shell/rsbuild.config.ts')).toContain("import './env';");
    expect(await read('apps/cart/rsbuild.config.ts')).toContain("import './env';");
    for (const file of await fs.readdir(path.join(project, 'apps/shell/src'), {
      recursive: true,
    })) {
      if (!/\.tsx?$/.test(file) || file.startsWith('config/')) continue;
      expect(await read(`apps/shell/src/${file}`), file).not.toMatch(/config\/schema'/);
    }
  });

  it('writes one config file per environment that matches the schema', async () => {
    await add('env-t3');
    for (const env of ['dev', 'staging', 'prod']) {
      expect(await json(`apps/shell/public/config/runtime-config.${env}.json`)).toEqual({
        environment: env,
      });
    }
    expect(await read('apps/shell/src/config/schema.ts')).toContain(
      "z.enum(['dev', 'staging', 'prod'])",
    );
  });
});

describe('testing', () => {
  it('gives every app vitest, a mock server and a sample test, and the root a Playwright smoke test', async () => {
    await add('testing');
    const tree = await readTree(project);
    for (const app of ['shell', 'catalog', 'cart']) {
      for (const file of ['vitest.config.ts', 'src/test/setup.ts', 'src/mocks/server.ts']) {
        expect(tree, `${app}/${file}`).toHaveProperty([`apps/${app}/${file}`]);
      }
      const pkg = await json(`apps/${app}/package.json`);
      expect(pkg.scripts?.test).toBe('vitest run');
    }
    expect(tree['apps/shell/src/pages/Home.test.tsx']).toContain('renderWithPlatform');
    expect(tree['apps/cart/src/exposed/App.test.tsx']).toContain('renderWithPlatform');
    expect(tree['e2e/smoke.spec.ts']).toContain('registry/envs/dev');
    const root = await json('package.json');
    expect(root.scripts).toMatchObject({ test: 'vitest run', 'test:e2e': 'playwright test' });
  });

  it('keeps Playwright output out of the working tree and stops the dev servers it starts', async () => {
    await add('testing');
    const config = await read('playwright.config.ts');
    expect(config).toContain('node_modules/.cache/playwright');
    expect(config).toContain("gracefulShutdown: { signal: 'SIGTERM'");
    expect(config).toContain('process.env.BASE_URL');
  });
});

describe('ci-github', () => {
  interface Workflow {
    on: Record<string, unknown>;
    permissions: unknown;
    jobs: Record<
      string,
      { permissions: unknown; steps: { uses?: string; run?: string; if?: string }[] }
    >;
  }

  async function workflow(): Promise<{ text: string; doc: Workflow }> {
    expect(await add('ci-github')).toBe(0);
    const text = await read('.github/workflows/ci.yml');
    return { text, doc: parse(text) as Workflow };
  }

  it('runs on pull requests only, with no token permissions beyond reading the repo', async () => {
    const { doc } = await workflow();
    expect(Object.keys(doc.on)).toEqual(['pull_request']);
    expect(doc.permissions).toEqual({});
    expect(Object.values(doc.jobs).map((job) => job.permissions)).toEqual([{ contents: 'read' }]);
  });

  it('pins every action to a full commit SHA', async () => {
    const { doc } = await workflow();
    const uses = Object.values(doc.jobs).flatMap((job) =>
      job.steps.flatMap((s) => (s.uses ? [s.uses] : [])),
    );
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const action of uses) expect(action).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
  });

  it('runs the platform checks, and skips what a project without the feature does not have', async () => {
    const { doc } = await workflow();
    const steps = Object.values(doc.jobs)[0]?.steps ?? [];
    const runs = steps.flatMap((s) => (s.run ? [s.run] : []));
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm build',
      'pnpm exec mfeflow doctor',
      'pnpm exec mfeflow validate',
      'pnpm exec mfeflow check-compat',
      'pnpm exec mfeflow budget',
      'pnpm run --if-present check:runtime-config',
    ]) {
      expect(runs).toContain(command);
    }
    const guarded = steps.filter((s) => s.if?.includes('hashFiles'));
    expect(guarded.length).toBeGreaterThanOrEqual(4);
    expect(runs.indexOf('pnpm build')).toBeLessThan(runs.indexOf('pnpm exec mfeflow budget'));
  });

  it('lists mfeflow as a dev dependency so CI can run it, and documents previews and OIDC', async () => {
    await workflow();
    expect((await json('package.json')).devDependencies).toHaveProperty(['mfeflow']);
    const docs = await read('docs/ci.md');
    expect(docs).toContain('id-token: write');
    expect(docs).toContain('Preview deploys');
  });
});
