import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFederation, type FederationReport } from '.';
import { memoryFs } from './testing';

const fixtures = path.join(import.meta.dirname, '../../test-fixtures/adopt');
const fixture = (name: string): Promise<FederationReport> =>
  detectFederation(path.join(fixtures, name));

const root = path.resolve('/virtual/project');
const inMemory = (files: Record<string, string>): Promise<FederationReport> =>
  detectFederation(root, memoryFs(root, files));

const react = { react: { singleton: true }, 'react-dom': { singleton: true } };
const react19 = {
  react: { singleton: true, requiredVersion: '^19.0.0' },
  'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
};

describe('detectFederation on fixtures', () => {
  it('reads a create-module-federation rsbuild provider', async () => {
    expect(await fixture('rsbuild-provider')).toEqual({
      apps: [
        {
          dir: '.',
          name: 'provider',
          packageName: 'mf-provider',
          role: 'remote',
          buildTool: 'rsbuild',
          configFile: 'rsbuild.config.ts',
          federationFile: 'module-federation.config.ts',
          remotes: {},
          exposes: { '.': './src/components/ProviderComponent.tsx' },
          shared: react,
          port: 3000,
        },
      ],
      notAdopted: [],
    });
  });

  it('reads the matching consumer', async () => {
    expect(await fixture('rsbuild-consumer')).toEqual({
      apps: [
        {
          dir: '.',
          name: 'consumer',
          packageName: 'mf-consumer',
          role: 'shell',
          buildTool: 'rsbuild',
          configFile: 'rsbuild.config.ts',
          federationFile: 'module-federation.config.ts',
          remotes: {
            provider: {
              name: 'provider',
              entry: 'http://localhost:3000/mf-manifest.json',
              type: 'manifest',
            },
          },
          exposes: {},
          shared: react,
          port: 2000,
        },
      ],
      notAdopted: [],
    });
  });

  it('reads a literal CommonJS webpack config, following consts and spreads in the same file', async () => {
    expect(await fixture('webpack-literal')).toEqual({
      apps: [
        {
          dir: '.',
          name: 'cart',
          packageName: 'webpack-literal',
          role: 'remote',
          buildTool: 'webpack',
          configFile: 'webpack.config.js',
          remotes: {
            profile: {
              name: 'profile',
              entry: 'http://localhost:3003/remoteEntry.js',
              type: 'script',
            },
          },
          exposes: { './Cart': './src/Cart', './CartButton': './src/CartButton' },
          shared: { ...react19, lodash: { requiredVersion: '^4.17.21' } },
          port: 3002,
        },
      ],
      notAdopted: [],
    });
  });

  it("reads an ESM webpack config using webpack's own container plugin", async () => {
    expect(await fixture('webpack-esm')).toEqual({
      apps: [
        {
          dir: '.',
          name: 'host',
          packageName: 'webpack-esm',
          role: 'shell',
          buildTool: 'webpack',
          configFile: 'webpack.config.mjs',
          remotes: {
            cart: { name: 'cart', entry: 'http://localhost:3002/remoteEntry.js', type: 'script' },
            search: { entry: 'http://localhost:3004/mf-manifest.json', type: 'manifest' },
          },
          exposes: {},
          shared: { react: {}, 'react-dom': {} },
          port: 8080,
        },
      ],
      notAdopted: [],
    });
  });

  it('keeps the literal parts of a dynamic config and lists the rest', async () => {
    const at = (field: string, reason: string) => ({
      dir: '.',
      file: 'webpack.config.js',
      field,
      reason,
    });
    expect(await fixture('dynamic')).toEqual({
      apps: [
        {
          dir: '.',
          name: 'dynamic_host',
          packageName: 'dynamic-host',
          role: 'remote',
          buildTool: 'webpack',
          configFile: 'webpack.config.js',
          remotes: {},
          exposes: { './Widget': './src/Widget' },
          shared: react,
        },
      ],
      notAdopted: [
        at('remotes', 'comes from a function call (getRemotes())'),
        at('exposes', 'has a computed key'),
        at('shared', "spreads an imported object (baseShared from './federation/shared')"),
        at('shared.react.requiredVersion', 'is read from another value (deps.react)'),
        at(
          "shared['react-dom'].requiredVersion",
          'reads an env variable (process.env.REACT_RANGE)',
        ),
        at('port', 'reads an env variable (process.env.PORT)'),
      ],
    });
  });

  it('adopts nothing when the whole options object is built by a function', async () => {
    expect(await fixture('dynamic-options')).toEqual({
      apps: [],
      notAdopted: [
        {
          dir: '.',
          file: 'rsbuild.config.ts',
          field: 'options',
          reason: 'comes from a function call (federationFor())',
        },
      ],
    });
  });

  it('finds a shell and two remotes in a pnpm monorepo, each with a different tool', async () => {
    const report = await fixture('monorepo');
    expect(report.notAdopted).toEqual([]);
    expect(report.apps).toEqual([
      {
        dir: 'apps/catalog',
        name: 'catalog',
        packageName: '@shop/catalog',
        role: 'remote',
        buildTool: 'rspack',
        configFile: 'apps/catalog/rspack.config.ts',
        remotes: {},
        exposes: { './ProductList': './src/ProductList.tsx' },
        shared: react19,
        port: 3001,
      },
      {
        dir: 'apps/checkout',
        name: 'checkout',
        packageName: '@shop/checkout',
        role: 'remote',
        buildTool: 'webpack',
        configFile: 'apps/checkout/webpack.config.cjs',
        remotes: {},
        exposes: { './Checkout': './src/Checkout' },
        shared: {
          react: { singleton: true, requiredVersion: false },
          'react-dom': { singleton: true },
        },
        port: 3002,
      },
      {
        dir: 'apps/shell',
        name: 'shell',
        packageName: '@shop/shell',
        role: 'shell',
        buildTool: 'rsbuild',
        configFile: 'apps/shell/rsbuild.config.mjs',
        remotes: {
          catalog: {
            name: 'catalog',
            entry: 'http://localhost:3001/mf-manifest.json',
            type: 'manifest',
          },
          checkout: {
            name: 'checkout',
            entry: 'http://localhost:3002/remoteEntry.js',
            type: 'script',
          },
        },
        exposes: {},
        shared: react19,
        port: 3000,
      },
    ]);
  });

  it('returns nothing for a folder without any config', async () => {
    expect(await fixture('does-not-exist')).toEqual({ apps: [], notAdopted: [] });
  });
});

const RSBUILD = `import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';`;
const rsbuild = (options: string, extra = ''): string =>
  `${RSBUILD}\n${extra}\nexport default { plugins: [pluginModuleFederation(${options})] };\n`;

describe('detectFederation edge cases', () => {
  it('skips apps inside node_modules and build output', async () => {
    const config = rsbuild("{ name: 'x', exposes: { './A': './a' } }");
    const report = await inMemory({
      'package.json': JSON.stringify({ workspaces: ['packages/**'] }),
      'packages/a/package.json': '{"name":"a"}',
      'packages/a/rsbuild.config.ts': config,
      'packages/a/node_modules/b/package.json': '{}',
      'packages/a/node_modules/b/rsbuild.config.ts': config,
      'packages/dist/package.json': '{}',
      'packages/dist/rsbuild.config.ts': config,
    });
    expect(report.apps.map((a) => a.dir)).toEqual(['packages/a']);
  });

  it('follows a named import through a .js specifier to a .ts file', async () => {
    const report = await inMemory({
      'rsbuild.config.ts': rsbuild('mf', "import { mf } from './federation/config.js';"),
      'federation/config.ts': "const mf = { name: 'named' };\nexport { mf };\n",
    });
    expect(report.apps[0]).toMatchObject({ name: 'named', federationFile: 'federation/config.ts' });
  });

  it('follows an import to a folder index and a const in the same file', async () => {
    const report = await inMemory({
      'rsbuild.config.mjs': rsbuild('options', "import cfg from './mf';\nconst options = cfg;"),
      'mf/index.cjs': "module.exports = { name: 'indexed' };\n",
    });
    expect(report.apps[0]).toMatchObject({ name: 'indexed', federationFile: 'mf/index.cjs' });
  });

  it('uses module-federation.config when the build config has no plugin call', async () => {
    const report = await inMemory({
      'rspack.config.js': 'module.exports = {};\n',
      'module-federation.config.js': "module.exports = { name: 'side' };\n",
    });
    expect(report.apps[0]).toMatchObject({
      name: 'side',
      buildTool: 'rspack',
      configFile: 'rspack.config.js',
      federationFile: 'module-federation.config.js',
      role: 'shell',
    });
  });

  it('ignores a build config with no federation at all', async () => {
    expect(await inMemory({ 'rsbuild.config.ts': 'export default {};\n' })).toEqual({
      apps: [],
      notAdopted: [],
    });
  });

  it.each([
    [
      'a module-federation.config with no build config',
      { 'module-federation.config.ts': 'export default {};' },
      'module-federation.config.ts',
      'buildTool',
      'has no rsbuild, rspack or webpack config next to it',
    ],
    [
      'a config that does not parse',
      { 'webpack.config.js': 'module.exports = {' },
      'webpack.config.js',
      'file',
      'could not be parsed',
    ],
    [
      'two plugins in one config',
      { 'rsbuild.config.ts': rsbuild('{}').replace('] }', ', pluginModuleFederation({})] }') },
      'rsbuild.config.ts',
      'options',
      'has 2 Module Federation plugins in one config, so none of them is read',
    ],
    [
      'options imported from a package',
      { 'rsbuild.config.ts': rsbuild('mf', "import mf from '@org/mf-config';") },
      'rsbuild.config.ts',
      'options',
      "are imported from a package (mf from '@org/mf-config')",
    ],
    [
      'options imported from outside the folder',
      { 'rsbuild.config.ts': rsbuild('mf', "import mf from '../shared/mf';") },
      'rsbuild.config.ts',
      'options',
      "are imported from outside the project ('../shared/mf')",
    ],
    [
      'options imported from a missing file',
      { 'rsbuild.config.ts': rsbuild('mf', "import mf from './nope';") },
      'rsbuild.config.ts',
      'options',
      "are imported from './nope', which was not found",
    ],
    [
      'options imported without a default export',
      {
        'rsbuild.config.ts': rsbuild('mf', "import mf from './mf';"),
        'mf.ts': 'export const a = {};',
      },
      'rsbuild.config.ts',
      'options',
      "are imported from './mf', which has no default export",
    ],
    [
      'options imported by a name that is not exported',
      {
        'rsbuild.config.ts': rsbuild('mf', "import { mf } from './mf';"),
        'mf.ts': 'export default {};',
      },
      'rsbuild.config.ts',
      'options',
      "are imported from './mf', which has no export mf",
    ],
    [
      'options imported through too many files',
      {
        'rsbuild.config.ts': rsbuild('a', "import a from './a';"),
        'a.ts': "import b from './b'; export default b;",
        'b.ts': "import c from './c'; export default c;",
        'c.ts': "import d from './d'; export default d;",
        'd.ts': 'export default {};',
      },
      'rsbuild.config.ts',
      'options',
      'are imported through more than 3 files',
    ],
    [
      'options that are a let variable',
      { 'rsbuild.config.ts': rsbuild('mf', 'let mf = {};') },
      'rsbuild.config.ts',
      'options',
      'refers to mf, which is a let variable',
    ],
    [
      'options that are a string',
      { 'rsbuild.config.ts': rsbuild('mf', "const mf = 'x';") },
      'rsbuild.config.ts',
      'options',
      'are not an object',
    ],
    [
      'options that are a ternary',
      { 'rsbuild.config.ts': rsbuild('dev ? a : b') },
      'rsbuild.config.ts',
      'options',
      'depends on a condition (a ? b : c)',
    ],
    [
      'a plugin call with no options',
      { 'rsbuild.config.ts': rsbuild('') },
      'rsbuild.config.ts',
      'options',
      'are missing',
    ],
  ])('reports %s', async (_, files, file, field, reason) => {
    expect(await inMemory(files)).toEqual({
      apps: [],
      notAdopted: [{ dir: '.', file, field, reason }],
    });
  });

  it('reads each field as far as it is literal and lists the rest', async () => {
    const options = `{
      name: appName,
      ...extra(),
      remotes: {
        bare: 'https://cdn.example.com/a/remoteEntry.js?v=1',
        obj: { external: 'obj@https://cdn.example.com/obj/mf-manifest.json' },
        noUrl: 'app1',
        inline: 'promise new Promise(() => {})',
        num: 1,
        badObj: { external: ['a@/x.js'] },
        env: process.env.REMOTE,
        ...more,
        [k]: 'x@/y.js',
      },
      exposes: ['./src/A', './src/B'],
      shared: ['react', 1, getName()],
    }`;
    const report = await inMemory({
      'package.json': '{ not json',
      'rsbuild.config.ts': `${RSBUILD}
let appName = 'x';
export default {
  server: { port: '3000' },
  plugins: [pluginModuleFederation(${options})],
};
`,
    });
    expect(report.apps).toEqual([
      {
        dir: '.',
        role: 'remote',
        buildTool: 'rsbuild',
        configFile: 'rsbuild.config.ts',
        remotes: {
          bare: { entry: 'https://cdn.example.com/a/remoteEntry.js?v=1', type: 'script' },
          obj: {
            name: 'obj',
            entry: 'https://cdn.example.com/obj/mf-manifest.json',
            type: 'manifest',
          },
        },
        exposes: { './src/A': './src/A', './src/B': './src/B' },
        shared: { react: {} },
      },
    ]);
    expect(report.notAdopted.map((n) => [n.field, n.reason])).toEqual([
      ['workspaces', 'could not be parsed'],
      ['options', 'spreads a value that comes from a function call (extra())'],
      ['name', 'refers to appName, which is a let variable'],
      ['remotes', 'spreads a value that refers to more, which is not a const in this file'],
      ['remotes', 'has a computed key'],
      ['remotes.noUrl', 'has no URL ("app1")'],
      ['remotes.inline', 'is loaded by inline code (promise …)'],
      ['remotes.num', 'is not a string'],
      ['remotes.badObj', 'has no string external'],
      ['remotes.env', 'reads an env variable (process.env.REMOTE)'],
      ['shared[1]', 'is not a package name'],
      ['shared[2]', 'comes from a function call (getName())'],
      ['port', 'is not a number'],
    ]);
  });

  it('lists shared and exposes entries of the wrong shape', async () => {
    const report = await inMemory({
      'webpack.config.js': `const { ModuleFederationPlugin: MF } = require('@module-federation/enhanced');
const name = 7;
module.exports = [{
  devServer: { port: 1 },
  plugins: [new MF({
    name,
    remotes: getRemotes,
    exposes: { './A': { import: ['./a', './b'] }, './B': call(), m() {} },
    shared: {
      a: true,
      b: { singleton: 'yes', requiredVersion: 1, eager: true },
      c: { singleton: flag, ...base },
      d: pkg.version,
      e: missing,
      f: { singleton: true, requiredVersion: false },
    },
  })],
}, { devServer: { port: 2 } }];
`,
    });
    expect(report.apps[0]).not.toHaveProperty('name');
    expect(report.apps[0]).toMatchObject({
      role: 'remote',
      exposes: {},
      shared: { b: {}, c: {}, f: { singleton: true, requiredVersion: false } },
    });
    expect(report.notAdopted.map((n) => [n.field, n.reason])).toEqual([
      ['name', 'is not a string'],
      ['remotes', 'refers to getRemotes, which is not a const in this file'],
      ['exposes.m', 'is a method'],
      ["exposes['./A']", 'is not a module path'],
      ["exposes['./B']", 'comes from a function call (call())'],
      ['shared.a', 'is not a version range or an options object'],
      ['shared.b.singleton', 'is not true or false'],
      ['shared.b.requiredVersion', 'is not a version range'],
      ['shared.c', 'spreads a value that refers to base, which is not a const in this file'],
      ['shared.c.singleton', 'refers to flag, which is not a const in this file'],
      ['shared.d', 'is read from another value (pkg.version)'],
      ['shared.e', 'refers to missing, which is not a const in this file'],
      ['port', 'is set in more than one place'],
    ]);
  });

  it('lists remotes, exposes and shared that are not objects', async () => {
    const report = await inMemory({
      'rsbuild.config.ts': rsbuild(
        "{ remotes: ['a@/x.js'], exposes: ['./a', 1], shared: 'react' }",
      ),
    });
    expect(report.notAdopted.map((n) => [n.field, n.reason])).toEqual([
      ['remotes', 'is not an object'],
      ['exposes', 'is an array with items that are not strings'],
      ['shared', 'is not an object'],
    ]);
    const call = await inMemory({ 'rsbuild.config.ts': rsbuild('{ exposes: [make()] }') });
    expect(call.notAdopted.map((n) => n.reason)).toEqual(['comes from a function call (make())']);
    expect(call.apps[0]?.role).toBe('remote');
  });

  it('says why when an imported options file does not parse', async () => {
    const report = await inMemory({
      'rsbuild.config.ts': rsbuild('mf', "import mf from './mf';"),
      'mf.ts': 'export default {',
    });
    expect(report.notAdopted).toEqual([
      { dir: '.', file: 'mf.ts', field: 'file', reason: 'could not be parsed' },
      {
        dir: '.',
        file: 'rsbuild.config.ts',
        field: 'options',
        reason: "are imported from './mf', which could not be parsed",
      },
    ]);
  });

  it('reports workspace files it cannot read against the root', async () => {
    const report = await inMemory({ 'pnpm-workspace.yaml': 'packages: [' });
    expect(report.notAdopted).toEqual([
      { dir: '.', file: 'pnpm-workspace.yaml', field: 'workspaces', reason: 'could not be parsed' },
    ]);
  });
});
