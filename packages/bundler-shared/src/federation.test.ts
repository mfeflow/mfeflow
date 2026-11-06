import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkName,
  commonRemoteOptions,
  commonShellOptions,
  headScripts,
  registerHeadScript,
  resetHeadScriptsForTests,
  shellDefines,
} from '.';

const only =
  (...names: string[]) =>
  (s: string) =>
    names.includes(s);

describe('checkName', () => {
  it('accepts Module Federation names and rejects the rest', () => {
    expect(() => {
      checkName('cart_2');
    }).not.toThrow();
    for (const bad of ['Cart', '2cart', 'my-cart', '']) {
      expect(() => {
        checkName(bad);
      }).toThrow(/not a valid Module Federation name/);
    }
  });
});

describe('commonRemoteOptions', () => {
  it('has the exposes, singletons, a manifest and types, and nothing bundler-specific', () => {
    const o = commonRemoteOptions(
      { name: 'cart', exposes: { './App': './src/App.tsx' } },
      only('react'),
    );
    expect(o).toEqual({
      name: 'cart',
      exposes: { './App': './src/App.tsx' },
      shared: { react: { singleton: true } },
      manifest: true,
      dts: { generateTypes: true, consumeTypes: false },
    });
    expect(o).not.toHaveProperty('experiments');
  });

  it('turns types off on request and refuses an empty exposes', () => {
    expect(
      commonRemoteOptions({ name: 'cart', exposes: { './A': './a' }, types: false }, only()).dts,
    ).toBe(false);
    expect(() => commonRemoteOptions({ name: 'cart', exposes: {} }, only())).toThrow(
      /exposes nothing/,
    );
  });
});

describe('commonShellOptions', () => {
  it('shares eagerly, adds the runtime plugins it can resolve, and has no static remotes', () => {
    const o = commonShellOptions(
      { name: 'shell', runtimePlugins: ['/x/plugin.js'], env: {} },
      only('react', '@mfeflow/runtime/plugins/report'),
      (s) => `/abs/${s}`,
    );
    expect(o.remotes).toEqual({});
    expect(o.shared).toEqual({ react: { singleton: true, eager: true } });
    expect(o.runtimePlugins).toEqual(['/abs/@mfeflow/runtime/plugins/report', '/x/plugin.js']);
    expect(o.dts).toBe(false);
  });

  it('consumes remote types only in a types build', () => {
    const o = commonShellOptions(
      {
        name: 'shell',
        typesFrom: { cart: 'http://x/mf-manifest.json' },
        env: { MFEFLOW_TYPES: '1' },
      },
      only(),
      (s) => s,
    );
    expect(o.remotes).toEqual({ cart: 'cart@http://x/mf-manifest.json' });
    expect(o.dts).toEqual({
      generateTypes: false,
      consumeTypes: { typesOnBuild: true, abortOnError: true },
    });
  });
});

describe('shellDefines', () => {
  it('defines the snapshot flag, the app version and the singleton list', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-defines-'));
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    expect(
      shellDefines({ env: { NODE_ENV: 'production' } }, cwd, only('react', 'react-dom/client')),
    ).toEqual({
      __MFEFLOW_SNAPSHOT__: 'false',
      __MFEFLOW_APP_VERSION__: '"1.2.3"',
      __MFEFLOW_SINGLETONS__: '["react","react-dom"]',
    });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});

describe('head scripts', () => {
  afterEach(resetHeadScriptsForTests);

  it('keeps one script per name, in first-registered order', () => {
    registerHeadScript('theme', 'one');
    registerHeadScript('other', 'two');
    registerHeadScript('theme', 'three');
    expect(headScripts()).toEqual(['three', 'two']);
  });
});
