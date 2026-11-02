import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '.';
import { testRuntime } from './testing';

const cleanEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).flatMap(([k, v]) =>
      v === undefined || k.startsWith('GIT_') ? [] : [[k, v]],
    ),
  );

function run(cmd: string, args: string[], cwd: string): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, { cwd, env: cleanEnv(), encoding: 'utf8' });
}

const dockerUp =
  process.env.MFEFLOW_DOCKER_TEST === '1' &&
  spawnSync('docker', ['info'], { stdio: 'ignore', env: cleanEnv() }).status === 0;

// Opt in with MFEFLOW_DOCKER_TEST=1 and a running daemon (ubuntu CI, or a laptop): generates a
// project, installs it for real (network), builds a shell and a remote image and checks what they serve.
describe.skipIf(!dockerUp)('the generated images, built and run with Docker', () => {
  const tag = `mfeflow-dd-test-${String(process.pid)}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-dd-'));
  const app = path.join(work, 'app');
  const names = [`${tag}-shell-c`, `${tag}-remote-c`];

  afterAll(() => {
    for (const name of names) run('docker', ['rm', '-f', name], work);
    for (const kind of ['shell', 'catalog']) run('docker', ['rmi', '-f', `${tag}-${kind}`], work);
    fs.rmSync(work, { recursive: true, force: true });
  });

  const port = (name: string): string =>
    /:(\d+)\s*$/m.exec(run('docker', ['port', name, '8080/tcp'], work).stdout)?.[1] ?? '';

  it(
    'serve the cache rules, CORS and the picked runtime config as a non-root user',
    { timeout: 900_000 },
    async () => {
      expect(
        await main(['init', 'app', '--yes', '--no-install', '--cwd', work], testRuntime()),
      ).toBe(0);
      expect(
        await main(['add', 'deploy-docker', '--no-install', '--cwd', app], testRuntime()),
      ).toBe(0);
      const installed = run('pnpm', ['install'], app);
      expect(installed.status, installed.stderr).toBe(0);
      for (const kind of ['shell', 'catalog']) {
        const built = run(
          'docker',
          [
            'build',
            '-f',
            'docker/Dockerfile',
            '--build-arg',
            `APP=${kind}`,
            '-t',
            `${tag}-${kind}`,
            '.',
          ],
          app,
        );
        expect(built.status, built.stderr).toBe(0);
      }
      const base = ['run', '-d', '--read-only', '--tmpfs', '/tmp', '-p', '127.0.0.1::8080'];
      const shell = run(
        'docker',
        [...base, '--name', names[0] ?? '', '-e', 'MFE_ENV=staging', `${tag}-shell`],
        work,
      );
      const remote = run(
        'docker',
        [
          ...base,
          '--name',
          names[1] ?? '',
          '-e',
          'SHELL_ORIGINS=http://localhost:4300',
          `${tag}-catalog`,
        ],
        work,
      );
      expect(shell.status, shell.stderr).toBe(0);
      expect(remote.status, remote.stderr).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const uid = run('docker', ['exec', names[0] ?? '', 'id', '-u'], work).stdout.trim();
      expect(uid).toBe('101');

      const shellUrl = `http://127.0.0.1:${port(names[0] ?? '')}`;
      const index = await fetch(`${shellUrl}/catalog/anything`);
      expect(index.status).toBe(200);
      expect(index.headers.get('cache-control')).toBe('no-cache');
      const config = await fetch(`${shellUrl}/config/runtime-config.json`);
      expect(config.headers.get('cache-control')).toBe('no-cache');
      expect(await config.json()).toEqual({ environment: 'staging' });
      expect((await fetch(`${shellUrl}/config/runtime-config.prod.json`)).status).toBe(404);
      const missing = await fetch(`${shellUrl}/static/js/nope.js`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get('cache-control')).toBeNull();

      const remoteUrl = `http://127.0.0.1:${port(names[1] ?? '')}`;
      const manifest = await fetch(`${remoteUrl}/mf-manifest.json`, {
        headers: { Origin: 'http://localhost:4300' },
      });
      expect(manifest.status).toBe(200);
      expect(manifest.headers.get('cache-control')).toBe('no-cache');
      expect(manifest.headers.get('access-control-allow-origin')).toBe('http://localhost:4300');
      const other = await fetch(`${remoteUrl}/mf-manifest.json`, {
        headers: { Origin: 'https://evil.example' },
      });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
      const versioned = await fetch(`${remoteUrl}/mfe/catalog/0.0.0/mf-manifest.json`);
      expect(versioned.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect((await fetch(`${remoteUrl}/mfe/catalog/9.9.9/mf-manifest.json`)).status).toBe(404);
    },
  );

  it(
    'a shell with an unknown MFE_ENV exits 1 and says which files exist',
    { timeout: 60_000 },
    () => {
      const result = run(
        'docker',
        ['run', '--rm', '--read-only', '--tmpfs', '/tmp', '-e', 'MFE_ENV=nope', `${tag}-shell`],
        work,
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('no runtime config for MFE_ENV=nope');
      expect(result.stderr).toContain('runtime-config.prod.json');
    },
  );
});
