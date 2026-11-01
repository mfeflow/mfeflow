import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASE_URL, seedShell, seedVersion, startHarness, type Harness } from './fixtures/harness';
import { artifactPrefix } from '../static';
import { inRollout } from './rollout';

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

const report = (version: string, loads = 1, errors = 0, remote = 'cart') => ({
  remote,
  version,
  loads,
  errors,
});

const beaconBody = (u: string, entries: unknown[]) => ({ env: 'prod', u, entries });

/** Ids that the running rollout assigns to `version`'s side (any ids when nothing is rolling out). */
async function clientsFor(version: string, count: number, prefix = 'c'): Promise<string[]> {
  const [rollout] = await h.server.storage.listRollouts('prod');
  const ids: string[] = [];
  for (let i = 0; ids.length < count && i < 200_000; i += 1) {
    const id = `${prefix}-${String(i)}`;
    const side =
      rollout === undefined
        ? version
        : inRollout(id, 'cart', rollout.id, rollout.percent)
          ? rollout.candidate
          : rollout.stable;
    if (side === version) ids.push(id);
  }
  return ids.length === count ? ids : Array.from({ length: count }, (_, i) => `none-${String(i)}`);
}

const beacon = async (
  version: string,
  loads: number,
  errors: number,
  remote = 'cart',
  u?: string,
) =>
  h.call('POST', '/v1/beacon', {
    body: beaconBody(u ?? (await clientsFor(version, 1))[0] ?? 'x', [
      report(version, loads, errors, remote),
    ]),
  });

/** Distinct browsers reporting one version, the first `errors` of them with an error. */
async function feed(version: string, clients: number, errors: number, prefix: string) {
  const ids = await clientsFor(version, clients, prefix);
  for (const [i, id] of ids.entries())
    // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
    await h.server.service.beacon(beaconBody(id, [report(version, 1, i < errors ? 1 : 0)]));
}

const countsOf = async () => {
  const [rollout] = await h.server.storage.listRollouts('prod');
  return h.server.storage.rolloutCounts(rollout?.id ?? '');
};

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

  it('refuses to complete into a route another remote took meanwhile, and keeps the rollout', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    seedVersion(h.artifacts, 'cart', '2.0.0');
    const started = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: { ...deployBody('2.0.0', { percent: 10 }), routes: ['/cart', '/extra'] },
    });
    expect(started.status).toBe(200);
    seedVersion(h.artifacts, 'shop', '1.0.0');
    const shop = await h.call('POST', '/v1/deploy', {
      token: admin,
      body: {
        env: 'prod',
        remote: 'shop',
        version: '1.0.0',
        owner: 'team-shop',
        routes: ['/extra'],
        manifestUrl: `${BASE_URL}/${artifactPrefix('shop', '1.0.0')}/mf-manifest.json`,
        budgets: { initialJsKb: 8 },
      },
    });
    expect(shop.status).toBe(200);
    const res = await call('complete');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('route_overlap');
    expect(res.body.error.message).toContain('/extra');
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
    expect(await servedFor()).toBe('1.0.0');
    expect(await actions()).not.toContain('rollout.complete');
    expect((await call('abort')).status).toBe(200);
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
    await feed('1.0.0', 1000, 10, 's');
    await feed('2.0.0', 199, 20, 'c');
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
    expect(
      (await beacon('2.0.0', 1, 0, 'cart', (await clientsFor('2.0.0', 1, 'last'))[0])).status,
    ).toBe(202);

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
      candidateCounts: { loads: 200, errors: 20, clients: 200 },
      stableCounts: { loads: 1000, errors: 10, clients: 1000 },
    });
    expect(String(entry?.detail.reason)).toContain('10.0%');
    expect(String(entry?.detail.reason)).toContain('1.0%');
  });

  it('leaves a healthy candidate alone', async () => {
    await startRollout();
    await feed('1.0.0', 500, 5, 's');
    await feed('2.0.0', 300, 3, 'c');
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
    expect(await actions()).not.toContain('rollout.halt');
  });

  it('waits for the minimum sample, however bad the first reports are', async () => {
    await startRollout();
    await feed('1.0.0', 500, 0, 's');
    await feed('2.0.0', 150, 150, 'c');
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
  });

  it('waits for enough distinct clients on each side', async () => {
    await h.stop();
    h = await startHarness({ gate: { minLoads: 10, minClients: 50, factor: 2, floor: 0.02 } });
    admin = await h.admin();
    seedShell(h.artifacts, 'prod');
    await startRollout();
    await feed('1.0.0', 100, 0, 's');
    await feed('2.0.0', 49, 49, 'c');
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
    await feed('2.0.0', 1, 1, 'd');
    expect(await h.server.storage.listRollouts('prod')).toEqual([]);
  });

  it('waits when stable has too few clients', async () => {
    await startRollout();
    await feed('1.0.0', 49, 0, 's');
    await feed('2.0.0', 300, 300, 'c');
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
  });

  it('cannot be steered by one browser sending the same report over and over', async () => {
    await startRollout();
    await feed('1.0.0', 500, 0, 's');
    const forger = (await clientsFor('2.0.0', 1, 'forger'))[0] ?? 'x';
    for (let i = 0; i < 300; i += 1)
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      await h.server.service.beacon(beaconBody(forger, [report('2.0.0', 1, 1)]));
    expect(await h.server.storage.listRollouts('prod')).toHaveLength(1);
    expect((await countsOf())['2.0.0']).toEqual({ loads: 1, errors: 1, clients: 1 });
  });

  it('uses the settings it was given', async () => {
    await h.stop();
    h = await startHarness({ gate: { minLoads: 10, minClients: 5, factor: 1.5, floor: 0.1 } });
    admin = await h.admin();
    seedShell(h.artifacts, 'prod');
    await startRollout();
    await feed('1.0.0', 10, 0, 's');
    await feed('2.0.0', 10, 4, 'c');
    expect(await h.server.storage.listRollouts('prod')).toEqual([]);
  });

  it('counts only reports made during this rollout', async () => {
    await startRollout();
    await beacon('1.0.0', 1, 0);
    await h.call('POST', '/v1/rollout/abort', {
      token: admin,
      body: { env: 'prod', remote: 'cart' },
    });
    await h.call('POST', '/v1/deploy', {
      token: admin,
      body: deployBody('2.0.0', { percent: 10 }),
    });
    expect(await countsOf()).toEqual({});
  });
});

describe('POST /v1/beacon', () => {
  it('needs no token and ignores reports for nothing that is rolling out', async () => {
    expect((await beacon('1.0.0', 1, 0)).status).toBe(202);
    await startRollout();
    expect((await beacon('9.9.9', 1, 1)).status).toBe(202);
    expect((await beacon('2.0.0', 1, 1, 'shop')).status).toBe(202);
    expect((await beacon('2.0.0', 0, 0)).status).toBe(202);
    expect(await countsOf()).toEqual({});
    expect((await beacon('2.0.0', 1, 1)).status).toBe(202);
    expect(await countsOf()).toEqual({ '2.0.0': { loads: 1, errors: 1, clients: 1 } });
  });

  it('takes a whole page in one request and counts each browser once per side', async () => {
    await startRollout();
    const [a = 'x', b = 'y'] = await clientsFor('2.0.0', 2, 'p');
    const page = (u: string, errors: number) =>
      h.call('POST', '/v1/beacon', {
        body: beaconBody(u, [report('2.0.0', 1, errors), report('1.0.0', 1, 0, 'shop')]),
      });
    expect((await page(a, 0)).status).toBe(202);
    expect((await page(a, 0)).status).toBe(202);
    expect((await page(a, 1)).status).toBe(202);
    expect((await page(b, 0)).status).toBe(202);
    expect(await countsOf()).toEqual({ '2.0.0': { loads: 2, errors: 1, clients: 2 } });
  });

  it('upgrades a clean load to an error once, and never back', async () => {
    await startRollout();
    const [u = 'x'] = await clientsFor('2.0.0', 1, 'up');
    const send = (errors: number) =>
      h.call('POST', '/v1/beacon', { body: beaconBody(u, [report('2.0.0', 1, errors)]) });
    await send(0);
    expect(await countsOf()).toEqual({ '2.0.0': { loads: 1, errors: 0, clients: 1 } });
    await send(1);
    expect(await countsOf()).toEqual({ '2.0.0': { loads: 1, errors: 1, clients: 1 } });
    await send(1);
    await send(0);
    expect(await countsOf()).toEqual({ '2.0.0': { loads: 1, errors: 1, clients: 1 } });
  });

  it('drops a report for the side the browser is not assigned to', async () => {
    await startRollout();
    const [onCandidate = 'x'] = await clientsFor('2.0.0', 1, 'w');
    const [onStable = 'y'] = await clientsFor('1.0.0', 1, 'w');
    const send = (u: string, version: string) =>
      h.call('POST', '/v1/beacon', { body: beaconBody(u, [report(version, 1, 1)]) });
    expect((await send(onCandidate, '1.0.0')).status).toBe(202);
    expect((await send(onStable, '2.0.0')).status).toBe(202);
    expect(await countsOf()).toEqual({});
    await send(onCandidate, '2.0.0');
    await send(onStable, '1.0.0');
    expect(await countsOf()).toEqual({
      '2.0.0': { loads: 1, errors: 1, clients: 1 },
      '1.0.0': { loads: 1, errors: 1, clients: 1 },
    });
  });

  it('lets a browser that moves from stable to candidate on a step report both', async () => {
    await startRollout({ percent: 10, steps: [60, 100] });
    const [rollout] = await h.server.storage.listRollouts('prod');
    let mover = '';
    for (let i = 0; mover === ''; i += 1) {
      const id = `m-${String(i)}`;
      if (
        !inRollout(id, 'cart', rollout?.id ?? '', 10) &&
        inRollout(id, 'cart', rollout?.id ?? '', 60)
      )
        mover = id;
    }
    const send = (version: string) =>
      h.call('POST', '/v1/beacon', { body: beaconBody(mover, [report(version)]) });
    await send('1.0.0');
    await send('2.0.0');
    expect(await countsOf()).toEqual({ '1.0.0': { loads: 1, errors: 0, clients: 1 } });
    await h.call('POST', '/v1/rollout/step', {
      token: admin,
      body: { env: 'prod', remote: 'cart' },
    });
    await send('2.0.0');
    expect(await countsOf()).toEqual({
      '1.0.0': { loads: 1, errors: 0, clients: 1 },
      '2.0.0': { loads: 1, errors: 0, clients: 1 },
    });
  });

  it('refuses the same remote twice in one body', async () => {
    await startRollout();
    const [u = 'x'] = await clientsFor('2.0.0', 1);
    const res = await h.call('POST', '/v1/beacon', {
      body: beaconBody(u, [report('2.0.0'), report('2.0.0', 1, 1)]),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('more than once');
    expect(await countsOf()).toEqual({});
  });

  it('accepts a text/plain body, which is what sendBeacon sends', async () => {
    await startRollout();
    const [u = 'x'] = await clientsFor('2.0.0', 1, 'tp');
    const res = await h.call('POST', '/v1/beacon', {
      raw: JSON.stringify(beaconBody(u, [report('2.0.0')])),
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
    expect(res.status).toBe(202);
    expect(await countsOf()).toEqual({ '2.0.0': { loads: 1, errors: 0, clients: 1 } });
  });

  it('refuses counts that one page could not have', async () => {
    await startRollout();
    for (const entry of [
      report('2.0.0', 1000, 1000),
      report('2.0.0', 2, 0),
      report('2.0.0', 1, 2),
      report('2.0.0', 0, 1),
      report('2.0.0', -1, 0),
      report('2.0.0', 1.5, 0),
      { ...report('2.0.0'), loads: '1' },
      { ...report('2.0.0'), loads: null },
      { ...report('2.0.0'), errors: Number.NaN },
    ])
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      expect((await h.call('POST', '/v1/beacon', { body: beaconBody('a', [entry]) })).status).toBe(
        400,
      );
    expect(await countsOf()).toEqual({});
  });

  it('rejects other bad input', async () => {
    const send = async (body: unknown): Promise<number> =>
      (await h.call('POST', '/v1/beacon', { body })).status;
    const good = beaconBody('a', [report('2.0.0')]);
    expect(await send(good)).toBe(202);
    for (const bad of [
      { ...good, env: 'Prod' },
      { ...good, env: 7 },
      { ...good, u: undefined },
      { ...good, u: '' },
      { ...good, u: 'a b' },
      { ...good, u: 'x'.repeat(129) },
      { ...good, extra: true },
      { ...good, entries: [] },
      { ...good, entries: 'all' },
      { ...good, entries: [report('2.0.0', 1, 0, '../x')] },
      { ...good, entries: [report('1.0')] },
      { ...good, entries: [report('../../etc')] },
      { ...good, entries: [{ ...report('2.0.0'), extra: 1 }] },
      { ...good, entries: ['x'] },
      {
        ...good,
        entries: Array.from({ length: 21 }, (_, i) => report('2.0.0', 1, 0, `r${String(i)}`)),
      },
      [],
    ])
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose
      expect(await send(bad)).toBe(400);
    const old = { env: 'prod', remote: 'cart', version: '2.0.0', loads: 1, errors: 0 };
    expect(await send(old)).toBe(400);
    expect((await h.call('POST', '/v1/beacon', { raw: '{nope' })).status).toBe(400);
  });

  it('takes 20 entries', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => report('2.0.0', 1, 0, `r${String(i)}`));
    expect((await h.call('POST', '/v1/beacon', { body: beaconBody('a', entries) })).status).toBe(
      202,
    );
  });

  it('refuses other methods, other content types and big bodies', async () => {
    expect((await h.call('GET', '/v1/beacon')).status).toBe(405);
    const form = await h.call('POST', '/v1/beacon', {
      raw: 'a=1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(form.status).toBe(415);
    const big = await h.call('POST', '/v1/beacon', { raw: `{"pad":"${'x'.repeat(5000)}"}` });
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
        body: beaconBody('a', [report('1.0.0')]),
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

describe('the reporter cap and the status endpoint', () => {
  it('stops counting new browsers at the cap and still answers 202', async () => {
    await h.stop();
    h = await startHarness({ rolloutMaxReporters: 3 });
    admin = await h.admin();
    seedShell(h.artifacts, 'prod');
    await startRollout();
    await feed('2.0.0', 5, 0, 'cap');
    expect(await countsOf()).toEqual({ '2.0.0': { loads: 3, errors: 0, clients: 3 } });
    expect(
      (await beacon('2.0.0', 1, 0, 'cart', (await clientsFor('2.0.0', 1, 'late'))[0])).status,
    ).toBe(202);
    const status = await h.call('GET', '/v1/rollout?env=prod&remote=cart', { token: admin });
    expect(status.body).toMatchObject({ gate: { reporterCap: { max: 3, full: true } } });
  });

  it('shows clients and loads per side and why the gate is waiting', async () => {
    await startRollout({ percent: 10, steps: [50] });
    await feed('1.0.0', 60, 1, 's');
    await feed('2.0.0', 20, 2, 'c');
    const res = await h.call('GET', '/v1/rollout?env=prod&remote=cart', { token: admin });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      env: 'prod',
      remote: 'cart',
      stable: '1.0.0',
      candidate: '2.0.0',
      percent: 10,
      steps: [50],
      stableCounts: { loads: 60, errors: 1, clients: 60 },
      candidateCounts: { loads: 20, errors: 2, clients: 20 },
      gate: {
        verdict: 'wait',
        reason: '20 of 200 candidate loads so far',
        settings: { minLoads: 200, minClients: 50 },
        reporterCap: { max: 20_000, full: false },
      },
    });
  });

  it('says it is waiting for stable clients when the candidate is ready', async () => {
    await startRollout({ percent: 99 });
    await feed('2.0.0', 200, 0, 'c');
    await feed('1.0.0', 2, 0, 's');
    const res = await h.call('GET', '/v1/rollout?env=prod&remote=cart', { token: admin });
    expect(res.body.gate).toMatchObject({
      verdict: 'wait',
      reason: '2 of 50 stable clients so far',
    });
  });

  it('needs a token that can read that remote, and a running rollout', async () => {
    await h.deploy(admin, 'cart', '1.0.0');
    const get = (query: string, token?: string) =>
      h.call('GET', `/v1/rollout${query}`, token === undefined ? {} : { token });
    expect((await get('?env=prod&remote=cart', admin)).status).toBe(404);
    seedVersion(h.artifacts, 'cart', '2.0.0');
    await h.call('POST', '/v1/deploy', {
      token: admin,
      body: deployBody('2.0.0', { percent: 10 }),
    });
    expect((await get('?env=prod&remote=cart')).status).toBe(401);
    expect((await get('?env=prod', admin)).status).toBe(400);
    expect((await get('?env=Bad&remote=cart', admin)).status).toBe(400);
    const writeOnly = await h.token({ actions: ['deploy'] });
    expect((await get('?env=prod&remote=cart', writeOnly)).status).toBe(403);
    const reader = await h.token({ env: 'prod', remote: 'cart', actions: ['read'] });
    expect((await get('?env=prod&remote=cart', reader)).status).toBe(200);
    expect((await h.call('POST', '/v1/rollout', { token: admin, body: {} })).status).toBe(405);
  });
});
