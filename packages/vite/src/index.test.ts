import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build, type Plugin, type PluginOption, type UserConfig } from 'vite';
import { resetHeadScriptsForTests } from '@mfeflow/bundler-shared';

// Under vitest, `require.resolve` follows the workspace aliases, so every `@mfeflow/*` package looks
// installed to the preset while Vite itself cannot resolve them. Report what a real app would see.
vi.mock('@mfeflow/bundler-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mfeflow/bundler-shared')>();
  return {
    ...actual,
    resolvableFrom: (cwd: string) => {
      const real = actual.resolvableFrom(cwd);
      return (s: string) => !s.startsWith('@mfeflow/') && real(s);
    },
  };
});
import {
  createRemoteConfig,
  createShellConfig,
  pluginRestartOn,
  pluginRuntimeConfig,
  registerHeadScript,
  remoteFederationOptions,
  REMOTE_ENTRY,
  shellFederationOptions,
  toImportPath,
} from '.';
import { headScriptTags } from './head-scripts';
import { isUnder } from './restart';

const only =
  (...names: string[]) =>
  (s: string) =>
    names.includes(s);

function plugins(config: UserConfig): Plugin[] {
  const flat = (list: readonly PluginOption[]): Plugin[] =>
    list.flatMap((p) => {
      if (Array.isArray(p)) return flat(p);
      return p && typeof p === 'object' && 'name' in p ? [p] : [];
    });
  return flat(config.plugins ?? []);
}

function plugin(config: UserConfig, name: string): Plugin {
  const found = plugins(config).find((p) => p.name === name);
  if (!found) throw new Error(`no plugin ${name}`);
  return found;
}

function callHook(hook: unknown, ...args: unknown[]): unknown {
  const fn: unknown = typeof hook === 'function' ? hook : Reflect.get(Object(hook), 'handler');
  if (typeof fn !== 'function') throw new Error('not a hook');
  return Reflect.apply(fn, {}, args);
}

afterEach(resetHeadScriptsForTests);

/** This package's own version: the shell config in these tests runs from this package's folder. */
function ownVersion(): string {
  const pkg: unknown = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'),
  );
  const version: unknown = Reflect.get(Object(pkg), 'version');
  if (typeof version !== 'string') throw new Error('package.json has no version');
  return version;
}

describe('federation options', () => {
  it('gives a remote the same entry file name as the Rsbuild preset', () => {
    const o = remoteFederationOptions(
      { name: 'cart', exposes: { './App': './src/App.tsx' } },
      only('react'),
    );
    expect(o).toMatchObject({
      name: 'cart',
      filename: REMOTE_ENTRY,
      manifest: true,
      // The shell provides the Module Federation runtime; remotes do not bundle their own.
      experiments: { externalRuntime: true },
    });
  });

  it('writes Windows runtime plugin paths with forward slashes, so the generated import parses', () => {
    const o = shellFederationOptions(
      { name: 'shell', env: {}, runtimePlugins: ['D:\\app\\src\\plugin.ts'] },
      only('@mfeflow/runtime/plugins/report'),
      (s) => `C:\\repo\\node_modules\\${s.replaceAll('/', '\\')}.js`,
    );
    expect(o.runtimePlugins).toEqual([
      'C:/repo/node_modules/@mfeflow/runtime/plugins/report.js',
      'D:/app/src/plugin.ts',
    ]);
    expect(toImportPath('\\\\server\\share\\p.js')).toBe('//server/share/p.js');
    expect(toImportPath('/home/me/p.js')).toBe('/home/me/p.js');
    expect(toImportPath('@scope/pkg')).toBe('@scope/pkg');
  });

  it('gives the shell eager singletons and no static remotes', () => {
    const o = shellFederationOptions({ name: 'shell', env: {} }, only('react'), (s) => s);
    expect(o.shared).toEqual({ react: { singleton: true, eager: true } });
    expect(o.remotes).toEqual({});
    expect(o.experiments).toEqual({ provideExternalRuntime: true });
  });
});

describe('createRemoteConfig', () => {
  it('serves on a fixed port with absolute URLs and keeps assets relative', () => {
    const c = createRemoteConfig({ name: 'cart', exposes: { './A': './a' }, port: 4312 });
    expect(c.base).toBe('./');
    expect(c.server).toEqual({ port: 4312, strictPort: true, origin: 'http://localhost:4312' });
    expect(c.preview).toEqual({ port: 4312, strictPort: true });
    // Only PUBLIC_*, as in Rsbuild: a VITE_* variable never reaches the browser bundle.
    expect(c.envPrefix).toBe('PUBLIC_');
  });

  it('leaves the port to Vite when none is given', () => {
    const c = createRemoteConfig({ name: 'cart', exposes: { './A': './a' } });
    expect(c.server).toEqual({});
    expect(c.preview).toEqual({});
  });
});

describe('createShellConfig', () => {
  const cwd = path.resolve(import.meta.dirname, '..');

  it('is a single-page app on its port', () => {
    const c = createShellConfig({ name: 'shell', port: 4300, cwd });
    expect(c.appType).toBe('spa');
    expect(c.server).toEqual({ port: 4300, strictPort: true });
  });

  it('defines the runtime constants, and decides production from NODE_ENV as Rsbuild does', () => {
    const define = (env: Record<string, string>, command: 'build' | 'serve', mode: string) => {
      const p = plugin(createShellConfig({ name: 'shell', cwd, env }), 'mfeflow:shell-defines');
      return Reflect.get(Object(callHook(p.config, {}, { command, mode })), 'define') as Record<
        string,
        string
      >;
    };
    // Unset NODE_ENV follows Vite: a build is production whatever --mode says, the dev server is not.
    expect(define({}, 'serve', 'development')['__MFEFLOW_SNAPSHOT__']).toBe('true');
    expect(define({}, 'build', 'production')['__MFEFLOW_SNAPSHOT__']).toBe('false');
    expect(define({}, 'build', 'staging')['__MFEFLOW_SNAPSHOT__']).toBe('false');
    // A NODE_ENV that is set wins over the command.
    expect(define({ NODE_ENV: 'development' }, 'build', 'production')['__MFEFLOW_SNAPSHOT__']).toBe(
      'true',
    );
    expect(define({}, 'build', 'production')['__MFEFLOW_APP_VERSION__']).toBe(
      JSON.stringify(ownVersion()),
    );
  });

  it('checks the async boundary with eager: false', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-vite-eager-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/index.ts'), "import './bootstrap';\n");
    expect(() => createShellConfig({ name: 'shell', cwd: dir, eager: false })).toThrow(
      /import\(\)/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('puts registered head scripts first in <head>', () => {
    registerHeadScript('theme', 'run();');
    const html = plugin(createShellConfig({ name: 'shell', cwd }), 'mfeflow:head-scripts');
    expect(callHook(html.transformIndexHtml)).toEqual([
      { tag: 'script', children: 'run();', injectTo: 'head-prepend' },
    ]);
    resetHeadScriptsForTests();
    expect(headScriptTags()).toEqual([]);
  });
});

describe('pluginRuntimeConfig', () => {
  it('adds the handler to the dev and preview servers only when the shell has env files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-vite-rc-'));
    const use = vi.fn();
    const none = pluginRuntimeConfig(dir, {});
    callHook(none.configureServer, { middlewares: { use } });
    expect(use).not.toHaveBeenCalled();

    fs.mkdirSync(path.join(dir, 'public/config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public/config/runtime-config.dev.json'), '{"a":1}');
    const some = pluginRuntimeConfig(dir, {});
    callHook(some.configureServer, { middlewares: { use } });
    callHook(some.configurePreviewServer, { middlewares: { use } });
    expect(use).toHaveBeenCalledTimes(2);

    const handler: unknown = use.mock.calls[0]?.[0];
    if (typeof handler !== 'function') throw new Error('no handler');
    let body = '';
    const res = {
      statusCode: 0,
      setHeader: () => undefined,
      end: (b: string) => {
        body = b;
      },
    };
    Reflect.apply(handler, {}, [
      { url: '/config/runtime-config.json', method: 'GET' } as IncomingMessage,
      res as unknown as ServerResponse,
      () => undefined,
    ]);
    expect(body).toBe('{"a":1}');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('pluginRestartOn', () => {
  it('knows a file inside a watched folder from one outside it', () => {
    expect(isUnder('/a/b/c.json', '/a/b')).toBe(true);
    expect(isUnder('/a/b', '/a/b')).toBe(true);
    expect(isUnder('/a/bc.json', '/a/b')).toBe(false);
  });

  it('restarts the dev server for a change under the watched paths only', () => {
    const handlers = new Map<string, (file: string) => void>();
    const server = {
      restart: vi.fn(() => Promise.resolve()),
      watcher: {
        add: vi.fn(),
        on: (event: string, fn: (file: string) => void) => handlers.set(event, fn),
      },
    };
    const p = pluginRestartOn('/project/registry/envs/dev');
    expect(p.apply).toBe('serve');
    callHook(p.configureServer, server);
    expect(server.watcher.add).toHaveBeenCalledWith([path.resolve('/project/registry/envs/dev')]);
    handlers.get('change')?.('/project/src/App.tsx');
    expect(server.restart).not.toHaveBeenCalled();
    handlers.get('add')?.('/project/registry/envs/dev/cart.json');
    expect(server.restart).toHaveBeenCalledTimes(1);
  });
});

describe('createRemoteConfig (real build)', () => {
  it('builds a remote with a manifest and shared react singletons', async () => {
    const fixture = path.resolve(import.meta.dirname, '../test/fixtures/remote');
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-vite-'));
    // @module-federation/vite turns itself off under a test runner unless told otherwise.
    vi.stubEnv('MFE_VITE_NO_TEST_ENV_CHECK', 'true');
    const config = createRemoteConfig({
      name: 'fixture',
      exposes: { './App': './src/App.tsx' },
      types: false,
      cwd: fixture,
    });
    await build({
      ...config,
      configFile: false,
      logLevel: 'silent',
      build: { ...config.build, outDir: dist, emptyOutDir: true },
    });
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(dist, 'mf-manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      name: 'fixture',
      metaData: { remoteEntry: { name: REMOTE_ENTRY } },
      exposes: [expect.objectContaining({ path: './App' })],
    });
    const shared: unknown = Reflect.get(Object(manifest), 'shared');
    const names: unknown[] = Array.isArray(shared)
      ? shared.map((s: unknown): unknown => Reflect.get(Object(s), 'name'))
      : [];
    expect(names).toEqual(expect.arrayContaining(['react', 'react-dom']));
    fs.rmSync(dist, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }, 120_000);
});
