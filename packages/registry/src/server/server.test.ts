import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { isRegistryIndex, type RegistryIndex } from '@mfeflow/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactPrefix, buildIndex } from '../static';
import { filesFor, manifestFor, mfe } from '../static/fixtures/remote';
import {
  BASE_URL,
  memoryHost,
  seedShell,
  seedVersion,
  startHarness,
  type Harness,
} from './fixtures/harness';
import { startRegistryServer } from './server';
import { openSqliteStorage } from './sqlite';
import { sha256Hex } from './tokens';

let h: Harness;
let admin: string;

beforeEach(async () => {
  h = await startHarness();
  admin = await h.admin();
  seedShell(h.artifacts, 'prod');
  seedShell(h.artifacts, 'staging');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await h.stop();
});

const parseIndex = (text: string | undefined): RegistryIndex => {
  const parsed: unknown = JSON.parse(text ?? '{}');
  if (!isRegistryIndex(parsed)) throw new Error('not an index');
  return parsed;
};

const prodIndex = async (): Promise<RegistryIndex> => {
  const { env, generatedAt, remotes } = (await h.call('GET', '/v1/index/prod')).body;
  return { env, generatedAt, remotes };
};

describe('GET /healthz', () => {
  it('answers ok and refuses other methods', async () => {
    const ok = await h.call('GET', '/healthz');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    const wrong = await h.call('POST', '/healthz');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET');
  });
});

describe('GET /v1/index/:env', () => {
  it('needs no token, is private for 5 seconds, and is never CDN-cacheable', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    const res = await h.call('GET', '/v1/index/prod?u=client-42');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=5');
    expect(res.body.env).toBe('prod');
    expect(res.body.remotes).toHaveLength(1);
  });

  it('404s an env that was never deployed and 400s a bad env or client id', async () => {
    expect((await h.call('GET', '/v1/index/nowhere')).status).toBe(404);
    expect((await h.call('GET', '/v1/index/Bad_Env')).status).toBe(400);
    expect((await h.call('GET', '/v1/index/prod?u=a%20b')).status).toBe(400);
  });

  it('has the same shape the static path produces, through deploy, deploy and rollback', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'cart', '2.0.0');
    await h.call('POST', '/v1/rollback', { token: admin, body: { env: 'prod', remote: 'cart' } });

    let expected: RegistryIndex | undefined;
    for (const version of ['1.0.0', '2.0.0', '1.0.0']) {
      const manifest = manifestFor('cart');
      expected = buildIndex({
        remote: mfe('cart'),
        version,
        manifest,
        files: filesFor(manifest),
        env: 'prod',
        baseUrl: BASE_URL,
        ...(expected === undefined ? {} : { currentIndex: expected }),
        generatedAt: '2026-11-01T00:00:00.000Z',
      }).index;
    }
    const served = await prodIndex();
    expect(served.remotes).toEqual(expected?.remotes);
    expect(served.remotes[0]).toMatchObject({ version: '1.0.0', rolledBackFrom: '2.0.0' });
  });
});

describe('POST /v1/deploy', () => {
  it('registers the version and serves it', async () => {
    const res = await h.deploy(admin, 'cart', '1.0.0');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      changed: true,
      env: 'prod',
      remote: 'cart',
      version: '1.0.0',
      servedBefore: null,
    });
    expect((await prodIndex()).remotes[0]?.entry).toBe(
      `${BASE_URL}/${artifactPrefix('cart', '1.0.0')}/mf-manifest.json`,
    );
  });

  it('is a no-op when the same version is deployed again', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    const again = await h.deploy(admin, 'cart', '1.0.0');
    expect(again.status).toBe(200);
    expect(again.body.changed).toBe(false);
    expect(h.logs.filter((l) => l.includes('/v1/deploy'))).toHaveLength(2);
  });

  it('refuses a route overlap with another remote', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    seedVersion(h.artifacts, 'shop', '1.0.0');
    const res = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: {
        env: 'prod',
        remote: 'shop',
        version: '1.0.0',
        owner: 'team-shop',
        routes: ['/cart/*'],
        manifestUrl: `${BASE_URL}/shop/1.0.0/mf-manifest.json`,
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('gates_failed');
    expect(res.body.error.failures[0]).toMatchObject({ code: 'route-overlap', route: '/cart/*' });
    expect((await prodIndex()).remotes.map((r) => r.name)).toEqual(['cart']);
  });

  it('refuses an incompatible shared range', async () => {
    seedVersion(h.artifacts, 'cart', '1.0.0', { react: '^18.0.0' });
    const res = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: {
        env: 'prod',
        remote: 'cart',
        version: '1.0.0',
        owner: 'team-cart',
        routes: ['/cart'],
        manifestUrl: `${BASE_URL}/cart/1.0.0/mf-manifest.json`,
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.failures.map((f: { code: string }) => f.code)).toContain('compat');
  });

  it('refuses a busted budget', async () => {
    seedVersion(h.artifacts, 'cart', '1.0.0', { entryBytes: 30_000 });
    const res = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: {
        env: 'prod',
        remote: 'cart',
        version: '1.0.0',
        owner: 'team-cart',
        routes: ['/cart'],
        budgets: { initialJsKb: 8 },
        manifestUrl: `${BASE_URL}/cart/1.0.0/mf-manifest.json`,
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.failures.map((f: { code: string }) => f.code)).toContain('budget');
  });

  it('refuses a schema problem', async () => {
    seedVersion(h.artifacts, 'cart', 'one point oh');
    const res = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: {
        env: 'prod',
        remote: 'cart',
        version: 'one point oh',
        owner: 'team-cart',
        routes: ['/cart'],
        manifestUrl: `${BASE_URL}/cart/one point oh/mf-manifest.json`,
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.failures.map((f: { code: string }) => f.code)).toContain('schema');
  });

  it('warns, and does not fail, when the shell manifest is not published', async () => {
    h.artifacts.files.delete(`${BASE_URL}/envs/prod/shell/mf-manifest.json`);
    const res = await h.deploy(admin, 'cart', '1.0.0');
    expect(res.status).toBe(200);
    expect(res.body.warnings[0]).toContain('no shell manifest');
  });

  it('refuses bodies it cannot trust', async () => {
    const base = {
      env: 'prod',
      remote: 'cart',
      version: '1.0.0',
      owner: 'team-cart',
      routes: ['/cart'],
      manifestUrl: `${BASE_URL}/cart/1.0.0/mf-manifest.json`,
    };
    const bad = async (patch: Record<string, unknown>): Promise<number> =>
      (await h.call('POST', '/v1/deploy', { token: admin, body: { ...base, ...patch } })).status;
    expect(await bad({ rollout: { percent: 10 } })).toBe(400);
    expect(await bad({ extra: 1 })).toBe(400);
    expect(await bad({ manifestUrl: 'https://evil.example.com/cart/1.0.0/mf-manifest.json' })).toBe(
      400,
    );
    expect(await bad({ routes: [] })).toBe(400);
    expect(await bad({ routes: [1] })).toBe(400);
    expect(await bad({ env: 'Prod' })).toBe(400);
    expect(await bad({ remote: '../x' })).toBe(400);
    expect(await bad({ platform: { react: 19 } })).toBe(400);
    expect(await bad({ budgets: { initialJsKb: -1 } })).toBe(400);
    expect(await bad({ budgets: [] })).toBe(400);
    const array = await h.call('POST', '/v1/deploy', { token: admin, body: [] });
    expect(array.status).toBe(400);
    const rollout = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: { ...base, rollout: {} },
    });
    expect(rollout.body.error.message).toContain('rollout is not available yet');
  });

  it('says so when artifacts are missing or unreadable', async () => {
    const body = {
      env: 'prod',
      remote: 'cart',
      version: '1.0.0',
      owner: 'team-cart',
      routes: ['/cart'],
      manifestUrl: `${BASE_URL}/cart/1.0.0/mf-manifest.json`,
    };
    const none = await h.call('POST', '/v1/deploy', { token: admin, body });
    expect(none.body.error.code).toBe('artifact_missing');
    seedVersion(h.artifacts, 'cart', '1.0.0', { skip: ['remoteEntry.js'] });
    const partial = await h.call('POST', '/v1/deploy', { token: admin, body });
    expect(partial.body.error.message).toContain('remoteEntry.js');
    h.artifacts.files.set(`${BASE_URL}/cart/1.0.0/mf-manifest.json`, new TextEncoder().encode('{'));
    const broken = await h.call('POST', '/v1/deploy', { token: admin, body });
    expect(broken.body.error.message).toContain('not valid JSON');
    vi.spyOn(h.artifacts, 'get').mockRejectedValue(new Error('connection reset'));
    const down = await h.call('POST', '/v1/deploy', { token: admin, body });
    expect(down.status).toBe(502);
    expect(down.body.error.code).toBe('artifact_unreachable');
  });

  it('keeps a version immutable: same version, different manifest is refused', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    h.artifacts.files.set(
      `${BASE_URL}/cart/1.0.0/mf-manifest.json`,
      new TextEncoder().encode(JSON.stringify({ ...(manifestFor('cart') as object), extra: 1 })),
    );
    const res = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: {
        env: 'prod',
        remote: 'cart',
        version: '1.0.0',
        owner: 'team-cart',
        routes: ['/cart'],
        manifestUrl: `${BASE_URL}/cart/1.0.0/mf-manifest.json`,
        budgets: { initialJsKb: 8 },
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('version_immutable');
  });

  it('is off, with a clear message, when no artifact base is configured', async () => {
    const bare = await startHarness({ artifactBaseUrl: undefined });
    try {
      const res = await bare.call('POST', '/v1/deploy', {
        token: await bare.admin(),
        body: {
          env: 'prod',
          remote: 'cart',
          version: '1.0.0',
          owner: 'o',
          routes: ['/cart'],
          manifestUrl: `${BASE_URL}/cart/1.0.0/mf-manifest.json`,
        },
      });
      expect(res.status).toBe(503);
      expect(res.body.error.message).toContain('MFEFLOW_REGISTRY_ARTIFACT_BASE_URL');
    } finally {
      await bare.stop();
    }
  });
});

describe('concurrent deploys', () => {
  it('commits one and gives the other a clear conflict, which then succeeds on retry', async () => {
    const release = h.artifacts.hold();
    seedVersion(h.artifacts, 'cart', '1.0.0');
    seedVersion(h.artifacts, 'shop', '1.0.0');
    const send = (name: string) =>
      h.call('POST', '/v1/deploy', {
        token: admin,
        body: {
          env: 'prod',
          remote: name,
          version: '1.0.0',
          owner: `team-${name}`,
          routes: [`/${name}`],
          manifestUrl: `${BASE_URL}/${name}/1.0.0/mf-manifest.json`,
        },
      });
    const names = ['cart', 'shop'];
    const both = Promise.all(names.map((name) => send(name)));
    await vi.waitFor(() => {
      expect(h.artifacts.reads.length).toBeGreaterThanOrEqual(2);
    });
    release();
    const results = await both;
    expect(results.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([200, 409]);
    const lostAt = results.findIndex((r) => r.status === 409);
    expect(results[lostAt]?.body.error.code).toBe('conflict');
    expect(results[lostAt]?.body.error.message).toContain('retry');
    expect((await send(names[lostAt] ?? '')).status).toBe(200);
    expect((await prodIndex()).remotes).toHaveLength(2);
  });
});

describe('POST /v1/promote', () => {
  it('points the target env at the version the source serves, and is a no-op the second time', async () => {
    await h.deploy(admin, 'cart', '1.0.0', 'staging');
    const res = await h.call('POST', '/v1/promote', {
      token: admin,
      body: { from: 'staging', to: 'prod', remote: 'cart' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: true, fromEnv: 'staging', version: '1.0.0' });
    expect((await prodIndex()).remotes[0]?.version).toBe('1.0.0');
    const again = await h.call('POST', '/v1/promote', {
      token: admin,
      body: { from: 'staging', to: 'prod', remote: 'cart' },
    });
    expect(again.body.changed).toBe(false);
  });

  it('keeps previous and history across promotions', async () => {
    await h.deploy(admin, 'cart', '1.0.0', 'staging');
    await h.call('POST', '/v1/promote', {
      token: admin,
      body: { from: 'staging', to: 'prod', remote: 'cart' },
    });
    await h.deploy(admin, 'cart', '2.0.0', 'staging');
    await h.call('POST', '/v1/promote', {
      token: admin,
      body: { from: 'staging', to: 'prod', remote: 'cart' },
    });
    expect((await prodIndex()).remotes[0]).toMatchObject({ version: '2.0.0', previous: '1.0.0' });
  });

  it('refuses a missing source, the same env, and a route overlap in the target', async () => {
    const call = (body: unknown) => h.call('POST', '/v1/promote', { token: admin, body });
    expect((await call({ from: 'staging', to: 'prod', remote: 'cart' })).status).toBe(404);
    expect((await call({ from: 'prod', to: 'prod', remote: 'cart' })).status).toBe(400);
    await h.deploy(admin, 'cart', '1.0.0', 'prod');
    await h.deploy(admin, 'cart', '1.0.0', 'staging');
    seedVersion(h.artifacts, 'wide', '1.0.0');
    await h.call('POST', '/v1/deploy', {
      token: admin,
      body: {
        env: 'staging',
        remote: 'wide',
        version: '1.0.0',
        owner: 'team-wide',
        routes: ['/wide'],
        manifestUrl: `${BASE_URL}/wide/1.0.0/mf-manifest.json`,
      },
    });
    await h.call('POST', '/v1/kill', { token: admin, body: { env: 'prod', remote: 'cart' } });
    const killedTarget = await call({ from: 'staging', to: 'prod', remote: 'cart' });
    expect(killedTarget.status).toBe(409);
    expect(killedTarget.body.error.code).toBe('killed');
  });
});

describe('POST /v1/rollback', () => {
  it('goes back to the previous version by default and names where it came from', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'cart', '2.0.0');
    const res = await h.call('POST', '/v1/rollback', {
      token: admin,
      body: { env: 'prod', remote: 'cart' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: '1.0.0',
      servedBefore: '2.0.0',
      rolledBackFrom: '2.0.0',
    });
    expect((await prodIndex()).remotes[0]?.version).toBe('1.0.0');
  });

  it('takes an explicit version from the history', async () => {
    for (const v of ['1.0.0', '2.0.0', '3.0.0']) await h.deploy(admin, 'cart', v);
    const res = await h.call('POST', '/v1/rollback', {
      token: admin,
      body: { env: 'prod', remote: 'cart', to: '1.0.0' },
    });
    expect(res.body.version).toBe('1.0.0');
  });

  it('refuses a target that is not in the history, the current one, or when there is none', async () => {
    const rollback = (body: Record<string, unknown>) =>
      h.call('POST', '/v1/rollback', {
        token: admin,
        body: { env: 'prod', remote: 'cart', ...body },
      });
    expect((await rollback({})).status).toBe(404);
    await h.deploy(admin, 'cart', '1.0.0');
    expect((await rollback({})).body.error.message).toContain('no previous version');
    await h.deploy(admin, 'cart', '2.0.0');
    expect((await rollback({ to: '2.0.0' })).body.error.message).toContain('already serves');
    expect((await rollback({ to: '9.9.9' })).body.error.message).toContain('not in the history');
    expect((await rollback({ force: 'yes' })).status).toBe(400);
  });

  it('runs the gates again, and force goes past them with a warning', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'cart', '2.0.0');
    seedShell(h.artifacts, 'prod', '18.3.0');
    const refused = await h.call('POST', '/v1/rollback', {
      token: admin,
      body: { env: 'prod', remote: 'cart' },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.failures[0]?.code).toBe('compat');
    const forced = await h.call('POST', '/v1/rollback', {
      token: admin,
      body: { env: 'prod', remote: 'cart', force: true },
    });
    expect(forced.status).toBe(200);
    expect(forced.body.warnings.join(' ')).toContain('FORCED');
    expect(
      (await h.call('GET', '/v1/audit?env=prod', { token: admin })).body.entries[0]?.detail,
    ).toEqual({
      forced: true,
    });
  });
});

describe('rollback racing a deploy', () => {
  it('conflicts instead of rolling back from a version the caller never saw', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'cart', '2.0.0');
    seedVersion(h.artifacts, 'cart', '3.0.0');
    const real = h.server.storage.getVersion.bind(h.server.storage);
    let raced = false;
    vi.spyOn(h.server.storage, 'getVersion').mockImplementation(async (env, remote, version) => {
      if (!raced) {
        raced = true;
        await h.call('POST', '/v1/deploy', {
          token: admin,
          body: {
            env: 'prod',
            remote: 'cart',
            version: '3.0.0',
            owner: 'team-cart',
            routes: ['/cart'],
            manifestUrl: `${BASE_URL}/cart/3.0.0/mf-manifest.json`,
            budgets: { initialJsKb: 8 },
          },
        });
      }
      return real(env, remote, version);
    });
    const res = await h.call('POST', '/v1/rollback', {
      token: admin,
      body: { env: 'prod', remote: 'cart' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    expect((await prodIndex()).remotes[0]?.version).toBe('3.0.0');
  });
});

describe('POST /v1/kill', () => {
  it('takes the remote out of the very next index and out of the fallback', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'shop', '1.0.0');
    expect((await prodIndex()).remotes.map((r) => r.name)).toEqual(['cart', 'shop']);
    const killed = await h.call('POST', '/v1/kill', {
      token: admin,
      body: { env: 'prod', remote: 'cart', reason: 'checkout is down' },
    });
    expect(killed.body).toMatchObject({ changed: true, killed: true });
    expect((await prodIndex()).remotes.map((r) => r.name)).toEqual(['shop']);
    await h.server.fallback?.idle();
    const last = h.host.puts.at(-1);
    expect(parseIndex(last?.body).remotes.map((r) => r.name)).toEqual(['shop']);
  });

  it('is idempotent, blocks deploy and rollback while killed, and restore brings it back', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'cart', '2.0.0');
    const kill = (restore?: boolean) =>
      h.call('POST', '/v1/kill', {
        token: admin,
        body: { env: 'prod', remote: 'cart', ...(restore === undefined ? {} : { restore }) },
      });
    await kill();
    expect((await kill()).body.changed).toBe(false);
    expect((await h.deploy(admin, 'cart', '3.0.0')).body.error.code).toBe('killed');
    const rolled = await h.call('POST', '/v1/rollback', {
      token: admin,
      body: { env: 'prod', remote: 'cart' },
    });
    expect(rolled.status).toBe(409);
    expect(rolled.body.error.code).toBe('killed');
    const back = await kill(true);
    expect(back.body).toMatchObject({ changed: true, killed: false });
    expect((await kill(true)).body.changed).toBe(false);
    expect((await prodIndex()).remotes[0]).toMatchObject({ version: '2.0.0', previous: '1.0.0' });
  });

  it('will not restore a remote whose routes were taken while it was killed', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.call('POST', '/v1/kill', { token: admin, body: { env: 'prod', remote: 'cart' } });
    seedVersion(h.artifacts, 'basket', '1.0.0');
    await h.call('POST', '/v1/deploy', {
      token: admin,
      body: {
        env: 'prod',
        remote: 'basket',
        version: '1.0.0',
        owner: 'team-basket',
        routes: ['/cart'],
        manifestUrl: `${BASE_URL}/basket/1.0.0/mf-manifest.json`,
      },
    });
    const res = await h.call('POST', '/v1/kill', {
      token: admin,
      body: { env: 'prod', remote: 'cart', restore: true },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('route_overlap');
  });

  it('404s an unknown remote and rejects a bad restore flag', async () => {
    const kill = (body: Record<string, unknown>) =>
      h.call('POST', '/v1/kill', { token: admin, body: { env: 'prod', remote: 'cart', ...body } });
    expect((await kill({})).status).toBe(404);
    expect((await kill({ restore: 'yes' })).status).toBe(400);
  });
});

describe('GET /v1/audit', () => {
  it('records who, what, when and the versions before and after, never the token', async () => {
    const deployer = await h.token({ actions: ['deploy', 'read'] });
    await h.deploy(deployer, 'cart', '1.0.0');
    await h.deploy(deployer, 'cart', '2.0.0');
    await h.call('POST', '/v1/rollback', { token: admin, body: { env: 'prod', remote: 'cart' } });
    const { body } = await h.call('GET', '/v1/audit?env=prod', { token: admin });
    expect(body.entries.map((e) => e.action)).toEqual(['rollback', 'deploy', 'deploy']);
    expect(body.entries[1]).toMatchObject({
      env: 'prod',
      remote: 'cart',
      before: '1.0.0',
      after: '2.0.0',
    });
    expect(body.entries[0]).toMatchObject({ before: '2.0.0', after: '1.0.0' });
    expect(body.entries[1]?.tokenId).toMatch(/^[0-9a-f]{16}$/);
    expect(body.entries[1]?.tokenId).not.toBe(body.entries[0]?.tokenId);
    expect(new Date(body.entries[0]?.at ?? '').getTime()).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain(deployer);
    expect(JSON.stringify(body)).not.toContain(deployer.split('.')[1] ?? 'missing');
  });

  it('filters by env, remote and limit', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'shop', '1.0.0');
    await h.deploy(admin, 'cart', '1.0.0', 'staging');
    const get = async (q: string) =>
      (await h.call('GET', `/v1/audit${q}`, { token: admin })).body.entries;
    expect(await get('')).toHaveLength(3);
    expect(await get('?env=staging')).toHaveLength(1);
    expect(await get('?env=prod&remote=shop')).toHaveLength(1);
    expect(await get('?limit=1')).toHaveLength(1);
    expect(await get('?limit=abc')).toHaveLength(3);
    expect((await h.call('GET', '/v1/audit?env=BAD', { token: admin })).status).toBe(400);
  });

  it('shows a scoped token only what its scope covers', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'shop', '1.0.0');
    const cartOnly = await h.token({ env: 'prod', remote: 'cart', actions: ['read'] });
    const own = await h.call('GET', '/v1/audit?env=prod', { token: cartOnly });
    expect(own.body.entries.map((e) => e.remote)).toEqual(['cart']);
    expect(
      (await h.call('GET', '/v1/audit?env=prod&remote=shop', { token: cartOnly })).status,
    ).toBe(403);
    expect((await h.call('GET', '/v1/audit', { token: cartOnly })).status).toBe(403);
    const envScoped = await h.token({ env: 'prod', actions: ['read'] });
    expect((await h.call('GET', '/v1/audit', { token: envScoped })).status).toBe(403);
    const noRead = await h.token({ actions: ['deploy'] });
    expect((await h.call('GET', '/v1/audit?env=prod', { token: noRead })).status).toBe(403);
    expect((await h.call('GET', '/v1/audit')).status).toBe(401);
    expect((await h.call('POST', '/v1/audit', { token: admin })).status).toBe(405);
  });
});

describe('auth', () => {
  it('401s a missing, malformed, unknown, wrong-secret or revoked token', async () => {
    const body = { env: 'prod', remote: 'cart' };
    const none = await h.call('POST', '/v1/kill', { body });
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    expect((await h.call('POST', '/v1/kill', { body, token: 'nope' })).status).toBe(401);
    const [id = ''] = admin.slice(4).split('.');
    expect(
      (await h.call('POST', '/v1/kill', { body, token: `mfr_${id}.${'a'.repeat(43)}` })).status,
    ).toBe(401);
    expect(
      (await h.call('POST', '/v1/kill', { body, token: `mfr_${'0'.repeat(16)}.${'a'.repeat(43)}` }))
        .status,
    ).toBe(401);
    await h.server.storage.revokeToken(id, new Date().toISOString());
    expect((await h.call('POST', '/v1/kill', { body, token: admin })).status).toBe(401);
  });

  it('denies by env, remote and action, and lets * and admin through', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    const body = (patch: Record<string, unknown> = {}) => ({
      env: 'prod',
      remote: 'cart',
      ...patch,
    });
    const prodOnly = await h.token({ env: 'prod', actions: ['kill'] });
    const stagingOnly = await h.token({ env: 'staging', actions: ['kill'] });
    const cartOnly = await h.token({ remote: 'cart', actions: ['kill'] });
    const shopOnly = await h.token({ remote: 'shop', actions: ['kill'] });
    const deployOnly = await h.token({ actions: ['deploy'] });
    const kill = (token: string) => h.call('POST', '/v1/kill', { token, body: body() });

    const wrongEnv = await kill(stagingOnly);
    expect(wrongEnv.status).toBe(403);
    expect(wrongEnv.body.error.message).toContain('cannot kill cart in prod');
    expect((await kill(shopOnly)).status).toBe(403);
    expect((await kill(deployOnly)).status).toBe(403);
    expect((await kill(prodOnly)).status).toBe(200);
    expect((await kill(cartOnly)).status).toBe(200);
    expect((await kill(admin)).status).toBe(200);
  });

  it('checks promote against the target env and rollback against the env', async () => {
    await h.deploy(admin, 'cart', '1.0.0', 'staging');
    const toProd = await h.token({ env: 'prod', actions: ['promote'] });
    const toStaging = await h.token({ env: 'staging', actions: ['promote'] });
    const promote = (token: string) =>
      h.call('POST', '/v1/promote', {
        token,
        body: { from: 'staging', to: 'prod', remote: 'cart' },
      });
    expect((await promote(toStaging)).status).toBe(403);
    expect((await promote(toProd)).status).toBe(200);
    const noRollback = await h.token({ actions: ['promote', 'deploy'] });
    expect(
      (
        await h.call('POST', '/v1/rollback', {
          token: noRollback,
          body: { env: 'prod', remote: 'cart' },
        })
      ).status,
    ).toBe(403);
  });

  it('denies a body with no env or remote to a scoped token', async () => {
    const scoped = await h.token({ env: 'prod', remote: 'cart', actions: ['kill'] });
    expect((await h.call('POST', '/v1/kill', { token: scoped, body: {} })).status).toBe(403);
    expect((await h.call('POST', '/v1/kill', { token: scoped, body: [] })).status).toBe(403);
    expect((await h.call('POST', '/v1/kill', { token: admin, body: {} })).status).toBe(400);
  });
});

describe('tokens in the database', () => {
  it('keeps the SHA-256 hash and nothing else, in the table and in the file', async () => {
    const token = await h.token({ actions: ['kill'] });
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(h.dbFile, { readOnly: true });
    const rows = db.prepare('SELECT * FROM tokens').all();
    db.close();
    const row = rows.find((r) => r.hash === sha256Hex(token));
    expect(row).toBeDefined();
    expect(Object.values(row ?? {}).join('|')).not.toContain(token.split('.')[1]);
    const files = await Promise.all(
      [h.dbFile, `${h.dbFile}-wal`].map(async (f) =>
        (await fs.readFile(f).catch(() => Buffer.alloc(0))).toString('latin1'),
      ),
    );
    const everything = files.join('');
    expect(everything).toContain(sha256Hex(token));
    expect(everything).not.toContain(token.split('.')[1] ?? 'missing');
  });

  it('compares hashes with crypto.timingSafeEqual', async () => {
    const spy = vi.spyOn(crypto, 'timingSafeEqual');
    await h.call('POST', '/v1/kill', { token: admin, body: { env: 'prod', remote: 'cart' } });
    await h.call('POST', '/v1/kill', { token: 'mfr_garbage', body: {} });
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect((call[0] as Buffer).length).toBe(32);
      expect((call[1] as Buffer).length).toBe(32);
    }
  });
});

describe('request hygiene', () => {
  it('answers a malformed escape in the env with 400, not 500', async () => {
    const res = await h.call('GET', '/v1/index/%E0%A4');
    expect(res.status).toBe(400);
  });

  it('caps the body, wants JSON, and reports bad JSON', async () => {
    const big = await h.call('POST', '/v1/deploy', {
      token: admin,
      raw: JSON.stringify({ pad: 'x'.repeat(70_000) }),
    });
    expect(big.status).toBe(413);
    const text = await h.call('POST', '/v1/deploy', {
      token: admin,
      raw: '{}',
      headers: { 'content-type': 'text/plain' },
    });
    expect(text.status).toBe(415);
    const broken = await h.call('POST', '/v1/deploy', { token: admin, raw: '{nope' });
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe('bad_json');
  });

  it('caps a chunked body that never declares its length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"pad":"${'x'.repeat(70_000)}"}`));
        controller.close();
      },
    });
    const res = await fetch(`${h.server.url}/v1/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: stream,
      duplex: 'half',
    });
    expect(res.status).toBe(413);
  });

  it('404s unknown routes and 405s the wrong method', async () => {
    expect((await h.call('GET', '/nope')).status).toBe(404);
    const wrong = await h.call('GET', '/v1/deploy', { token: admin });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
    expect((await h.call('POST', '/v1/index/prod')).status).toBe(405);
  });

  it('adds no CORS headers by default', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    const res = await h.call('GET', '/v1/index/prod', {
      headers: { origin: 'https://app.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
  });

  it('allows only listed origins, and only on the index endpoint', async () => {
    const cors = await startHarness({ corsOrigins: ['https://app.example.com'] });
    try {
      const token = await cors.admin();
      seedShell(cors.artifacts, 'prod');
      await cors.deploy(token, 'cart', '1.0.0');
      const ok = await cors.call('GET', '/v1/index/prod', {
        headers: { origin: 'https://app.example.com' },
      });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
      expect(ok.headers.get('vary')).toBe('Origin');
      const other = await cors.call('GET', '/v1/index/prod', {
        headers: { origin: 'https://evil.example.com' },
      });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
      const audit = await cors.call('GET', '/v1/audit', {
        token,
        headers: { origin: 'https://app.example.com' },
      });
      expect(audit.headers.get('access-control-allow-origin')).toBeNull();
      const health = await cors.call('GET', '/healthz', {
        headers: { origin: 'https://app.example.com' },
      });
      expect(health.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await cors.stop();
    }
  });

  it('keeps tokens and 500 details out of logs and responses', async () => {
    await h.call('POST', '/v1/kill', {
      token: 'mfr_0123456789abcdef.secretsecretsecretsecret',
      body: {},
    });
    await h.call('POST', '/v1/kill', { token: admin, body: { env: 'prod', remote: 'x' } });
    vi.spyOn(h.server.storage, 'readEnv').mockRejectedValue(new Error('disk exploded at /var/db'));
    const boom = await h.call('GET', '/v1/index/prod');
    expect(boom.status).toBe(500);
    expect(boom.body.error.message).not.toContain('/var/db');
    const logged = h.logs.join('\n');
    expect(logged).toContain('disk exploded');
    expect(logged).not.toContain(admin);
    expect(logged).not.toContain(admin.split('.')[1]);
    expect(logged).not.toContain('secretsecret');
  });

  it('answers /healthz 500 when the database is unreachable', async () => {
    vi.spyOn(h.server.storage, 'ping').mockRejectedValue(new Error('locked'));
    expect((await h.call('GET', '/healthz')).status).toBe(500);
  });
});

describe('static fallback', () => {
  it('republishes a stable-only index after each pointer change', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.server.fallback?.idle();
    const put = h.host.puts.at(-1);
    expect(put?.key).toBe('envs/prod/index.json');
    expect(put?.options).toMatchObject({
      contentType: 'application/json',
      cacheControl: 'public, max-age=60',
    });
    const published = parseIndex(put?.body);
    expect(published).toEqual(await prodIndex());
    expect(JSON.stringify(published)).not.toContain('rollout');

    await h.deploy(admin, 'cart', '2.0.0');
    await h.call('POST', '/v1/rollback', { token: admin, body: { env: 'prod', remote: 'cart' } });
    await h.server.fallback?.idle();
    expect(parseIndex(h.host.puts.at(-1)?.body).remotes[0]?.version).toBe('1.0.0');
  });

  it('logs and retries a failed write without failing the request', async () => {
    h.host.failNext = 2;
    const res = await h.deploy(admin, 'cart', '1.0.0');
    expect(res.status).toBe(200);
    await h.server.fallback?.idle();
    expect(h.logs.filter((l) => l.startsWith('warn fallback index for prod'))).toHaveLength(2);
    expect(h.host.puts.at(-1)?.key).toBe('envs/prod/index.json');
  });

  it('republishes every env when the server starts', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    await h.deploy(admin, 'cart', '1.0.0', 'staging');
    const host = memoryHost();
    const second = await startRegistryServer({
      config: {
        port: 0,
        bind: '127.0.0.1',
        dbPath: h.dbFile,
        fallbackHost: undefined,
        artifactBaseUrl: undefined,
        corsOrigins: [],
        maxBodyBytes: 1024,
      },
      storage: await openSqliteStorage(h.dbFile),
      fallbackHost: host,
      log: () => undefined,
    });
    await second.fallback?.idle();
    expect(host.puts.map((p) => p.key).toSorted()).toEqual([
      'envs/prod/index.json',
      'envs/staging/index.json',
    ]);
    await second.close();
  });

  it('warns once at start when no fallback host is set', async () => {
    const logs: string[] = [];
    const bare = await startRegistryServer({
      config: {
        port: 0,
        bind: '127.0.0.1',
        dbPath: ':memory:',
        fallbackHost: undefined,
        artifactBaseUrl: undefined,
        corsOrigins: [],
        maxBodyBytes: 1024,
      },
      storage: await openSqliteStorage(':memory:'),
      log: (level, message) => logs.push(`${level} ${message}`),
    });
    await bare.close();
    expect(logs.some((l) => l.includes('no fallback host set'))).toBe(true);
    expect(bare.fallback).toBeUndefined();
  });
});
