import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASE_URL, seedShell, seedVersion, startHarness, type Harness } from './fixtures/harness';
import { artifactPrefix } from '../static';

let h: Harness;
let admin: string;

beforeEach(async () => {
  h = await startHarness();
  admin = await h.admin();
  seedShell(h.artifacts, 'prod');
});

afterEach(async () => {
  await h.stop();
});

const deployBody = (version: string, rollout?: unknown): Record<string, unknown> => ({
  env: 'prod',
  remote: 'cart',
  version,
  owner: 'team-cart',
  routes: ['/cart'],
  manifestUrl: `${BASE_URL}/${artifactPrefix('cart', version)}/mf-manifest.json`,
  budgets: { initialJsKb: 8 },
  ...(rollout === undefined ? {} : { rollout }),
});

async function startRollout(rollout: unknown = { percent: 10, steps: [50, 100] }) {
  await h.deploy(admin, 'cart', '1.0.0');
  seedVersion(h.artifacts, 'cart', '2.0.0');
  return h.call('POST', '/v1/deploy', { token: admin, body: deployBody('2.0.0', rollout) });
}

const servedFor = async (u?: string): Promise<string | undefined> => {
  const res = await h.call('GET', `/v1/index/prod${u === undefined ? '' : `?u=${u}`}`);
  return res.body.remotes[0]?.version;
};

const beacon = (version: string, loads: number, errors: number, remote = 'cart') =>
  h.call('POST', '/v1/beacon', { body: { env: 'prod', remote, version, loads, errors } });

const actions = async (): Promise<string[]> =>
  (await h.call('GET', '/v1/audit?env=prod', { token: admin })).body.entries.map((e) => e.action);

describe('deploy with a rollout', () => {
  it('serves the candidate to a share of clients and stable to everyone else', async () => {
    const res = await startRollout({ percent: 30 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: '2.0.0',
      servedBefore: '1.0.0',
      rollout: { stable: '1.0.0', candidate: '2.0.0', percent: 30, steps: [] },
    });
    const { service } = h.server;
    let candidate = 0;
    for (let i = 0; i < 10_000; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 10k reads from a local database
      const index = await service.index('prod', `client-${String(i)}`);
      if (index?.remotes[0]?.version === '2.0.0') candidate += 1;
    }
    expect(candidate / 100).toBeGreaterThan(28);
    expect(candidate / 100).toBeLessThan(32);
  });

  it('gives a client the same answer every time, and stable when there is no client id', async () => {
    await startRollout({ percent: 50 });
    const seen = new Map<string, string | undefined>();
    for (let i = 0; i < 40; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      seen.set(`u${String(i)}`, await servedFor(`u${String(i)}`));
    }
    for (const [u, version] of seen) {
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      expect(await servedFor(u)).toBe(version);
    }
    expect(new Set(seen.values())).toEqual(new Set(['1.0.0', '2.0.0']));
    expect(await servedFor()).toBe('1.0.0');
  });

  it('keeps the static fallback on stable', async () => {
    await startRollout({ percent: 100 - 1 });
    await h.server.fallback?.idle();
    expect(h.host.puts.length).toBeGreaterThan(0);
    for (const put of h.host.puts) expect(put.body).not.toContain('2.0.0');
    expect((await h.server.service.stableIndex('prod'))?.remotes[0]?.version).toBe('1.0.0');
  });

  it('refuses bad rollouts', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    seedVersion(h.artifacts, 'cart', '2.0.0');
    const bad = async (rollout: unknown): Promise<number> =>
      (await h.call('POST', '/v1/deploy', { token: admin, body: deployBody('2.0.0', rollout) }))
        .status;
    for (const rollout of [
      {},
      { percent: 0 },
      { percent: 100 },
      { percent: 10.5 },
      { percent: 10, steps: [5] },
      { percent: 10, steps: [50, 50] },
      { percent: 10, steps: [200] },
      { percent: 10, steps: 'all' },
      { percent: 10, extra: 1 },
      [],
      'ten',
    ])
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      expect(await bad(rollout)).toBe(400);
    expect(await servedFor('x')).toBe('1.0.0');
  });

  it('needs a stable version first, and a different one', async () => {
    seedVersion(h.artifacts, 'cart', '1.0.0');
    const first = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: deployBody('1.0.0', { percent: 10 }),
    });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('no_stable');
    await h.deploy(admin, 'cart', '1.0.0');
    const same = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: deployBody('1.0.0', { percent: 10 }),
    });
    expect(same.body.error.code).toBe('no_target');
  });

  it('blocks other moves of that remote until the rollout ends', async () => {
    await startRollout();
    seedVersion(h.artifacts, 'cart', '3.0.0');
    const deploy = await h.call('POST', '/v1/deploy', { token: admin, body: deployBody('3.0.0') });
    expect(deploy.body.error.code).toBe('rollout_active');
    const second = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: deployBody('3.0.0', { percent: 5 }),
    });
    expect(second.body.error.code).toBe('rollout_active');
    const rollback = await h.call('POST', '/v1/rollback', {
      token: admin,
      body: { env: 'prod', remote: 'cart' },
    });
    expect(rollback.body.error.code).toBe('rollout_active');
  });

  it('audits the start with the rollout plan', async () => {
    await startRollout();
    const entry = (await h.call('GET', '/v1/audit?env=prod', { token: admin })).body.entries[0];
    expect(entry).toMatchObject({ action: 'deploy', before: '1.0.0', after: '2.0.0' });
    expect(entry?.detail).toMatchObject({ rollout: { percent: 10, steps: [50, 100] } });
  });
});

describe('rollout step, complete and abort', () => {
  const call = (path: string, token = admin) =>
    h.call('POST', `/v1/rollout/${path}`, { token, body: { env: 'prod', remote: 'cart' } });

  const percentNow = async (): Promise<number> => {
    let n = 0;
    for (let i = 0; i < 400; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      if ((await h.server.service.index('prod', `c${String(i)}`))?.remotes[0]?.version === '2.0.0')
        n += 1;
    }
    return n / 4;
  };

  it('steps through the percents, then says no step is left', async () => {
    await startRollout({ percent: 10, steps: [50, 100] });
    const first = await call('step');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ action: 'step', percent: 50, serves: '1.0.0' });
    expect(await percentNow()).toBeGreaterThan(40);
    expect((await call('step')).body).toMatchObject({ percent: 100 });
    expect(await percentNow()).toBe(100);
    const done = await call('step');
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe('no_next_step');
    expect(await servedFor('c1')).toBe('2.0.0');
    expect(await servedFor()).toBe('1.0.0');
  });

  it('complete makes the candidate stable for everyone, with stable as its previous', async () => {
    await startRollout();
    const res = await call('complete');
    expect(res.body).toMatchObject({ action: 'complete', serves: '2.0.0', stable: '1.0.0' });
    expect(await servedFor()).toBe('2.0.0');
    const remote = (await h.call('GET', '/v1/index/prod')).body.remotes[0];
    expect(remote).toMatchObject({ version: '2.0.0', previous: '1.0.0' });
    expect(await h.server.storage.listRollouts('prod')).toEqual([]);
    await h.server.fallback?.idle();
    expect(h.host.puts.at(-1)?.body).toContain('2.0.0');
    expect(await actions()).toContain('rollout.complete');
    expect((await call('complete')).body.error.code).toBe('no_rollout');
  });

  it('abort puts everyone back on stable and records why', async () => {
    await startRollout({ percent: 99 });
    const res = await h.call('POST', '/v1/rollout/abort', {
      token: admin,
      body: { env: 'prod', remote: 'cart', reason: 'support tickets' },
    });
    expect(res.body).toMatchObject({ action: 'abort', serves: '1.0.0' });
    expect(await servedFor('c1')).toBe('1.0.0');
    const entry = (await h.call('GET', '/v1/audit?env=prod', { token: admin })).body.entries[0];
    expect(entry).toMatchObject({ action: 'rollout.abort', before: '1.0.0', after: '1.0.0' });
    expect(entry?.detail).toMatchObject({ reason: 'support tickets', candidate: '2.0.0' });
    expect((await call('abort')).status).toBe(404);
  });

  it('lets the same candidate be deployed again after an abort, reshuffled', async () => {
    await startRollout({ percent: 50 });
    await call('abort');
    const again = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: deployBody('2.0.0', { percent: 50 }),
    });
    expect(again.status).toBe(200);
    expect(again.body.rollout?.candidate).toBe('2.0.0');
  });

  it('audits every change with the token that made it', async () => {
    await startRollout();
    await call('step');
    await call('abort');
    const entries = (await h.call('GET', '/v1/audit?env=prod', { token: admin })).body.entries;
    expect(entries.slice(0, 2).map((e) => e.action)).toEqual(['rollout.abort', 'rollout.step']);
    expect(entries[0]?.tokenId).toMatch(/^[0-9a-f]{16}$/);
    expect(entries[1]?.detail).toMatchObject({ fromPercent: 10, toPercent: 50 });
  });

  it('needs the rollout action, scoped like the others', async () => {
    await startRollout();
    const deployer = await h.token({ actions: ['read', 'deploy', 'promote'] });
    expect((await call('step', deployer)).status).toBe(403);
    expect((await call('complete', deployer)).status).toBe(403);
    expect((await call('abort', deployer)).status).toBe(403);
    expect((await call('step', '')).status).toBe(401);
    const elsewhere = await h.token({ env: 'staging', actions: ['rollout'] });
    expect((await call('step', elsewhere)).status).toBe(403);
    const other = await h.token({ remote: 'shop', actions: ['rollout'] });
    expect((await call('step', other)).status).toBe(403);
    const scoped = await h.token({ env: 'prod', remote: 'cart', actions: ['rollout'] });
    expect((await call('step', scoped)).status).toBe(200);
  });

  it('refuses unknown fields and the wrong method', async () => {
    await startRollout();
    const extra = await h.call('POST', '/v1/rollout/step', {
      token: admin,
      body: { env: 'prod', remote: 'cart', percent: 100 },
    });
    expect(extra.status).toBe(400);
    expect((await h.call('GET', '/v1/rollout/step')).status).toBe(405);
  });

  it('refuses to complete a killed remote', async () => {
    await startRollout();
    await h.call('POST', '/v1/kill', { token: admin, body: { env: 'prod', remote: 'cart' } });
    expect((await call('complete')).body.error.code).toBe('killed');
    expect((await call('abort')).status).toBe(200);
  });
});

describe('the gate', () => {
  it('halts a candidate that errors at 10% against stable at 1%, end to end', async () => {
    await startRollout({ percent: 10, steps: [50, 100] });
    expect((await beacon('1.0.0', 1000, 10)).status).toBe(202);
    expect((await beacon('1.0.0', 1000, 10)).status).toBe(202);
    expect((await beacon('2.0.0', 100, 10)).status).toBe(202);
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
    expect((await beacon('2.0.0', 100, 10)).status).toBe(202);

    expect(await h.server.storage.listRollouts('prod')).toEqual([]);
    for (let i = 0; i < 50; i += 1)
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      expect(await servedFor(`client-${String(i)}`)).toBe('1.0.0');
    const entry = (await h.call('GET', '/v1/audit?env=prod', { token: admin })).body.entries[0];
    expect(entry).toMatchObject({
      action: 'rollout.halt',
      tokenId: null,
      env: 'prod',
      remote: 'cart',
      before: '1.0.0',
      after: '1.0.0',
    });
    expect(entry?.detail).toMatchObject({
      gate: 'error-rate',
      candidate: '2.0.0',
      candidateCounts: { loads: 200, errors: 20 },
      stableCounts: { loads: 2000, errors: 20 },
    });
    expect(String(entry?.detail.reason)).toContain('10.0%');
    expect(String(entry?.detail.reason)).toContain('1.0%');
  });

  it('leaves a healthy candidate alone', async () => {
    await startRollout();
    await beacon('1.0.0', 1000, 10);
    await beacon('2.0.0', 500, 5);
    await beacon('2.0.0', 500, 8);
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
    expect(await actions()).not.toContain('rollout.halt');
  });

  it('waits for the minimum sample, however bad the first reports are', async () => {
    await startRollout();
    await beacon('1.0.0', 1000, 0);
    await beacon('2.0.0', 150, 150);
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
  });

  it('uses the settings it was given', async () => {
    await h.stop();
    h = await startHarness({ gate: { minLoads: 10, factor: 1.5, floor: 0.1 } });
    admin = await h.admin();
    seedShell(h.artifacts, 'prod');
    await startRollout();
    await beacon('2.0.0', 10, 4);
    expect(await h.server.storage.listRollouts('prod')).toEqual([]);
  });

  it('counts a stable that started the rollout, not older traffic', async () => {
    await startRollout();
    await beacon('1.0.0', 1000, 0);
    await h.call('POST', '/v1/rollout/abort', {
      token: admin,
      body: { env: 'prod', remote: 'cart' },
    });
    await h.call('POST', '/v1/deploy', {
      token: admin,
      body: deployBody('2.0.0', { percent: 10 }),
    });
    const [rollout] = await h.server.storage.listRollouts('prod');
    expect(await h.server.storage.rolloutCounts(rollout?.id ?? '')).toEqual({});
  });
});

describe('POST /v1/beacon', () => {
  it('needs no token and ignores reports for nothing that is rolling out', async () => {
    expect((await beacon('1.0.0', 5, 0)).status).toBe(202);
    await startRollout();
    expect((await beacon('9.9.9', 5, 5)).status).toBe(202);
    expect((await beacon('2.0.0', 5, 5, 'shop')).status).toBe(202);
    expect((await beacon('2.0.0', 0, 0)).status).toBe(202);
    const [rollout] = await h.server.storage.listRollouts('prod');
    expect(await h.server.storage.rolloutCounts(rollout?.id ?? '')).toEqual({});
    expect((await beacon('2.0.0', 5, 1)).status).toBe(202);
    expect(await h.server.storage.rolloutCounts(rollout?.id ?? '')).toEqual({
      '2.0.0': { loads: 5, errors: 1 },
    });
  });

  it('accepts a text/plain body, which is what sendBeacon sends', async () => {
    await startRollout();
    const res = await h.call('POST', '/v1/beacon', {
      raw: JSON.stringify({ env: 'prod', remote: 'cart', version: '2.0.0', loads: 3, errors: 0 }),
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
    expect(res.status).toBe(202);
  });

  it('rejects bad input', async () => {
    const good = { env: 'prod', remote: 'cart', version: '2.0.0', loads: 5, errors: 1 };
    const send = async (patch: Record<string, unknown>): Promise<number> =>
      (await h.call('POST', '/v1/beacon', { body: { ...good, ...patch } })).status;
    expect(await send({})).toBe(202);
    for (const patch of [
      { env: 'Prod' },
      { env: 7 },
      { remote: '../x' },
      { remote: '' },
      { version: '1.0' },
      { version: '../../etc' },
      { loads: -1 },
      { loads: 1001 },
      { loads: 1.5 },
      { loads: '5' },
      { loads: null },
      { errors: -1 },
      { errors: 6 },
      { errors: Number.NaN },
      { extra: true },
    ])
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      expect(await send(patch)).toBe(400);
    const { loads: _loads, ...missing } = good;
    expect((await h.call('POST', '/v1/beacon', { body: missing })).status).toBe(400);
    expect((await h.call('POST', '/v1/beacon', { body: [] })).status).toBe(400);
    expect((await h.call('POST', '/v1/beacon', { raw: '{nope' })).status).toBe(400);
  });

  it('refuses other methods, other content types and big bodies', async () => {
    expect((await h.call('GET', '/v1/beacon')).status).toBe(405);
    const form = await h.call('POST', '/v1/beacon', {
      raw: 'a=1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(form.status).toBe(415);
    const big = await h.call('POST', '/v1/beacon', { raw: `{"pad":"${'x'.repeat(2000)}"}` });
    expect(big.status).toBe(413);
  });

  it('does not log every beacon', async () => {
    await beacon('1.0.0', 1, 0);
    expect(h.logs.some((l) => l.includes('/v1/beacon'))).toBe(false);
  });
});

describe('beacon rate limit', () => {
  it('refuses a client past its burst and says when to retry', async () => {
    await h.stop();
    h = await startHarness({ beaconLimit: { burst: 3, perMinute: 60 } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1)
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      statuses.push((await beacon('1.0.0', 1, 0)).status);
    expect(statuses).toEqual([202, 202, 202, 429, 429]);
    const refused = await beacon('1.0.0', 1, 0);
    expect(refused.body.error.code).toBe('rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it('rate limits before it reads the body, and does not limit the index', async () => {
    await h.stop();
    h = await startHarness({ beaconLimit: { burst: 1, perMinute: 1 } });
    expect((await beacon('1.0.0', 1, 0)).status).toBe(202);
    const junk = await h.call('POST', '/v1/beacon', { raw: '{nope' });
    expect(junk.status).toBe(429);
    await h.deploy(await h.admin(), 'cart', '1.0.0');
    for (let i = 0; i < 5; i += 1)
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      expect((await h.call('GET', '/v1/index/prod?u=a')).status).toBe(200);
  });

  it('tells clients apart by the last forwarded address only when told to trust the proxy', async () => {
    await h.stop();
    h = await startHarness({ beaconLimit: { burst: 1, perMinute: 1 }, trustProxy: true });
    const from = (ip: string) =>
      h.call('POST', '/v1/beacon', {
        body: { env: 'prod', remote: 'cart', version: '1.0.0', loads: 1, errors: 0 },
        headers: { 'x-forwarded-for': `6.6.6.6, ${ip}` },
      });
    expect((await from('10.0.0.1')).status).toBe(202);
    expect((await from('10.0.0.2')).status).toBe(202);
    expect((await from('10.0.0.1')).status).toBe(429);

    await h.stop();
    h = await startHarness({ beaconLimit: { burst: 1, perMinute: 1 } });
    expect((await from('10.0.0.1')).status).toBe(202);
    expect((await from('10.0.0.2')).status).toBe(429);
  });
});
