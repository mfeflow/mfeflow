import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RegistryIndex, RegistryIndexRemote } from '@mfeflow/contracts';
import { expect } from 'vitest';
import { main } from './cli';
import { validateResult, type DeployResult, type FailureResult, type StatusResult } from './output';
import { fakeIo, readTree, removeDir, tempDir, testRuntime, type TestRuntime } from './testing';

export const BASE_URL = 'https://cdn.test';

interface Ran<T> {
  code: number;
  result: T;
  rt: TestRuntime;
}

export interface Fixture {
  root: string;
  site: string;
  cleanup(): Promise<void>;
  /** `mfeflow <argv> --json` against this project and host, for the commands that print a deploy result. */
  run(...argv: string[]): Promise<Ran<DeployResult>>;
  /** The same, for a run that must fail with an error document. */
  fail(...argv: string[]): Promise<Ran<FailureResult>>;
  /** `mfeflow status <argv> --json`. */
  status(...argv: string[]): Promise<Ran<StatusResult>>;
  /** What the host serves for `env`, read straight from disk. */
  served(env: string, remote?: string): Promise<RegistryIndexRemote | undefined>;
  hostTree(): Promise<Record<string, string>>;
  localTree(): Promise<Record<string, string>>;
}

/** An object read from JSON text, for tests that poke at it. */
export function parseObject(text: string): Record<string, unknown> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper: callers pass objects
  return JSON.parse(text) as Record<string, unknown>;
}

export async function readObject(file: string): Promise<Record<string, unknown>> {
  return parseObject(await fs.readFile(file, 'utf8'));
}

export function failureOf(text: string): FailureResult {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper: callers pass an error document
  return JSON.parse(text) as FailureResult;
}

export function statusOf(text: string): StatusResult {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper: callers pass a status document
  return JSON.parse(text) as StatusResult;
}

export function deployOf(text: string): DeployResult {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper: callers pass a deploy document
  return JSON.parse(text) as DeployResult;
}

/** Writes a remote's build: a manifest, an entry and one expose, with content that differs by `marker`. */
export async function buildRemote(
  root: string,
  name: string,
  version: string,
  options: { marker?: string; entryBytes?: number; reactRange?: string } = {},
): Promise<void> {
  const app = path.join(root, 'apps', name);
  const dist = path.join(app, 'dist');
  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(path.join(dist, 'static/js'), { recursive: true });
  const manifest = {
    name,
    metaData: {
      name,
      globalName: name,
      publicPath: 'auto',
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'global' },
    },
    exposes: [{ path: './App', assets: { js: { sync: ['static/js/App.js'] }, css: { sync: [] } } }],
    shared: [
      {
        name: 'react',
        version: '19.0.0',
        singleton: true,
        requiredVersion: options.reactRange ?? '^19.0.0',
      },
    ],
  };
  await fs.writeFile(path.join(dist, 'mf-manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(dist, 'remoteEntry.js'), randomBytes(options.entryBytes ?? 1500));
  await fs.writeFile(
    path.join(dist, 'static/js/App.js'),
    `${options.marker ?? version}-${randomBytes(800).toString('hex')}`,
  );
  const pkgFile = path.join(app, 'package.json');
  const pkg = await readObject(pkgFile);
  await fs.writeFile(pkgFile, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
}

export async function fixture(
  options: { env?: Record<string, string>; configure?: boolean } = {},
): Promise<Fixture> {
  const parent = await tempDir();
  const site = await tempDir('mfeflow-site-');
  await main(['init', 'app', '--yes', '--no-install', '--cwd', parent], testRuntime());
  const root = path.join(parent, 'app');
  const flags = ['--host', `file:${site}`];

  async function exec(argv: string[]): Promise<{ code: number; text: string; rt: TestRuntime }> {
    const rt = testRuntime();
    rt.io = fakeIo({ env: options.env ?? {} });
    const writes = argv[0] !== 'status';
    const given =
      options.configure === true
        ? argv
        : [...argv, ...flags, ...(writes ? ['--base-url', BASE_URL] : [])];
    const code = await main([...given, '--json', '--cwd', root], rt);
    const text = rt.io.out.join('');
    expect(validateResult(JSON.parse(text)), text).toEqual([]);
    return { code, text, rt };
  }

  const served = async (env: string, remote = 'catalog') => {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the CLI wrote it
      const index = (await readObject(
        path.join(site, 'envs', env, 'index.json'),
      )) as unknown as RegistryIndex;
      return index.remotes.find((r) => r.name === remote);
    } catch {
      return undefined;
    }
  };

  return {
    root,
    site,
    run: async (...argv) => {
      const { code, text, rt } = await exec(argv);
      return { code, result: deployOf(text), rt };
    },
    fail: async (...argv) => {
      const { code, text, rt } = await exec(argv);
      return { code, result: failureOf(text), rt };
    },
    status: async (...argv) => {
      const { code, text, rt } = await exec(['status', ...argv]);
      return { code, result: statusOf(text), rt };
    },
    served,
    hostTree: () => readTree(site),
    localTree: async () => {
      const tree = await readTree(root);
      return Object.fromEntries(
        Object.entries(tree).filter(([file]) => file.startsWith('registry/envs/')),
      );
    },
    cleanup: async () => {
      await removeDir(path.dirname(root));
      await removeDir(site);
    },
  };
}
