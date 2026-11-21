import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Bundler } from '@mfeflow/contracts';
import { MfeflowError, messageOf } from '@mfeflow/core';

/** The app a bundler works on: its folder, and the bundler `mfeflow.json` names for the project. */
export interface BundlerApp {
  name: string;
  dir: string;
  bundler: Bundler;
}

export interface ServeOptions {
  port?: number;
}

export interface ServerHandle {
  url: string;
  close(): Promise<void>;
}

/** What `mfeflow dev`, `build` and `preview` need from Rsbuild or Vite, whichever the app installed. */
export interface BundlerAdapter {
  readonly bundler: Bundler;
  /** Builds the app for production. Resolves when the output is written; rejects when the bundler reports errors. */
  build(app: BundlerApp): Promise<void>;
  /** Not implemented yet (Phase 25.2). */
  dev(app: BundlerApp, options: ServeOptions): Promise<ServerHandle>;
  /** Not implemented yet (Phase 25.2). */
  preview(app: BundlerApp, options: ServeOptions): Promise<ServerHandle>;
}

export type LoadBundler = (app: BundlerApp) => Promise<BundlerAdapter>;

/** The package each bundler is installed as. */
export const BUNDLER_PACKAGES: Record<Bundler, string> = {
  rsbuild: '@rsbuild/core',
  vite: 'vite',
};

const EXTENSIONS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];

interface RsbuildModule {
  loadConfig(options: { cwd: string; path: string; command: string }): Promise<unknown>;
  createRsbuild(options: {
    cwd: string;
    config: () => Promise<unknown>;
    loadEnv: boolean;
  }): Promise<{ build(): Promise<{ close(): Promise<void> }> }>;
}

interface ViteModule {
  build(options: { root: string; configFile: string }): Promise<unknown>;
}

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null;

/** Rsbuild reports its own errors, then rejects with this message. */
const RSPACK_BUILD_ERROR = 'Rspack build failed.';

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function findConfig(dir: string, bundler: Bundler): Promise<string | undefined> {
  const stem = bundler === 'rsbuild' ? 'rsbuild.config' : 'vite.config';
  for (const extension of EXTENSIONS) {
    const file = path.join(dir, `${stem}.${extension}`);
    // oxlint-disable-next-line no-await-in-loop -- stops at the first one that exists
    if (await exists(file)) return file;
  }
  return undefined;
}

const configName = (bundler: Bundler): string =>
  bundler === 'rsbuild' ? 'rsbuild.config.ts' : 'vite.config.ts';

/**
 * The bundler of an app: the one `mfeflow.json` names, checked against the config file the app has.
 * An app that has only the other bundler's config is a mismatch, not a guess.
 */
export async function configOf(app: BundlerApp): Promise<{ bundler: Bundler; configFile: string }> {
  const declared = await findConfig(app.dir, app.bundler);
  if (declared !== undefined) return { bundler: app.bundler, configFile: declared };
  const other: Bundler = app.bundler === 'rsbuild' ? 'vite' : 'rsbuild';
  const found = await findConfig(app.dir, other);
  throw new MfeflowError(
    'E309',
    found === undefined
      ? `${app.name}: no ${configName(app.bundler)} in ${app.dir}`
      : `${app.name}: mfeflow.json says ${app.bundler}, but the app has ${path.basename(found)}`,
  );
}

function pick(node: unknown): string | undefined {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const item of node as unknown[]) {
      const found = pick(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isDict(node)) return undefined;
  for (const condition of ['import', 'node', 'default']) {
    const found = pick(node[condition]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The ESM entry of a package: its `exports["."]` by the `import`, `node` and `default` conditions, else `module` and `main`. */
export function entryOf(pkg: Dict): string {
  const exported = isDict(pkg.exports) && '.' in pkg.exports ? pkg.exports['.'] : pkg.exports;
  const fromExports = pick(exported);
  if (fromExports !== undefined) return fromExports;
  for (const field of [pkg.module, pkg.main]) if (typeof field === 'string') return field;
  return 'index.js';
}

const NOT_FOUND = new Set(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND']);

/** The absolute path of the package's ESM entry as the app sees it, never the CLI's own copy. */
export async function resolveFromApp(app: BundlerApp, name: string): Promise<string> {
  let manifest: string;
  try {
    manifest = createRequire(path.join(app.dir, 'package.json')).resolve(`${name}/package.json`);
  } catch (error) {
    if (isDict(error) && typeof error.code === 'string' && NOT_FOUND.has(error.code)) {
      throw new MfeflowError(
        'E308',
        `${name} is not installed for ${app.name} (looked from ${app.dir})`,
        { cause: error },
      );
    }
    throw new MfeflowError(
      'E308',
      `${name} could not be resolved for ${app.name}: ${messageOf(error)}`,
      { cause: error },
    );
  }
  const pkg: unknown = JSON.parse(await fs.readFile(manifest, 'utf8'));
  return path.resolve(path.dirname(manifest), entryOf(isDict(pkg) ? pkg : {}));
}

async function importFrom(file: string): Promise<Dict> {
  const loaded: unknown = await import(pathToFileURL(file).href);
  if (!isDict(loaded)) throw new Error(`${file} did not export a module`);
  return loaded;
}

const isRsbuild = (mod: Dict): mod is Dict & RsbuildModule =>
  typeof mod.loadConfig === 'function' && typeof mod.createRsbuild === 'function';

const isVite = (mod: Dict): mod is Dict & ViteModule => typeof mod.build === 'function';

function asRsbuild(mod: Dict, name: string): RsbuildModule {
  if (!isRsbuild(mod)) {
    throw new Error(
      `${name} has no loadConfig and createRsbuild; mfeflow needs Rsbuild 2 or later`,
    );
  }
  return mod;
}

function asVite(mod: Dict, name: string): ViteModule {
  if (!isVite(mod)) throw new Error(`${name} has no build function`);
  return mod;
}

function notYet(command: string): Promise<never> {
  return Promise.reject(
    new Error(`${command} through the bundler API is not built yet (Phase 25.2)`),
  );
}

/** What `rsbuild build` and `vite build` set before their config loads, so a config sees the same environment. */
function productionEnv(): void {
  process.env.NODE_ENV ||= 'production';
}

function adapter(bundler: Bundler, build: BundlerAdapter['build']): BundlerAdapter {
  return {
    bundler,
    build,
    dev: () => notYet('dev'),
    preview: () => notYet('preview'),
  };
}

/** Looks up the app's bundler and its config file without loading it. Throws E308 or E309. */
export async function checkBundler(app: BundlerApp): Promise<void> {
  const { bundler } = await configOf(app);
  await resolveFromApp(app, BUNDLER_PACKAGES[bundler]);
}

/** What a command needs to prepare and run an app's bundler. Tests replace it. */
export interface BundlerHost {
  check(app: BundlerApp): Promise<void>;
  load: LoadBundler;
}

export const realBundlerHost = (): BundlerHost => ({ check: checkBundler, load: loadBundler });

/** Resolves the app's own Rsbuild or Vite and returns an adapter that drives it. Throws E308 or E309. */
export async function loadBundler(app: BundlerApp): Promise<BundlerAdapter> {
  const { bundler, configFile } = await configOf(app);
  const name = BUNDLER_PACKAGES[bundler];
  const entry = await resolveFromApp(app, name);
  const loaded = await importFrom(entry);
  if (bundler === 'rsbuild') {
    const rsbuild = asRsbuild(loaded, name);
    return adapter(bundler, async (target) => {
      productionEnv();
      process.env.RSPACK_UNSAFE_FAST_DROP ||= 'true';
      try {
        // As `rsbuild build` does: Rsbuild loads the .env files, then calls this, so the config sees them.
        const instance = await rsbuild.createRsbuild({
          cwd: target.dir,
          config: () => rsbuild.loadConfig({ cwd: target.dir, path: configFile, command: 'build' }),
          loadEnv: true,
        });
        const result = await instance.build();
        await result.close();
      } catch (error) {
        if (messageOf(error) !== RSPACK_BUILD_ERROR) console.error(messageOf(error));
        throw error;
      }
    });
  }
  const vite = asVite(loaded, name);
  return adapter(bundler, async (target) => {
    productionEnv();
    try {
      await vite.build({ root: target.dir, configFile });
    } catch (error) {
      console.error(error instanceof Error && error.stack ? error.stack : messageOf(error));
      throw error;
    }
  });
}
