import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseProject, serializeProject } from '@mfeflow/core';
import { main } from '.';
import { REPO, readTree, removeDir, tempDir, testRuntime } from './testing';

let cwd = '';
let project = '';

beforeEach(async () => {
  cwd = await tempDir();
  project = path.join(cwd, 'app');
  const code = await main(
    ['init', 'app', '--yes', '--no-install', '--features=lint-oxlint,url-factory', '--cwd', cwd],
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

describe.each([
  'env-t3',
  'testing',
  'ci-github',
  'analytics-gtm',
  'telemetry-otel',
  'event-bus',
  'route-factory',
  'http',
  'theming',
  'i18n',
  'tailwind',
  'forms',
  'data-react-query',
  'ui-shadcn',
])('mfeflow add %s', (feature) => {
  it('adds the feature, and adding it again after forgetting it changes only mfeflow.json', async () => {
    if (feature === 'ui-shadcn') expect(await add('tailwind')).toBe(0);
    expect(await add(feature)).toBe(0);
    const once = await readTree(project);
    expect(parseProject(once['mfeflow.json'] ?? '').features).toHaveProperty(feature);
    await forget(feature);
    expect(await add(feature)).toBe(0);
    expect(await readTree(project)).toEqual(once);
  });

  it('with --dry-run prints the diff and writes nothing', async () => {
    if (feature === 'ui-shadcn') expect(await add('tailwind')).toBe(0);
    const before = await readTree(project);
    const rt = testRuntime();
    expect(await main(['add', feature, '--dry-run', '--cwd', project], rt)).toBe(0);
    expect(await readTree(project)).toEqual(before);
    expect(rt.io.out.join('\n')).toContain('Dry run: nothing was written.');
  });

  it('gives a remote added later the same per-app files', async () => {
    if (feature === 'ui-shadcn') expect(await add('tailwind')).toBe(0);
    expect(await add(feature)).toBe(0);
    expect(
      await main(['add', 'remote', 'checkout', '--no-install', '--cwd', project], testRuntime()),
    ).toBe(0);
    const tree = await readTree(project);
    const perApp = {
      'env-t3': ['env.ts', '.env.example'],
      testing: ['vitest.config.ts', 'src/test/setup.ts', 'src/exposed/App.test.tsx'],
      'ci-github': [],
      'analytics-gtm': ['src/analytics.ts'],
      'telemetry-otel': ['src/telemetry.ts'],
      'event-bus': ['src/events.ts'],
      'route-factory': ['src/routes.ts'],
      http: ['src/api/client.ts'],
      theming: ['src/theme/tokens.ts'],
      i18n: ['src/i18n/I18n.tsx', 'src/i18n/messages/en.json'],
      tailwind: ['postcss.config.mjs', 'src/styles.css', 'src/tailwind/Scope.tsx'],
      forms: ['src/forms/ContactForm.tsx', 'src/forms/schema.ts'],
      'ui-shadcn': ['components.json', 'src/lib/utils.ts', 'src/components/ui/button.tsx'],
      'data-react-query': ['src/query/Query.tsx', 'src/query/keys.ts', 'src/query/useHealth.ts'],
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

describe('ui-shadcn', () => {
  it('needs tailwind and says so, writing nothing', async () => {
    const before = await readTree(project);
    expect(await add('ui-shadcn')).not.toBe(0);
    expect(await readTree(project)).toEqual(before);
  });

  it('gives each remote a components.json with its own prefix', async () => {
    await add('tailwind');
    expect(await add('ui-shadcn')).toBe(0);
    expect(await read('apps/cart/components.json')).toContain('"prefix": "cart"');
    expect(await read('apps/catalog/components.json')).toContain('"prefix": "catalog"');
    expect(await read('apps/cart/src/components/ui/button.tsx')).toContain('cart:bg-primary');
  });
});

describe('forms', () => {
  it.each([
    ['zod', "from 'zod'"],
    ['valibot', "from 'valibot'"],
    ['arktype', "from 'arktype'"],
  ])(
    '--option forms.validator=%s writes that schema and installs only that library',
    async (name, importLine) => {
      expect(await add('forms', '--option', `forms.validator=${name}`)).toBe(0);
      expect(await read('apps/cart/src/forms/schema.ts')).toContain(importLine);
      const pkg = await json('apps/cart/package.json');
      const installed = Object.keys(pkg.dependencies ?? {});
      expect(installed).toContain('react-hook-form');
      for (const validator of ['zod', 'valibot', 'arktype']) {
        expect(installed.includes(validator), validator).toBe(validator === name);
      }
      expect(Object.keys((await json('apps/shell/package.json')).dependencies ?? {})).not.toContain(
        'react-hook-form',
      );
    },
  );

  it('rejects a library it does not know and writes nothing', async () => {
    const before = await readTree(project);
    expect(await add('forms', '--option', 'forms.validator=yup')).toBe(4);
    expect(await readTree(project)).toEqual(before);
  });
});

describe('the root tooling tsconfig.json', () => {
  it('belongs to the tsconfig feature alone, so no other feature writes it', async () => {
    const owners: string[] = [];
    for (const name of await fs.readdir(path.join(REPO, 'features'))) {
      const manifest = JSON.parse(
        await fs.readFile(path.join(REPO, 'features', name, 'feature.json'), 'utf8'),
      ) as { files?: Array<{ to: string; target?: string }> };
      if (manifest.files?.some((f) => f.to === 'tsconfig.json' && (f.target ?? 'root') === 'root'))
        owners.push(name);
    }
    expect(owners).toEqual(['tsconfig']);
  });

  it('survives an edit: testing and env-t3 can be added afterwards', async () => {
    const edited =
      '{\n  "extends": "@mfeflow/tsconfig/node.json",\n  "include": ["*.ts", "tools"]\n}\n';
    await fs.writeFile(path.join(project, 'tsconfig.json'), edited);
    expect(await add('testing')).toBe(0);
    expect(await add('env-t3')).toBe(0);
    expect(await read('tsconfig.json')).toBe(edited);
  });

  it('is written once, with the preset the tooling scripts need', async () => {
    const root = JSON.parse(await read('tsconfig.json')) as { extends: string; include: string[] };
    expect(root.extends).toBe('@mfeflow/tsconfig/node.json');
    expect(root.include).toEqual(['*.ts', 'scripts', 'e2e']);
    expect((await json('package.json')).devDependencies).toHaveProperty('@mfeflow/tsconfig');
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

  it('fails the smoke test on a console error, a failed request or a runtime config that did not load', async () => {
    await add('env-t3');
    await add('testing');
    const spec = await read('e2e/smoke.spec.ts');
    for (const listener of ["'pageerror'", "'console'", "'requestfailed'", "'response'"]) {
      expect(spec, listener).toContain(`page.on(${listener}`);
    }
    expect(spec).toContain('expect(problems).toEqual([])');
    const key = /const KEY = '(\w+)'/.exec(await read('apps/shell/src/config/runtime.ts'))?.[1];
    expect(key).toBe('__MFE_RUNTIME_CONFIG__');
    expect(spec).toContain(`'${key}'`);
    expect(spec).toContain('scripts/check-runtime-config.ts');
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
      'pnpm mfeflow doctor',
      'pnpm mfeflow validate',
      'pnpm mfeflow check-compat',
      'pnpm mfeflow budget',
      'pnpm run --if-present check:runtime-config',
    ]) {
      expect(runs).toContain(command);
    }
    const guarded = steps.filter((s) => s.if?.includes('hashFiles'));
    expect(guarded.length).toBeGreaterThanOrEqual(4);
    expect(runs.indexOf('pnpm build')).toBeLessThan(runs.indexOf('pnpm mfeflow budget'));
  });

  it('lists mfeflow as a dev dependency so CI can run it, and documents previews and OIDC', async () => {
    await workflow();
    expect((await json('package.json')).devDependencies).toHaveProperty(['mfeflow']);
    const docs = await read('docs/ci.md');
    expect(docs).toContain('id-token: write');
    expect(docs).toContain('Preview deploys');
  });
});

const runtimeKeys = async (file: string): Promise<string[]> =>
  Object.keys(JSON.parse(await read(file)) as Record<string, unknown>);

describe('analytics-gtm', () => {
  it('starts analytics from the boot sequence without holding up render, and wraps the shell', async () => {
    await add('analytics-gtm');
    const boot = await read('apps/shell/src/bootstrap.tsx');
    expect(boot).toContain("import { initAnalyticsFromConfig } from './analytics/init';");
    expect(boot.indexOf('initAnalyticsFromConfig();')).toBeLessThan(boot.indexOf('.render('));
    expect(boot).not.toContain('await initAnalyticsFromConfig');
    const app = await read('apps/shell/src/App.tsx');
    expect(app).toContain("import { Analytics } from './analytics/Analytics';");
    expect(app).toMatch(/<Analytics>[\s\S]*<\/Analytics>/);
    const dependencies = (await json('apps/cart/package.json')).dependencies;
    expect(dependencies).toHaveProperty(['@mfeflow/analytics']);
  });

  it('gives a remote an analytics.ts that merges its events into the platform map', async () => {
    await add('analytics-gtm');
    const analytics = await read('apps/cart/src/analytics.ts');
    expect(analytics).toContain("declare module '@mfeflow/analytics'");
    expect(analytics).toContain("createTracker('cart', { events })");
    expect(analytics).toContain('cart_viewed: undefined;');
  });

  it('names the first event after a remote with an underscore in its name', async () => {
    await add('analytics-gtm');
    expect(
      await main(['add', 'remote', 'my_shop', '--no-install', '--cwd', project], testRuntime()),
    ).toBe(0);
    const analytics = await read('apps/my_shop/src/analytics.ts');
    expect(analytics).toContain('my_shop_viewed');
    expect(analytics).toContain("createTracker('my_shop'");
  });

  it('without env-t3 puts gtmId in public/config/runtime-config.json', async () => {
    await add('analytics-gtm');
    expect(await json('apps/shell/public/config/runtime-config.json')).toEqual({ gtmId: '' });
  });

  it.each(['zod', 'valibot', 'arktype'])(
    'with env-t3 (%s) adds gtmId to the schema and every environment file',
    async (validator) => {
      await add('env-t3', '--option', `env-t3.validator=${validator}`);
      await add('analytics-gtm');
      expect(await read('apps/shell/src/config/schema.ts')).toContain('gtmId:');
      for (const env of ['dev', 'staging', 'prod']) {
        expect(await runtimeKeys(`apps/shell/public/config/runtime-config.${env}.json`)).toEqual([
          'environment',
          'gtmId',
        ]);
      }
      expect(
        (await readTree(project))['apps/shell/public/config/runtime-config.json'],
      ).toBeUndefined();
    },
  );

  it('ends up the same whichever of env-t3 and analytics-gtm is added first', async () => {
    await add('analytics-gtm');
    await add('env-t3');
    const schema = await read('apps/shell/src/config/schema.ts');
    expect(schema).toContain('gtmId:');
    expect(await runtimeKeys('apps/shell/public/config/runtime-config.dev.json')).toEqual([
      'environment',
      'gtmId',
    ]);
  });

  it('adds the key once when both are added in one command', async () => {
    expect(await add('env-t3', 'analytics-gtm')).toBe(0);
    expect((await read('apps/shell/src/config/schema.ts')).match(/gtmId:/g)).toHaveLength(1);
    expect(await runtimeKeys('apps/shell/public/config/runtime-config.prod.json')).toEqual([
      'environment',
      'gtmId',
    ]);
  });

  it('applies features in catalogue order whichever way they are typed', async () => {
    expect(await add('analytics-gtm', 'env-t3')).toBe(0);
    expect((await read('apps/shell/src/config/schema.ts')).match(/gtmId:/g)).toHaveLength(1);
    expect(await runtimeKeys('apps/shell/public/config/runtime-config.prod.json')).toEqual([
      'environment',
      'gtmId',
    ]);
  });

  it('writes a unit test for the shell and each remote when testing is installed', async () => {
    await add('testing');
    await add('analytics-gtm');
    const tree = await readTree(project);
    expect(tree['apps/shell/src/analytics/init.test.ts']).toContain('startAnalytics');
    expect(tree['apps/cart/src/analytics.test.ts']).toContain('cart_viewed');
    expect(tree['apps/cart/src/analytics.test.ts']).toContain("mfe_name: 'cart'");
    expect(tree['apps/shell/src/analytics/ConsentBanner.test.tsx']).toContain('Accept analytics');
  });

  it('writes a consent banner whose buttons grant only what they say', async () => {
    await add('analytics-gtm');
    const banner = await read('apps/shell/src/analytics/ConsentBanner.tsx');
    expect(banner).toContain('Accept analytics');
    expect(banner).toContain('Accept analytics and advertising');
    expect(banner).toContain('Reject');
    expect(banner).not.toContain('acceptAll');
    expect(banner).toContain('Advertising cookies are optional');
  });
});

describe('telemetry-otel', () => {
  it('starts telemetry from the boot sequence and loads the SDK only through a dynamic import', async () => {
    await add('telemetry-otel');
    const boot = await read('apps/shell/src/bootstrap.tsx');
    expect(boot).toContain("import { initTelemetryFromConfig } from './telemetry/init';");
    expect(boot).not.toContain('await initTelemetryFromConfig');
    const init = await read('apps/shell/src/telemetry/init.ts');
    expect(init).toContain("import('@mfeflow/telemetry/otel')");
    expect(init).not.toMatch(/from '@mfeflow\/telemetry\/otel'/);
    expect(init).toContain("serviceName: 'shell'");
  });

  it('gives a remote a tracer tagged with its name', async () => {
    await add('telemetry-otel');
    expect(await read('apps/cart/src/telemetry.ts')).toContain("getTracer('cart')");
  });

  it('without env-t3 puts the three keys in public/config/runtime-config.json', async () => {
    await add('telemetry-otel');
    expect(await json('apps/shell/public/config/runtime-config.json')).toEqual({
      otlpEndpoint: '',
      traceSampleRatio: 1,
      propagateTraceHeaderCorsUrls: [],
    });
  });

  it('loads the runtime config through one shared loader, with no copy per feature', async () => {
    await add('env-t3', 'analytics-gtm', 'telemetry-otel');
    const tree = await readTree(project);
    expect(tree).not.toHaveProperty(['apps/shell/src/analytics/runtime-config.ts']);
    expect(tree).not.toHaveProperty(['apps/shell/src/telemetry/runtime-config.ts']);
    for (const file of [
      'apps/shell/src/analytics/init.ts',
      'apps/shell/src/telemetry/init.ts',
      'apps/shell/src/config/runtime.ts',
    ]) {
      expect(tree[file], file).toContain('fetchRuntimeConfig');
      expect(tree[file], file).toContain("from '@mfeflow/runtime'");
    }
    expect(tree['apps/shell/src/config/runtime.ts']).not.toContain('await fetch(');
  });

  it('shares runtime-config.json with analytics-gtm', async () => {
    await add('analytics-gtm', 'telemetry-otel');
    expect(await runtimeKeys('apps/shell/public/config/runtime-config.json')).toEqual([
      'gtmId',
      'otlpEndpoint',
      'traceSampleRatio',
      'propagateTraceHeaderCorsUrls',
    ]);
  });

  it.each(['zod', 'valibot', 'arktype'])(
    'with env-t3 (%s) adds the keys to the schema and every environment file',
    async (validator) => {
      await add('env-t3', '--option', `env-t3.validator=${validator}`);
      await add('telemetry-otel');
      const schema = await read('apps/shell/src/config/schema.ts');
      for (const key of ['otlpEndpoint', 'traceSampleRatio', 'propagateTraceHeaderCorsUrls']) {
        expect(schema, key).toContain(`${key}:`);
      }
      expect(await runtimeKeys('apps/shell/public/config/runtime-config.staging.json')).toEqual([
        'environment',
        'otlpEndpoint',
        'traceSampleRatio',
        'propagateTraceHeaderCorsUrls',
      ]);
      expect(
        (
          JSON.parse(await read('apps/shell/public/config/runtime-config.dev.json')) as Record<
            string,
            unknown
          >
        ).propagateTraceHeaderCorsUrls,
      ).toEqual([]);
    },
  );

  it('ends up the same whichever of env-t3 and telemetry-otel is added first', async () => {
    await add('telemetry-otel');
    await add('env-t3');
    expect(await read('apps/shell/src/config/schema.ts')).toContain('otlpEndpoint:');
    expect(await runtimeKeys('apps/shell/public/config/runtime-config.prod.json')).toContain(
      'traceSampleRatio',
    );
  });
});

describe('event-bus', () => {
  it('creates the contracts package under the project scope, with the events as types only', async () => {
    await add('event-bus');
    const pkg = (await json('packages/contracts/package.json')) as unknown as Record<
      string,
      unknown
    >;
    expect(pkg.name).toBe(`${parseProject(await read('mfeflow.json')).scope}/contracts`);
    expect(pkg.exports).toEqual({
      './events': './src/events/index.ts',
      './routes/*': './src/routes/*.ts',
    });
    const events = await read('packages/contracts/src/events/index.ts');
    expect(events).toContain("'mfe.ready.v1': { mfe: string }");
    expect(events).not.toMatch(/^import /m);
  });

  it('wires every app to the contracts package and the bus', async () => {
    await add('event-bus');
    const scope = parseProject(await read('mfeflow.json')).scope;
    for (const app of ['shell', 'cart']) {
      const dependencies = (await json(`apps/${app}/package.json`)).dependencies;
      expect(dependencies, app).toHaveProperty([`${scope}/contracts`], 'workspace:*');
      expect(dependencies, app).toHaveProperty(['@mfeflow/event-bus']);
    }
  });

  it('merges the contracts into the bus in each app, and the shell imports the bus at boot', async () => {
    await add('event-bus');
    const remote = await read('apps/cart/src/events.ts');
    expect(remote).toContain("declare module '@mfeflow/event-bus'");
    expect(remote).toContain('interface EventMap extends Events {}');
    expect(remote).toContain("publish('mfe.ready.v1', { mfe: 'cart' })");
    expect(await read('apps/shell/src/events.ts')).toContain("configureEvent('mfe.ready.v1'");
    const boot = await read('apps/shell/src/bootstrap.tsx');
    expect(boot).toContain("import { configureShellEvents } from './events';");
    expect(boot.indexOf('configureShellEvents();')).toBeLessThan(boot.indexOf('.render('));
    expect(boot).not.toContain('await configureShellEvents');
  });

  it('makes each remote announce itself when its exposed App mounts', async () => {
    await add('event-bus');
    const app = await read('apps/cart/src/exposed/App.tsx');
    expect(app).toContain("import { Announce } from '../Announce';");
    expect(app).toMatch(/<Announce>[\s\S]*<\/Announce>/);
    expect(await read('apps/cart/src/Announce.tsx')).toContain('announceReady();');
  });

  it('writes a unit test for the shell and each remote when testing is installed', async () => {
    await add('testing');
    await add('event-bus');
    const tree = await readTree(project);
    expect(tree['apps/cart/src/events.test.ts']).toContain('onOtherRemoteReady');
    expect(tree['apps/shell/src/events.test.ts']).toContain('configureShellEvents');
  });

  it('gives a remote added later its own events and the dependency', async () => {
    await add('event-bus');
    expect(
      await main(['add', 'remote', 'checkout', '--no-install', '--cwd', project], testRuntime()),
    ).toBe(0);
    const scope = parseProject(await read('mfeflow.json')).scope;
    expect((await json('apps/checkout/package.json')).dependencies).toHaveProperty([
      `${scope}/contracts`,
    ]);
    expect(await read('apps/checkout/src/events.ts')).toContain("mfe: 'checkout'");
  });
});

describe('route-factory', () => {
  it('without the contracts package keeps each remote’s routes in the remote', async () => {
    await add('route-factory');
    const routes = await read('apps/cart/src/routes.ts');
    expect(routes).toContain("defineRoutes('/cart', {");
    expect(routes).toContain('createLinks({ cart: routes })');
    expect(await readTree(project)).not.toHaveProperty(['packages/contracts/package.json']);
  });

  it('with event-bus puts each remote’s paths in the contracts package', async () => {
    await add('event-bus', 'route-factory');
    const scope = parseProject(await read('mfeflow.json')).scope;
    expect(await read('packages/contracts/src/routes/cart.ts')).toContain('home: ');
    expect(await read('apps/cart/src/routes.ts')).toContain(
      `from '${scope}/contracts/routes/cart'`,
    );
    expect(await read('apps/cart/src/routes.ts')).toContain("defineRoutes('/cart', contract)");
  });

  it('does the same when event-bus was added first, and when the remote comes later', async () => {
    await add('event-bus');
    await add('route-factory');
    expect(
      await main(['add', 'remote', 'checkout', '--no-install', '--cwd', project], testRuntime()),
    ).toBe(0);
    const tree = await readTree(project);
    expect(tree).toHaveProperty(['packages/contracts/src/routes/cart.ts']);
    expect(tree).toHaveProperty(['packages/contracts/src/routes/checkout.ts']);
    expect(tree['apps/checkout/src/routes.ts']).toContain("defineRoutes('/checkout', contract)");
  });

  it('is not undone or duplicated by adding event-bus afterwards', async () => {
    await add('route-factory');
    const before = await read('apps/cart/src/routes.ts');
    expect(await add('event-bus')).toBe(0);
    expect(await read('apps/cart/src/routes.ts')).toBe(before);
  });

  it('writes a unit test for each remote when testing is installed', async () => {
    await add('testing');
    await add('route-factory');
    expect((await readTree(project))['apps/cart/src/routes.test.ts']).toContain(
      "links.href('cart.home')",
    );
  });
});

describe('http', () => {
  it('needs url-factory first (E206)', async () => {
    const fresh = await tempDir();
    try {
      expect(
        await main(
          ['init', 'bare', '--yes', '--no-install', '--features=lint-oxlint', '--cwd', fresh],
          testRuntime(),
        ),
      ).toBe(0);
      expect(
        await main(
          ['add', 'http', '--no-install', '--cwd', path.join(fresh, 'bare')],
          testRuntime(),
        ),
      ).toBe(4);
    } finally {
      await removeDir(fresh);
    }
  });

  it('writes a client over the url-factory endpoints in every app', async () => {
    await add('http');
    for (const app of ['shell', 'cart']) {
      const client = await read(`apps/${app}/src/api/client.ts`);
      expect(client, app).toContain("from './endpoints'");
      expect(client, app).toContain('createHttpClient<typeof endpoints, Responses>');
      expect((await json(`apps/${app}/package.json`)).dependencies, app).toHaveProperty([
        '@mfeflow/http',
      ]);
    }
  });

  it('reads the API base from apiUrl in the runtime config, with the old default as a fallback', async () => {
    await add('http');
    const endpoints = await read('apps/cart/src/api/endpoints.ts');
    expect(endpoints).toContain('`${service}Url`');
    expect(endpoints).toContain("api: '/api'");
  });

  it('without env-t3 puts apiUrl in public/config/runtime-config.json', async () => {
    await add('http');
    expect(await json('apps/shell/public/config/runtime-config.json')).toEqual({ apiUrl: '/api' });
  });

  it.each(['zod', 'valibot', 'arktype'])(
    'with env-t3 (%s) adds apiUrl to the schema and every environment file',
    async (validator) => {
      await add('env-t3', '--option', `env-t3.validator=${validator}`);
      await add('http');
      expect(await read('apps/shell/src/config/schema.ts')).toContain('apiUrl:');
      for (const env of ['dev', 'staging', 'prod']) {
        expect(await runtimeKeys(`apps/shell/public/config/runtime-config.${env}.json`)).toEqual([
          'environment',
          'apiUrl',
        ]);
      }
    },
  );

  it('ends up the same whichever of env-t3 and http is added first', async () => {
    await add('http');
    await add('env-t3');
    expect((await read('apps/shell/src/config/schema.ts')).match(/apiUrl:/g)).toHaveLength(1);
    expect(await runtimeKeys('apps/shell/public/config/runtime-config.prod.json')).toEqual([
      'environment',
      'apiUrl',
    ]);
  });

  it('adds the key once when both are added in one command', async () => {
    expect(await add('http', 'env-t3')).toBe(0);
    expect((await read('apps/shell/src/config/schema.ts')).match(/apiUrl:/g)).toHaveLength(1);
    expect(await runtimeKeys('apps/shell/public/config/runtime-config.prod.json')).toEqual([
      'environment',
      'apiUrl',
    ]);
  });

  it('writes a unit test for the client when testing is installed', async () => {
    await add('testing');
    await add('http');
    expect((await readTree(project))['apps/cart/src/api/client.test.ts']).toContain(
      "api.get('health')",
    );
  });
});
