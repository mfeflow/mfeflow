import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqliteStorage } from './sqlite';
import type { RegistryStorage, TokenRecord } from './storage';
import { allows, createToken, parseActions, sha256Hex, verifyToken } from './tokens';

let storage: RegistryStorage;

beforeEach(async () => {
  storage = await openSqliteStorage(':memory:');
});

afterEach(async () => {
  await storage.close();
});

describe('createToken', () => {
  it('returns the token once and stores only its hash', async () => {
    const made = await createToken(storage, {
      env: 'prod',
      remote: '*',
      actions: ['deploy', 'rollback'],
      label: 'ci',
    });
    expect(made.token).toMatch(/^mfr_[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/);
    const stored = await storage.getToken(made.id);
    expect(stored).toMatchObject({
      id: made.id,
      hash: sha256Hex(made.token),
      label: 'ci',
      env: 'prod',
      remote: '*',
      actions: ['deploy', 'rollback'],
      revokedAt: null,
    });
    expect(JSON.stringify(stored)).not.toContain(made.token.split('.')[1]);
    expect(JSON.stringify(await storage.listTokens())).not.toContain(made.token.split('.')[1]);
  });

  it('makes a different token every time', async () => {
    const a = await createToken(storage, { env: '*', remote: '*', actions: ['read'] });
    const b = await createToken(storage, { env: '*', remote: '*', actions: ['read'] });
    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
  });

  it('refuses bad scopes', async () => {
    await expect(
      createToken(storage, { env: 'Prod', remote: '*', actions: ['read'] }),
    ).rejects.toThrow(/env/);
    await expect(
      createToken(storage, { env: '*', remote: 'a b', actions: ['read'] }),
    ).rejects.toThrow(/remote/);
    await expect(createToken(storage, { env: '*', remote: '*', actions: [] })).rejects.toThrow(
      /at least one action/,
    );
  });
});

describe('verifyToken', () => {
  it('accepts the token, and rejects wrong, malformed and revoked ones', async () => {
    const made = await createToken(storage, { env: '*', remote: '*', actions: ['read'] });
    expect((await verifyToken(storage, made.token))?.id).toBe(made.id);
    expect(await verifyToken(storage, `${made.token}x`)).toBeUndefined();
    expect(await verifyToken(storage, `mfr_${made.id}.${'b'.repeat(43)}`)).toBeUndefined();
    expect(await verifyToken(storage, 'garbage')).toBeUndefined();
    expect(await verifyToken(storage, '')).toBeUndefined();
    expect(await storage.revokeToken(made.id, '2026-11-01T00:00:00.000Z')).toBe(true);
    expect(await storage.revokeToken(made.id, '2026-11-01T00:00:00.000Z')).toBe(false);
    expect(await verifyToken(storage, made.token)).toBeUndefined();
  });
});

describe('allows', () => {
  const token = (patch: Partial<TokenRecord>): TokenRecord => ({
    id: 'a'.repeat(16),
    hash: '',
    label: null,
    env: '*',
    remote: '*',
    actions: ['read'],
    createdAt: '',
    revokedAt: null,
    ...patch,
  });

  it('matches action, env and remote', () => {
    const scoped = token({ env: 'prod', remote: 'cart', actions: ['deploy'] });
    expect(allows(scoped, { action: 'deploy', env: 'prod', remote: 'cart' })).toBe(true);
    expect(allows(scoped, { action: 'kill', env: 'prod', remote: 'cart' })).toBe(false);
    expect(allows(scoped, { action: 'deploy', env: 'staging', remote: 'cart' })).toBe(false);
    expect(allows(scoped, { action: 'deploy', env: 'prod', remote: 'shop' })).toBe(false);
    expect(allows(scoped, { action: 'deploy', env: 'prod' })).toBe(true);
  });

  it('lets * match anything and admin do anything', () => {
    expect(allows(token({ actions: ['kill'] }), { action: 'kill', env: 'x', remote: 'y' })).toBe(
      true,
    );
    expect(
      allows(token({ actions: ['admin'] }), { action: 'rollback', env: 'x', remote: 'y' }),
    ).toBe(true);
    expect(allows(token({ env: 'prod', actions: ['admin'] }), { action: 'read', env: 'dev' })).toBe(
      false,
    );
  });
});

describe('parseActions', () => {
  it('splits, trims and de-duplicates', () => {
    expect(parseActions('deploy, rollback,deploy')).toEqual(['deploy', 'rollback']);
  });

  it('names what is wrong', () => {
    expect(() => parseActions('')).toThrow(/at least one action/);
    expect(() => parseActions('deploy,fly')).toThrow(/unknown action fly/);
  });
});
