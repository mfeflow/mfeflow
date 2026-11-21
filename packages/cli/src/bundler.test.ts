import fs from 'node:fs/promises';
import path from 'node:path';
import { MfeflowError } from '@mfeflow/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLER_PACKAGES,
  checkBundler,
  configOf,
  entryOf,
  loadBundler,
  realBundlerHost,
  resolveFromApp,
  type BundlerApp,
} from './bundler';
import { removeDir, tempDir } from './testing';

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

/** An app folder with config files, and a package installed in its node_modules. */
async function app(
  bundler: BundlerApp['bundler'],
  options: { configs?: string[]; packages?: Record<string, Record<string, unknown>> } = {},
): Promise<BundlerApp> {
  const dir = await tempDir('mfeflow-bundler-');
  dirs.push(dir);
  await write(path.join(dir, 'package.json'), '{"name":"@app/x"}');
  for (const file of options.configs ?? []) await write(path.join(dir, file), 'export default {}');
  for (const [name, files] of Object.entries(options.packages ?? {})) {
    for (const [file, text] of Object.entries(files)) {
      // oxlint-disable-next-line no-await-in-loop -- a few small files
      await write(path.join(dir, 'node_modules', name, file), String(text));
    }
  }
  return { name: 'x', dir, bundler };
}

/** What a promise rejects with, which must be a mfeflow error. */
async function refusal(promise: Promise<unknown>): Promise<MfeflowError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MfeflowError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

const calls = (): unknown[] => {
  const log: unknown = Reflect.get(globalThis, '__bundlerCalls');
  return Array.isArray(log) ? (log as unknown[]) : [];
};

const fakeRsbuild = {
  'package.json': JSON.stringify({
    name: '@rsbuild/core',
    version: '2.0.0',
    type: 'module',
    exports: { '.': { default: './index.js' }, './package.json': './package.json' },
  }),
  'index.js': `
const log = (globalThis.__bundlerCalls ??= []);
export async function loadConfig(o) { log.push(['loadConfig', o, process.env.NODE_ENV, process.env.RSPACK_UNSAFE_FAST_DROP]); return { content: { marker: 1 } }; }
export async function createRsbuild(o) {
  log.push(['createRsbuild', o]);
  return { build: async () => { if (globalThis.__failBuild) throw new Error(globalThis.__failBuild); return { close: async () => { log.push(['close']); } }; } };
}
`,
};

const fakeVite = {
  'package.json': JSON.stringify({
    name: 'vite',
    version: '8.0.0',
    type: 'module',
    exports: {
      '.': { import: { types: './t.d.ts', default: './index.js' }, require: './index.cjs' },
      './package.json': './package.json',
    },
  }),
  'index.js': `
const log = (globalThis.__bundlerCalls ??= []);
export async function build(o) { log.push(['vite.build', o, process.env.NODE_ENV]); if (globalThis.__failBuild) throw new Error(globalThis.__failBuild); }
`,
};

const savedEnv = { ...process.env };
beforeEach(() => {
  Reflect.set(globalThis, '__bundlerCalls', []);
  Reflect.deleteProperty(globalThis, '__failBuild');
  delete process.env.NODE_ENV;
  delete process.env.RSPACK_UNSAFE_FAST_DROP;
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('entryOf', () => {
  it.each([
    [{ exports: './a.js' }, './a.js'],
    [{ exports: { '.': './b.js' } }, './b.js'],
    [{ exports: { '.': { types: './t.d.ts', import: './c.js', require: './c.cjs' } } }, './c.js'],
    [{ exports: { '.': { import: { types: './t.d.ts', default: './d.js' } } } }, './d.js'],
    [{ exports: { '.': { node: './e.js', default: './f.js' } } }, './e.js'],
    [{ exports: { '.': ['./g.js'] } }, './g.js'],
    [{ exports: { '.': { types: './t.d.ts' } }, module: './h.js', main: './h.cjs' }, './h.js'],
    [{ main: './i.js' }, './i.js'],
    [{}, 'index.js'],
  ])('reads %j as %s', (pkg, entry) => {
    expect(entryOf(pkg)).toBe(entry);
  });

  it('skips a list with nothing usable and a condition that is not a path', () => {
    expect(entryOf({ exports: { '.': [{ types: './t.d.ts' }, 3] }, main: './m.js' })).toBe(
      './m.js',
    );
    expect(entryOf({ exports: { '.': { import: 5, default: './z.js' } } })).toBe('./z.js');
  });
});

describe('configOf', () => {
  it('takes the bundler mfeflow.json names when its config file is there', async () => {
    const target = await app('rsbuild', { configs: ['rsbuild.config.ts', 'vite.config.ts'] });
    expect(await configOf(target)).toEqual({
      bundler: 'rsbuild',
      configFile: path.join(target.dir, 'rsbuild.config.ts'),
    });
  });

  it.each(['mts', 'js', 'mjs', 'cjs'])('finds a .%s config file', async (extension) => {
    const target = await app('vite', { configs: [`vite.config.${extension}`] });
    expect((await configOf(target)).configFile).toBe(
      path.join(target.dir, `vite.config.${extension}`),
    );
  });

  it('refuses an app that has only the other bundler config, with E309', async () => {
    const target = await app('rsbuild', { configs: ['vite.config.ts'] });
    const mismatch = await refusal(configOf(target));
    expect(mismatch.code).toBe('MFEFLOW_E309');
    expect(mismatch.message).toContain('mfeflow.json says rsbuild, but the app has vite.config.ts');
    const other = await app('vite', { configs: ['rsbuild.config.ts'] });
    await expect(configOf(other)).rejects.toThrow(
      'mfeflow.json says vite, but the app has rsbuild.config.ts',
    );
  });

  it('refuses an app with no config file at all, with E309', async () => {
    const target = await app('vite');
    const none = await refusal(configOf(target));
    expect(none.code).toBe('MFEFLOW_E309');
    expect(none.message).toContain('no vite.config.ts');
  });
});

describe('resolveFromApp', () => {
  it('finds the package the app installed, as the ESM file its exports name', async () => {
    const target = await app('rsbuild', { packages: { '@rsbuild/core': fakeRsbuild } });
    expect(await resolveFromApp(target, '@rsbuild/core')).toBe(
      await fs.realpath(path.join(target.dir, 'node_modules/@rsbuild/core/index.js')),
    );
    const vite = await app('vite', { packages: { vite: fakeVite } });
    expect(await resolveFromApp(vite, 'vite')).toBe(
      await fs.realpath(path.join(vite.dir, 'node_modules/vite/index.js')),
    );
  });

  it('throws E308 naming the package and the app when it is not installed', async () => {
    // Node also looks in ~/node_modules, so the name here is one no machine has.
    const target = await app('rsbuild');
    const missing = await refusal(resolveFromApp(target, '@mfeflow-test/no-such-bundler'));
    expect(missing.code).toBe('MFEFLOW_E308');
    expect(missing.message).toContain('@mfeflow-test/no-such-bundler is not installed for x');
  });

  it('does not turn another resolution error into E308', async () => {
    const target = await app('vite', {
      packages: {
        vite: {
          'package.json': JSON.stringify({ name: 'vite', exports: { './other': './o.js' } }),
        },
      },
    });
    await expect(resolveFromApp(target, 'vite')).rejects.toMatchObject({
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    });
  });
});

describe('checkBundler', () => {
  it('passes when the config is there and the package is installed, without loading it', async () => {
    const target = await app('rsbuild', {
      configs: ['rsbuild.config.ts'],
      packages: { '@rsbuild/core': fakeRsbuild },
    });
    await expect(checkBundler(target)).resolves.toBeUndefined();
    expect(calls()).toEqual([]);
  });

  it('throws E309 for a missing config', async () => {
    await expect(checkBundler(await app('rsbuild'))).rejects.toMatchObject({
      code: 'MFEFLOW_E309',
    });
  });

  it('is what the real host checks with', () => {
    expect(realBundlerHost()).toEqual({ check: checkBundler, load: loadBundler });
  });
});

describe('loadBundler with Rsbuild', () => {
  it('loads the config for a build, creates Rsbuild from the app folder with .env files on, builds and closes', async () => {
    const target = await app('rsbuild', {
      configs: ['rsbuild.config.ts'],
      packages: { '@rsbuild/core': fakeRsbuild },
    });
    const adapter = await loadBundler(target);
    expect(adapter.bundler).toBe('rsbuild');
    await adapter.build(target);
    expect(calls()).toEqual([
      ['loadConfig', { cwd: target.dir, command: 'build' }, 'production', 'true'],
      ['createRsbuild', { cwd: target.dir, rsbuildConfig: { marker: 1 }, loadEnv: true }],
      ['close'],
    ]);
  });

  it('keeps a NODE_ENV the user set', async () => {
    process.env.NODE_ENV = 'staging';
    const target = await app('rsbuild', {
      configs: ['rsbuild.config.ts'],
      packages: { '@rsbuild/core': fakeRsbuild },
    });
    await (await loadBundler(target)).build(target);
    expect(calls()[0]).toEqual(['loadConfig', expect.anything(), 'staging', 'true']);
  });

  it('does not print Rsbuild`s own build error twice, but prints any other', async () => {
    const target = await app('rsbuild', {
      configs: ['rsbuild.config.ts'],
      packages: { '@rsbuild/core': fakeRsbuild },
    });
    const adapter = await loadBundler(target);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Reflect.set(globalThis, '__failBuild', 'Rspack build failed.');
    await expect(adapter.build(target)).rejects.toThrow('Rspack build failed.');
    expect(log).not.toHaveBeenCalled();
    Reflect.set(globalThis, '__failBuild', 'config is broken');
    await expect(adapter.build(target)).rejects.toThrow('config is broken');
    expect(log).toHaveBeenCalledWith('config is broken');
  });

  it('refuses a package that is not Rsbuild 2', async () => {
    const target = await app('rsbuild', {
      configs: ['rsbuild.config.ts'],
      packages: {
        '@rsbuild/core': {
          'package.json': JSON.stringify({
            name: '@rsbuild/core',
            type: 'module',
            main: 'index.js',
          }),
          'index.js': 'export const x = 1;',
        },
      },
    });
    await expect(loadBundler(target)).rejects.toThrow('needs Rsbuild 2 or later');
  });

  it('throws E309 on the wrong config', async () => {
    await expect(
      loadBundler(
        await app('rsbuild', {
          configs: ['vite.config.ts'],
          packages: { '@rsbuild/core': fakeRsbuild },
        }),
      ),
    ).rejects.toMatchObject({ code: 'MFEFLOW_E309' });
  });
});

describe('loadBundler with Vite', () => {
  it('builds with the app folder as root and the config file it found', async () => {
    const target = await app('vite', { configs: ['vite.config.ts'], packages: { vite: fakeVite } });
    const adapter = await loadBundler(target);
    expect(adapter.bundler).toBe('vite');
    await adapter.build(target);
    expect(calls()).toEqual([
      [
        'vite.build',
        { root: target.dir, configFile: path.join(target.dir, 'vite.config.ts') },
        'production',
      ],
    ]);
  });

  it('prints the error and rethrows when the build fails', async () => {
    const target = await app('vite', { configs: ['vite.config.ts'], packages: { vite: fakeVite } });
    const adapter = await loadBundler(target);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Reflect.set(globalThis, '__failBuild', 'bad import');
    await expect(adapter.build(target)).rejects.toThrow('bad import');
    expect(String(log.mock.calls[0]?.[0])).toContain('bad import');
  });

  it('prints a thrown value that is not an Error as text', async () => {
    const target = await app('vite', {
      configs: ['vite.config.ts'],
      packages: {
        vite: {
          'package.json': fakeVite['package.json'],
          'index.js': 'export async function build() { throw "plain text"; }',
        },
      },
    });
    const adapter = await loadBundler(target);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(adapter.build(target)).rejects.toBe('plain text');
    expect(log).toHaveBeenCalledWith('plain text');
  });

  it('refuses a package with no build function', async () => {
    const target = await app('vite', {
      configs: ['vite.config.ts'],
      packages: {
        vite: {
          'package.json': JSON.stringify({ name: 'vite', type: 'module', main: 'index.js' }),
          'index.js': 'export const x = 1;',
        },
      },
    });
    await expect(loadBundler(target)).rejects.toThrow('has no build function');
  });
});

describe('dev and preview', () => {
  it('are not built yet and say which phase builds them', async () => {
    const target = await app('vite', { configs: ['vite.config.ts'], packages: { vite: fakeVite } });
    const adapter = await loadBundler(target);
    await expect(adapter.dev(target, {})).rejects.toThrow('Phase 25.2');
    await expect(adapter.preview(target, { port: 1 })).rejects.toThrow('Phase 25.2');
  });
});

describe('BUNDLER_PACKAGES', () => {
  it('names the package each bundler installs as', () => {
    expect(BUNDLER_PACKAGES).toEqual({ rsbuild: '@rsbuild/core', vite: 'vite' });
  });
});
