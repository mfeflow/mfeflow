// Shared by the rollback e2e and bench/rollback-visible.ts (Node runs both; no imports of siblings).
// Builds a throwaway mfeflow project, fills it with the storefront's real remote builds and drives the
// real `mfeflow deploy` / `rollback` commands against a `file:` host that serve.ts serves.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../../..');
const storefront = path.join(repo, 'examples/storefront');
const cli = path.join(repo, 'packages/cli/bin/mfeflow.js');

/** Where the rollback test server reads its registry from, and where the e2e deploys to. */
export const ROLLBACK_HOST = path.join(os.tmpdir(), 'mfeflow-rollback-host');
export const ROLLBACK_PORT = 4330;
export const HEADING_V1 = 'Catalog';
export const HEADING_V2 = 'Catalog (v2)';
const REMOTES = ['catalog', 'cart'] as const;

export interface Cli {
  code: number;
  stdout: string;
  stderr: string;
}

/** The parent's environment without anything git sets, so no command here can reach a real repository. */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, ...extra };
}

/** Runs the built `mfeflow` in `cwd` with a clean environment. */
export function mfeflow(cwd: string, args: string[]): Cli {
  const out = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: cleanEnv(),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: out.status ?? -1, stdout: out.stdout, stderr: out.stderr };
}

function copyDir(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true });
}

/** The built file that holds the catalog's English messages, found by content (its name is hashed). */
function messagesChunk(dist: string): string {
  const stack = [dist];
  for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (
        entry.name.endsWith('.js') &&
        fs.readFileSync(file, 'utf8').includes(`"heading":"${HEADING_V1}"`)
      )
        return file;
    }
  }
  throw new Error(`no file under ${dist} holds the catalog heading (is the catalog built?)`);
}

export interface Rig {
  /** The mfeflow project the commands run in. */
  project: string;
  /** The folder serve.ts serves with SERVE_REGISTRY_DIR. */
  host: string;
  /** Empties the host, as if nothing had ever been deployed. */
  resetHost(): void;
  /** `mfeflow deploy <remote> --env prod`. v2 of the catalog is the v1 build with a visibly different heading. */
  deploy(remote: (typeof REMOTES)[number], version: string, build?: 'v1' | 'v2'): Cli;
  /** `mfeflow rollback <remote> --env prod`: back to the version before the current one. */
  rollback(remote: (typeof REMOTES)[number]): Cli;
  cleanup(): void;
}

/**
 * `baseUrl` is where the host folder is reachable from the browser (the test server's `/reg`); `host` is that folder.
 * Needs the storefront remotes built and the CLI built (`pnpm build`).
 */
export function createRig(baseUrl: string, host = ROLLBACK_HOST): Rig {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-rollback-'));
  fs.mkdirSync(host, { recursive: true });
  const init = mfeflow(parent, ['init', 'app', '--yes', '--no-install', '--cwd', parent]);
  if (init.code !== 0) throw new Error(`mfeflow init failed:\n${init.stdout}\n${init.stderr}`);
  const project = path.join(parent, 'app');
  for (const name of REMOTES) {
    const app = path.join(project, 'apps', name);
    copyDir(path.join(storefront, name, 'dist'), path.join(app, 'dist-v1'));
  }
  const catalog = path.join(project, 'apps', 'catalog');
  copyDir(path.join(catalog, 'dist-v1'), path.join(catalog, 'dist-v2'));
  const chunk = messagesChunk(path.join(catalog, 'dist-v2'));
  fs.writeFileSync(
    chunk,
    fs
      .readFileSync(chunk, 'utf8')
      .replace(`"heading":"${HEADING_V1}"`, `"heading":"${HEADING_V2}"`),
  );

  const common = ['--env', 'prod', '--host', `file:${host}`, '--cwd', project, '--yes'];
  return {
    project,
    host,
    resetHost() {
      fs.rmSync(host, { recursive: true, force: true });
      fs.mkdirSync(host, { recursive: true });
    },
    deploy: (remote, version, build = 'v1') =>
      mfeflow(project, [
        'deploy',
        remote,
        '--version',
        version,
        '--dist',
        `dist-${build}`,
        '--base-url',
        baseUrl,
        ...common,
      ]),
    rollback: (remote) => mfeflow(project, ['rollback', remote, ...common]),
    cleanup() {
      fs.rmSync(parent, { recursive: true, force: true });
    },
  };
}
