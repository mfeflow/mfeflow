import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRsbuild, type RsbuildConfig, type RsbuildPlugin } from '@rsbuild/core';
import { esmTwin, isMfCjs } from './esm-runtime.js';
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

describe('esmTwin', () => {
  it('prefers .js, then .mjs, and throws when there is neither', () => {
    expect(esmTwin('/a/x.cjs', (f) => f === '/a/x.js' || f === '/a/x.mjs')).toBe('/a/x.js');
    expect(esmTwin('/a/x.cjs', (f) => f === '/a/x.mjs')).toBe('/a/x.mjs');
    expect(() => esmTwin('/a/x.cjs', () => false)).toThrow(/no ESM build next to \/a\/x\.cjs/);
  });
});

const fixture = path.resolve(import.meta.dirname, '../test/fixtures/remote');

/** Builds the fixture and returns the names of every module in the bundle. */
async function bundledModules(config: RsbuildConfig): Promise<string[]> {
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
    cwd: fixture,
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
