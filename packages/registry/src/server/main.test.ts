import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from './main';
import { openSqliteStorage } from './sqlite';
import { sha256Hex } from './tokens';

let dir: string;
let env: Record<string, string>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-main-'));
  env = { MFEFLOW_REGISTRY_DB: path.join(dir, 'r.db'), MFEFLOW_REGISTRY_PORT: '0' };
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
  };
}

describe('main token', () => {
  it('prints the token once on stdout, stores only its hash, and audits the creation', async () => {
    const run = io();
    const code = await main(
      [
        'server',
        'token',
        'create',
        '--env',
        'prod',
        '--remote',
        '*',
        '--actions',
        'deploy,rollback',
        '--label=ci',
      ],
      env,
      run.io,
    );
    expect(code).toBe(0);
    expect(run.out).toHaveLength(1);
    const token = run.out[0]?.trim() ?? '';
    expect(token).toMatch(/^mfr_[0-9a-f]{16}\./);
    expect(run.err.join('')).toContain('only time it is shown');
    expect(run.err.join('')).not.toContain(token);

    const storage = await openSqliteStorage(env.MFEFLOW_REGISTRY_DB ?? '');
    const [stored] = await storage.listTokens();
    expect(stored).toMatchObject({ hash: sha256Hex(token), env: 'prod', remote: '*', label: 'ci' });
    expect(stored?.actions).toEqual(['deploy', 'rollback']);
    const [entry] = await storage.audit({ limit: 5 });
    expect(entry).toMatchObject({ action: 'token.create', tokenId: null });
    expect(JSON.stringify(entry)).not.toContain(token.split('.')[1]);
    await storage.close();
  });

  it('lists tokens without secrets and revokes by id', async () => {
    const created = io();
    await main(
      ['token', 'create', '--env', '*', '--remote', '*', '--actions', 'read'],
      env,
      created.io,
    );
    const token = created.out[0]?.trim() ?? '';
    const id = token.slice(4, 20);

    const listed = io();
    expect(await main(['token', 'list'], env, listed.io)).toBe(0);
    expect(listed.out.join('')).toContain(id);
    expect(listed.out.join('')).not.toContain(token.split('.')[1]);

    const revoked = io();
    expect(await main(['token', 'revoke', id], env, revoked.io)).toBe(0);
    expect(revoked.out.join('')).toContain(`Revoked ${id}`);
    const again = io();
    expect(await main(['token', 'revoke', id], env, again.io)).toBe(1);
    const relisted = io();
    await main(['token', 'list'], env, relisted.io);
    expect(relisted.out.join('')).toContain('REVOKED');
  });

  it('explains bad input', async () => {
    const run = io();
    expect(await main(['token', 'create', '--env', 'prod'], env, run.io)).toBe(1);
    expect(run.err.join('')).toContain('error:');
    const bad = io();
    expect(await main(['token', 'create', '--env'], env, bad.io)).toBe(1);
    expect(bad.err.join('')).toContain('--env needs a value');
    const none = io();
    expect(await main(['token', 'revoke'], env, none.io)).toBe(1);
    const unknown = io();
    expect(await main(['token', 'frobnicate'], env, unknown.io)).toBe(1);
    expect(unknown.err.join('')).toContain('usage:');
  });
});

describe('main', () => {
  it('prints usage for an unknown command', async () => {
    const run = io();
    expect(await main(['launch'], env, run.io)).toBe(2);
    expect(run.err.join('')).toContain('server serve');
  });

  it('reports bad settings with every problem and no stack', async () => {
    const run = io();
    expect(await main(['serve'], { ...env, MFEFLOW_REGISTRY_PORT: 'x' }, run.io)).toBe(1);
    expect(run.err.join('')).toContain('invalid registry server settings');
    expect(run.err.join('')).not.toContain('error:');
  });

  it('serves until stopped', async () => {
    const run = io();
    let stop: (() => Promise<void>) | undefined;
    const done = main(['serve'], env, run.io, (s) => {
      stop = s;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stop).toBeDefined();
    await stop?.();
    expect(await done).toBe(0);
  });
});
