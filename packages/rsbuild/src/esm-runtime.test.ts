import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRsbuild, type RsbuildConfig, type RsbuildPlugin } from '@rsbuild/core';
import { esmTwin, isMfCjs, pluginMfEsmRuntime, swapPath } from './esm-runtime.js';
import { createRemoteConfig, createShellConfig } from './index.js';

describe('isMfCjs', () => {
  it('matches CommonJS builds inside @module-federation packages only', () => {
    expect(isMfCjs('/n/@module-federation/runtime-core/dist/index.cjs')).toBe(true);
    expect(isMfCjs('C:\\n\\@module-federation\\sdk\\dist\\node.cjs')).toBe(true);
    expect(isMfCjs('/n/@module-federation/runtime-core/dist/index.js')).toBe(false);
    expect(isMfCjs('/n/react/cjs/react.development.cjs')).toBe(false);
    expect(isMfCjs('/n/@module-federation/sdk/package.cjs')).toBe(false);
    expect(isMfCjs('/n/@module-federation/sdk/dist/')).toBe(false);
    expect(isMfCjs('/n/@module-federation//dist/x.cjs')).toBe(false);
  });

  it('stays fast on a long path that nearly matches', () => {
    const start = Date.now();
    isMfCjs(`/@module-federation/a/dist/${'/dist/'.repeat(20_000)}x.cjs.js`);
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe('swapPath', () => {
  it('replaces the first occurrence, taking the new path literally', () => {
    expect(swapPath('a!/x/f.cjs?q', '/x/f.cjs', '/x/f.js')).toBe('a!/x/f.js?q');
    expect(swapPath('/p/f.cjs', '/p/f.cjs', '/p/$&/$1/f.js')).toBe('/p/$&/$1/f.js');
  });
});

describe('esmTwin', () => {
  it('prefers .js, then .mjs, and throws when there is neither', () => {
    expect(esmTwin('/a/x.cjs', (f) => f === '/a/x.js' || f === '/a/x.mjs')).toBe('/a/x.js');
    expect(esmTwin('/a/x.cjs', (f) => f === '/a/x.mjs')).toBe('/a/x.mjs');
    expect(() => esmTwin('/a/x.cjs', () => false)).toThrow(/no ESM build next to \/a\/x\.cjs/);
  });
});

const fixture = path.resolve(import.meta.dirname, '../test/fixtures/remote');

/** Builds the fixture and returns the names of every module in the bundle. */
async function bundledModules(config: RsbuildConfig, cwd = fixture): Promise<string[]> {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-esm-'));
  const names: string[] = [];
  const collect: RsbuildPlugin = {
    name: 'test:collect-modules',
    setup(api) {
      api.onAfterBuild(({ stats }) => {
        const json = stats?.toJson({ all: false, modules: true, nestedModules: true });
        const walk = (modules: { name?: string; modules?: unknown[] }[] | undefined): void => {
          for (const m of modules ?? []) {
            if (m.name) names.push(m.name);
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- nested stats modules have the same shape
            walk(m.modules as { name?: string; modules?: unknown[] }[] | undefined);
          }
        };
        walk(json?.modules);
      });
    },
  };
  const rsbuild = await createRsbuild({
    cwd,
    rsbuildConfig: {
      ...config,
      plugins: [...(config.plugins ?? []), collect],
      output: { ...config.output, distPath: { root: dist } },
      logLevel: 'error',
    },
  });
  try {
    await rsbuild.build();
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
  return names;
}

const isMfModule = (name: string) => /@module-federation[\\/]/.test(name);

describe('the Module Federation runtime in a real build', () => {
  it('resolves to the ESM build in a remote and in a shell, never to .cjs', async () => {
    const remote = await bundledModules(
      createRemoteConfig({
        name: 'fixture',
        exposes: { './App': './src/App.tsx' },
        types: false,
        cwd: fixture,
      }),
    );
    const shell = await bundledModules(createShellConfig({ name: 'shell', cwd: fixture }));
    for (const modules of [remote, shell]) {
      const mf = modules.filter(isMfModule);
      expect(mf.length).toBeGreaterThan(0);
      expect(mf.filter((m) => m.endsWith('.cjs'))).toEqual([]);
    }
  }, 120_000);

  it('keeps the CommonJS runtime when esmRuntime is false (proves the check can fail)', async () => {
    const modules = await bundledModules(
      createRemoteConfig({
        name: 'fixture',
        exposes: { './App': './src/App.tsx' },
        types: false,
        esmRuntime: false,
        cwd: fixture,
      }),
    );
    expect(modules.filter(isMfModule).some((m) => m.endsWith('.cjs'))).toBe(true);
  }, 120_000);
});

describe('a relative request to a sibling .cjs inside a Module Federation dist', () => {
  it('gets the ESM twin before rules run, so the twin is parsed as ESM', async () => {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-rel-'));
    const dist = path.join(app, 'node_modules/@module-federation/fake/dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.mkdirSync(path.join(app, 'src'));
    fs.writeFileSync(
      path.join(dist, 'entry.js'),
      "import helper from './helper.cjs';\nexport const value = helper;\n",
    );
    fs.writeFileSync(path.join(dist, 'helper.cjs'), "module.exports = 'cjs';\n");
    fs.writeFileSync(path.join(dist, 'helper.js'), "export default 'esm';\n");
    fs.writeFileSync(
      path.join(app, 'src/index.js'),
      "import { value } from '@module-federation/fake/dist/entry.js';\nconsole.log(value);\n",
    );
    fs.writeFileSync(path.join(app, 'package.json'), '{"name":"app","private":true}\n');
    try {
      const modules = await bundledModules(
        { source: { entry: { index: './src/index.js' } }, plugins: [pluginMfEsmRuntime()] },
        app,
      );
      expect(modules.some((m) => m.endsWith('/fake/dist/helper.js'))).toBe(true);
      expect(modules.filter((m) => m.endsWith('.cjs'))).toEqual([]);
    } finally {
      fs.rmSync(app, { recursive: true, force: true });
    }
  }, 60_000);
});

/** Builds a throwaway app whose entry is `source` and whose fake MF package has the given files. */
async function buildApp(
  pkgFiles: Record<string, string>,
  pkgJson: object,
  source: string,
): Promise<string[]> {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-bare-'));
  const pkg = path.join(app, 'node_modules/@module-federation/fake');
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(app, 'src'));
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify(pkgJson));
  for (const [file, body] of Object.entries(pkgFiles)) fs.writeFileSync(path.join(pkg, file), body);
  fs.writeFileSync(path.join(app, 'src/index.js'), source);
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"app","private":true}\n');
  try {
    return await bundledModules(
      { source: { entry: { index: './src/index.js' } }, plugins: [pluginMfEsmRuntime()] },
      app,
    );
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
}

describe('a bare request that resolves to a .cjs inside a Module Federation dist', () => {
  const files = {
    'dist/index.cjs': "module.exports = { value: 'cjs' };\n",
    'dist/index.js': "export const value = 'esm';\n",
  };

  it('does not break the build for a bare specifier with an explicit .cjs path', async () => {
    const modules = await buildApp(
      files,
      { name: '@module-federation/fake', exports: { './dist/index.cjs': './dist/index.cjs' } },
      "const fake = require('@module-federation/fake/dist/index.cjs');\nconsole.log(fake.value);\n",
    );
    expect(modules.some((m) => m.endsWith('/fake/dist/index.js'))).toBe(true);
    expect(modules.filter((m) => m.endsWith('.cjs'))).toEqual([]);
  }, 60_000);

  it('swaps a require-condition .cjs for its twin and parses the twin as ESM', async () => {
    const modules = await buildApp(
      files,
      {
        name: '@module-federation/fake',
        exports: { '.': { import: './dist/index.js', require: './dist/index.cjs' } },
      },
      "const fake = require('@module-federation/fake');\nconsole.log(fake.value);\n",
    );
    expect(modules.some((m) => m.endsWith('/fake/dist/index.js'))).toBe(true);
    expect(modules.filter((m) => m.endsWith('.cjs'))).toEqual([]);
  }, 60_000);
});
