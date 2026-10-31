import { describe, expect, it } from 'vitest';
import { isFeatureManifest, isSafeRelativePath, validateFeatureManifest } from '.';

const feature = {
  name: '@acme/segment',
  version: '1.0.0',
  description: 'Segment analytics',
  prompts: [
    { name: 'region', type: 'select', choices: ['us', 'eu'], default: 'us' },
    { name: 'debug', type: 'boolean', default: false },
  ],
  requires: ['tsconfig'],
  conflicts: ['analytics-gtm'],
  files: [
    { to: 'src/analytics.ts', target: 'shell', content: 'export {};' },
    { to: 'src/x.ts', from: 'files/x.ts.eta', template: true },
  ],
  dependencies: [{ name: '@segment/analytics-next', range: '^1.0.0', target: 'shell' }],
  scripts: [{ name: 'analytics:check', command: 'node check.js' }],
  transforms: [
    { op: 'add-import', file: 'src/a.ts', from: 'x', named: ['y'] },
    {
      op: 'wrap-provider',
      file: 'src/providers.tsx',
      component: 'P',
      from: './p',
      props: { a: 1 },
    },
    { op: 'add-shared', file: 'src/singletons.ts', name: 'zod' },
    { op: 'add-boot-step', file: 'src/bootstrap.tsx', call: 'init', from: './init', args: ['a'] },
    {
      op: 'add-env-key',
      file: 'src/config/schema.ts',
      key: 'SEGMENT_KEY',
      scope: 'runtime',
      schema: 'z.string()',
      value: '',
      configFiles: ['public/config/runtime-config.dev.json'],
    },
    { op: 'add-route', file: 'src/router.tsx', path: '/x', component: 'X', from: './x' },
    {
      op: 'add-workflow-step',
      file: '.github/workflows/ci.yml',
      job: 'test',
      step: { name: 'Check', run: 'pnpm check' },
    },
  ],
  migrations: [{ from: '1.0.0', to: '1.1.0', module: 'migrations/1.1.0.js' }],
};

const paths = (value: unknown) => validateFeatureManifest(value).map((i) => i.path);

describe('feature.json', () => {
  it('accepts a complete manifest', () => {
    expect(validateFeatureManifest(feature)).toEqual([]);
    expect(isFeatureManifest(feature)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(paths('x')).toEqual(['']);
    expect(isFeatureManifest(null)).toBe(false);
  });

  it('reports a bad header with paths', () => {
    expect(paths({ name: 'Bad Name', version: 1, requires: ['x y'], conflicts: 'a' })).toEqual([
      'name',
      'version',
      'requires[0]',
      'conflicts',
    ]);
  });

  it('checks prompts', () => {
    expect(
      paths({
        ...feature,
        prompts: [
          { name: '1x', type: 'number' },
          { name: 'a', type: 'select', choices: ['b'], default: 'c' },
          { name: 'b', type: 'select' },
          { name: 'c', type: 'string', default: 3 },
          'no',
        ],
      }),
    ).toEqual([
      'prompts[0].name',
      'prompts[0].type',
      'prompts[1].default',
      'prompts[2].choices',
      'prompts[3].default',
      'prompts[4]',
    ]);
  });

  it('checks files, dependencies and scripts', () => {
    expect(
      paths({
        ...feature,
        files: [
          { to: '../etc/passwd', content: '' },
          { to: 'a', from: '/abs' },
          { to: 'b', content: 'x', from: 'y' },
          { to: 'c', content: 'x', target: 'Bad Target' },
        ],
        dependencies: [{ name: 'Bad Name', range: 1 }],
        scripts: [{ name: 'a b', command: 1 }],
      }),
    ).toEqual([
      'files[0].to',
      'files[1].from',
      'files[2]',
      'files[3].target',
      'dependencies[0].name',
      'dependencies[0].range',
      'scripts[0].name',
      'scripts[0].command',
    ]);
  });

  it('accepts a group, an app name and app:<name> as a target, and rejects app: alone', () => {
    const files = (target: string) => [{ to: 'a', content: 'x', target }];
    for (const target of ['root', 'shell', 'remotes', 'cart', 'app:shell', 'app:cart']) {
      expect(paths({ ...feature, files: files(target) }), target).toEqual([]);
    }
    for (const target of ['app:', 'app:Cart', 'app:a-b']) {
      expect(paths({ ...feature, files: files(target) }), target).toEqual(['files[0].target']);
    }
  });

  it('accepts a when on every kind of part and rejects a malformed one', () => {
    const when = { validator: 'zod', strict: true };
    expect(
      validateFeatureManifest({
        ...feature,
        files: [{ to: 'a', content: 'x', when }],
        dependencies: [{ name: 'zod', range: '1.0.0', when }],
        scripts: [{ name: 'a', command: 'b', when }],
        transforms: [{ op: 'add-import', file: 'a.ts', from: 'x', when }],
      }),
    ).toEqual([]);
    expect(
      paths({
        ...feature,
        files: [{ to: 'a', content: 'x', when: {} }],
        dependencies: [{ name: 'zod', range: '1.0.0', when: 'zod' }],
        scripts: [{ name: 'a', command: 'b', when: { 'not valid': 'x', ok: 3 } }],
        transforms: [{ op: 'add-import', file: 'a.ts', from: 'x', when: { v: null } }],
      }),
    ).toEqual([
      'files[0].when',
      'dependencies[0].when',
      'scripts[0].when',
      'scripts[0].when.ok',
      'transforms[0].when.v',
    ]);
  });

  it('accepts feature:<name> conditions that ask for a boolean', () => {
    const files = (when: unknown) => [{ to: 'a', content: 'x', when }];
    expect(
      validateFeatureManifest({
        ...feature,
        files: files({ 'feature:env-t3': true, 'feature:analytics-gtm': false, validator: 'zod' }),
      }),
    ).toEqual([]);
    expect(paths({ ...feature, files: files({ 'feature:env-t3': 'yes' }) })).toEqual([
      'files[0].when.feature:env-t3',
    ]);
    expect(paths({ ...feature, files: files({ 'feature:Env_T3': true }) })).toEqual([
      'files[0].when',
    ]);
  });

  it('accepts an add-env-key schema per validator and a list value, and rejects the rest', () => {
    const envKey = (extra: Record<string, unknown>) => ({
      op: 'add-env-key',
      file: 'src/config/schema.ts',
      key: 'gtmId',
      scope: 'runtime',
      schema: 'z.string()',
      ...extra,
    });
    expect(
      validateFeatureManifest({
        ...feature,
        transforms: [
          envKey({ schema: { zod: 'z.string()', valibot: 'v.string()' }, value: ['a', 'b'] }),
        ],
      }),
    ).toEqual([]);
    expect(
      paths({
        ...feature,
        transforms: [
          envKey({ schema: { yup: 'y.string()' } }),
          envKey({ schema: {} }),
          envKey({ schema: { zod: 3 } }),
          envKey({ value: ['a', 2] }),
        ],
      }),
    ).toEqual([
      'transforms[0].schema',
      'transforms[1].schema',
      'transforms[2].schema.zod',
      'transforms[3].value',
    ]);
  });

  it('rejects an unknown op and names the built-in ones', () => {
    const issues = validateFeatureManifest({
      ...feature,
      transforms: [{ op: 'run-shell', file: 'a', cmd: 'rm -rf /' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('add-import');
  });

  it('checks the arguments of each op', () => {
    expect(
      paths({
        ...feature,
        transforms: [
          'no',
          { file: 'a' },
          { op: 'add-import', file: '../a', from: 'x', named: ['1'], typeOnly: true },
          { op: 'wrap-provider', file: 'a', component: 'P', from: './p', props: { a: {} } },
          { op: 'add-shared', file: 'a', name: 'Bad Name' },
          {
            op: 'add-boot-step',
            file: 'a',
            call: 'f',
            from: 'x',
            before: 'a',
            after: 'b',
            args: [{}],
          },
          { op: 'add-boot-step', file: 'a', call: 'f', from: 'x', args: 'no' },
          {
            op: 'add-env-key',
            file: 'a',
            key: 'a b',
            scope: 'both',
            value: {},
            example: '../x',
            configFiles: ['/abs'],
          },
          { op: 'add-route', file: 'a', path: 'x', component: 'X', from: './x' },
          { op: 'add-workflow-step', file: 'a', job: 'j', step: { name: 'n', with: 3 } },
          { op: 'add-workflow-step', file: 'a', job: 'j', step: 'no' },
          { op: 'add-import', file: 'a', from: 'x', typeOnly: true },
          { op: 'add-route', file: 'a', path: '/x', component: 'X', from: 'y', defaultImport: 1 },
          { op: 'add-boot-step', file: 'a', call: 'f', from: 'x', await: 'yes' },
          { op: 'add-import', file: 'a', from: 'x', named: ['a'], typeOnly: 'no' },
        ],
      }),
    ).toEqual([
      'transforms[0]',
      'transforms[1].op',
      'transforms[2].file',
      'transforms[2].named[0]',
      'transforms[3].props.a',
      'transforms[4].name',
      'transforms[5]',
      'transforms[5].args[0]',
      'transforms[6].args',
      'transforms[7].key',
      'transforms[7].scope',
      'transforms[7].schema',
      'transforms[7].example',
      'transforms[7].configFiles',
      'transforms[7].value',
      'transforms[8].path',
      'transforms[9].step.with',
      'transforms[9].step',
      'transforms[10].step',
      'transforms[11]',
      'transforms[12].defaultImport',
      'transforms[13].await',
      'transforms[14].typeOnly',
    ]);
  });

  it('checks migrations and non-array lists', () => {
    expect(paths({ ...feature, migrations: [{ from: '1', to: '2', module: '../x' }] })).toEqual([
      'migrations[0].module',
    ]);
    expect(paths({ ...feature, files: {} })).toEqual(['files']);
  });
});

describe('isSafeRelativePath', () => {
  it('accepts project-relative POSIX paths', () => {
    expect(isSafeRelativePath('apps/shell/src/a.ts')).toBe(true);
    expect(isSafeRelativePath('.github/workflows/ci.yml')).toBe(true);
  });

  it.each(['', '/etc/passwd', 'C:/x', 'a\\b', '../a', 'a/../b', './a', 'a//b', 'a/', 'a\0b'])(
    'rejects %j',
    (value) => {
      expect(isSafeRelativePath(value)).toBe(false);
    },
  );
});
