import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RegistryIndexRemote } from '@mfeflow/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqliteStorage } from './sqlite';
import {
  RevisionConflictError,
  type EnvChange,
  type RegistryStorage,
  type VersionRecord,
} from './storage';

let dir: string;
let file: string;
const open: RegistryStorage[] = [];

async function connect(): Promise<RegistryStorage> {
  const storage = await openSqliteStorage(file);
  open.push(storage);
  return storage;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-sqlite-'));
  file = path.join(dir, 'r.db');
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
  await fs.rm(dir, { recursive: true, force: true });
});

const remote = (version: string): RegistryIndexRemote => ({
  name: 'cart',
  entry: `https://cdn.example.com/cart/${version}/mf-manifest.json`,
  version,
  routes: ['/cart'],
  owner: 'team-cart',
});

const record = (version: string): VersionRecord => ({
  env: 'prod',
  remote: 'cart',
  version,
  manifestUrl: `https://cdn.example.com/cart/${version}/mf-manifest.json`,
  manifestSha256: 'ab',
  manifest: { name: 'cart' },
  owner: 'team-cart',
  routes: ['/cart'],
  platform: { react: '^19' },
  budgets: { initialJsKb: 8 },
  createdAt: '2026-11-01T00:00:00.000Z',
  createdBy: 'a'.repeat(16),
});

const change = (
  version: string,
  expectedRev: number,
  patch: Partial<EnvChange> = {},
): EnvChange => ({
  env: 'prod',
  expectedRev,
  at: '2026-11-01T00:00:00.000Z',
  versions: [record(version)],
  pointer: { name: 'cart', version, remote: remote(version), killed: false },
  audit: {
    at: '2026-11-01T00:00:00.000Z',
    tokenId: null,
    action: 'deploy',
    env: 'prod',
    remote: 'cart',
    before: null,
    after: version,
    detail: {},
  },
  ...patch,
});

describe('sqlite storage', () => {
  it('migrates once and survives a reopen', async () => {
    const first = await connect();
    await first.commit(change('1.0.0', 0));
    await first.close();
    const again = await connect();
    expect((await again.readEnv('prod'))?.remotes[0]?.version).toBe('1.0.0');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true });
    expect(db.prepare('SELECT id FROM schema_migrations').all()).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    db.close();
  });

  it('round-trips env, pointer, version and audit', async () => {
    const storage = await connect();
    expect(await storage.readEnv('prod')).toBeUndefined();
    await storage.commit(change('1.0.0', 0));
    await storage.commit(
      change('2.0.0', 1, {
        pointer: {
          name: 'cart',
          version: '2.0.0',
          remote: remote('2.0.0'),
          killed: true,
          killReason: 'bad',
        },
      }),
    );
    const state = await storage.readEnv('prod');
    expect(state?.rev).toBe(2);
    expect(state?.remotes[0]).toMatchObject({
      name: 'cart',
      version: '2.0.0',
      killed: true,
      killReason: 'bad',
    });
    expect(await storage.getVersion('prod', 'cart', '1.0.0')).toEqual(record('1.0.0'));
    expect(await storage.getVersion('prod', 'cart', '9.9.9')).toBeUndefined();
    expect(await storage.listEnvs()).toEqual(['prod']);
    const log = await storage.audit({ limit: 10 });
    expect(log.map((e) => e.after)).toEqual(['2.0.0', '1.0.0']);
    expect(await storage.audit({ env: 'dev', limit: 10 })).toEqual([]);
    expect(await storage.audit({ remote: 'cart', limit: 1 })).toHaveLength(1);
    await storage.ping();
  });

  it('keeps a rollout and its counts, and drops both when it ends', async () => {
    const storage = await connect();
    await storage.commit(change('1.0.0', 0));
    const rollout = {
      env: 'prod',
      remote: 'cart',
      id: 'abc123',
      stable: '1.0.0',
      candidate: '2.0.0',
      candidateRemote: remote('2.0.0'),
      percent: 10,
      steps: [50, 100],
      startedAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    await storage.commit(change('1.0.0', 1, { versions: [], rollout: { set: rollout } }));
    expect(await storage.listRollouts('prod')).toEqual([rollout]);
    expect(await storage.listRollouts('dev')).toEqual([]);

    await storage.addRolloutReport('abc123', '2.0.0', 'u1', false);
    await storage.addRolloutReport('abc123', '2.0.0', 'u1', false);
    await storage.addRolloutReport('abc123', '2.0.0', 'u2', true);
    await storage.addRolloutReport('abc123', '2.0.0', 'u2', false);
    await storage.addRolloutReport('abc123', '1.0.0', 'u1', false);
    await storage.addRolloutReport('nope', '2.0.0', 'u1', true);
    expect(await storage.rolloutCounts('abc123')).toEqual({
      '2.0.0': { loads: 2, errors: 1, clients: 2 },
      '1.0.0': { loads: 1, errors: 0, clients: 1 },
    });
    expect(await storage.rolloutCounts('nope')).toEqual({});
    await storage.addRolloutReport('abc123', '2.0.0', 'u1', true);
    expect((await storage.rolloutCounts('abc123'))['2.0.0']).toEqual({
      loads: 2,
      errors: 2,
      clients: 2,
    });

    await storage.commit(
      change('1.0.0', 2, { versions: [], rollout: { set: { ...rollout, percent: 50 } } }),
    );
    expect((await storage.listRollouts('prod'))[0]?.percent).toBe(50);

    await storage.commit(change('1.0.0', 3, { versions: [], rollout: { clear: 'abc123' } }));
    expect(await storage.listRollouts('prod')).toEqual([]);
    expect(await storage.rolloutCounts('abc123')).toEqual({});
    await storage.addRolloutReport('abc123', '2.0.0', 'u9', false);
    expect(await storage.rolloutCounts('abc123')).toEqual({});
  });

  it('refuses a writer that read an older revision, and writes nothing', async () => {
    const a = await connect();
    const b = await connect();
    await a.commit(change('1.0.0', 0));
    await expect(b.commit(change('2.0.0', 0))).rejects.toBeInstanceOf(RevisionConflictError);
    const stale = await b.readEnv('prod');
    expect(stale?.rev).toBe(1);
    expect(stale?.remotes[0]?.version).toBe('1.0.0');
    expect(await b.getVersion('prod', 'cart', '2.0.0')).toBeUndefined();
    expect(await b.audit({ limit: 10 })).toHaveLength(1);
    await b.commit(change('2.0.0', 1));
    expect((await a.readEnv('prod'))?.rev).toBe(2);
  });

  it('turns another process holding the write lock into a conflict', async () => {
    const holder = await connect();
    const impatient = await openSqliteStorage(file, { busyTimeoutMs: 10 });
    open.push(impatient);
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(file);
    raw.exec('BEGIN IMMEDIATE');
    try {
      await expect(impatient.commit(change('1.0.0', 0))).rejects.toBeInstanceOf(
        RevisionConflictError,
      );
    } finally {
      raw.exec('ROLLBACK');
      raw.close();
    }
    await holder.commit(change('1.0.0', 0));
  });

  it('keeps killed pointers in order and tokens revocable', async () => {
    const storage = await connect();
    await storage.commit(change('1.0.0', 0));
    await storage.commit(
      change('1.0.0', 1, {
        versions: [],
        pointer: {
          name: 'shop',
          version: '1.0.0',
          remote: { ...remote('1.0.0'), name: 'shop', routes: ['/shop'] },
          killed: false,
        },
      }),
    );
    expect((await storage.readEnv('prod'))?.remotes.map((r) => r.name)).toEqual(['cart', 'shop']);
    await storage.addToken({
      id: 'f'.repeat(16),
      hash: 'cd'.repeat(32),
      label: null,
      env: '*',
      remote: '*',
      actions: ['read', 'nonsense' as never],
      createdAt: '2026-11-01T00:00:00.000Z',
      revokedAt: null,
    });
    expect((await storage.getToken('f'.repeat(16)))?.actions).toEqual(['read']);
    expect(await storage.getToken('0'.repeat(16))).toBeUndefined();
    expect(await storage.revokeToken('0'.repeat(16), 'now')).toBe(false);
  });

  it('refuses a stored remote that is no longer valid rather than serving it', async () => {
    const storage = await connect();
    await storage.commit(change('1.0.0', 0));
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(file);
    raw.exec(`UPDATE pointers SET remote_json = '{"name":"x"}'`);
    raw.close();
    await expect(storage.readEnv('prod')).rejects.toThrow(/not valid/);
  });
});
