import fs from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  createToken,
  sqliteSupport,
  startRegistryServer,
  type RegistryServer,
} from '@mfeflow/registry/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '.';
import { buildRemote, fixture, parseObject, type Fixture, BASE_URL } from './deploy-testing';
import { validateResult } from './output';
import { fakeIo, tempDir, removeDir, testRuntime } from './testing';

const supported = sqliteSupport(process.versions.node).ok;

interface Ran {
  code: number;
  json: Record<string, unknown>;
  out: string;
  err: string;
}

let f: Fixture;
let server: RegistryServer;
let dir = '';
let token = '';

/** The server reads artifacts from the folder the CLI uploads to, as a CDN would serve it. */
function siteArtifacts(site: string) {
  return {
    async get(url: string): Promise<Uint8Array | undefined> {
      if (!url.startsWith(`${BASE_URL}/`)) return undefined;
      try {
        return new Uint8Array(await fs.readFile(path.join(site, url.slice(BASE_URL.length + 1))));
      } catch {
        return undefined;
      }
    },
  };
}

beforeEach(async () => {
  if (!supported) return;
  f = await fixture({ configure: true });
  dir = await tempDir('mfeflow-server-mode-');
  const config = configFromEnv({
    MFEFLOW_REGISTRY_PORT: '0',
    MFEFLOW_REGISTRY_DB: path.join(dir, 'registry.db'),
    MFEFLOW_REGISTRY_ARTIFACT_BASE_URL: BASE_URL,
  });
  server = await startRegistryServer({
    config,
    artifacts: siteArtifacts(f.site),
    log: () => undefined,
  });
  token = (
    await createToken(server.storage, {
      env: '*',
      remote: '*',
      actions: ['read', 'deploy', 'promote', 'rollback', 'kill', 'rollout'],
    })
  ).token;
});

afterEach(async () => {
  if (!supported) return;
  await server.close();
  await f.cleanup();
  await removeDir(dir);
});

async function go(argv: string[], env: Record<string, string> = {}): Promise<Ran> {
  const rt = testRuntime();
  rt.io = fakeIo({
    env: { MFEFLOW_REGISTRY_URL: server.url, MFEFLOW_REGISTRY_TOKEN: token, ...env },
  });
  const code = await main([...argv, '--json', '--cwd', f.root], rt);
  const out = rt.io.out.join('');
  const err = rt.io.err.join('');
  expect(out + err, 'the token must never be printed').not.toContain(token);
  expect(validateResult(JSON.parse(out)), out).toEqual([]);
  return { code, json: parseObject(out), out, err };
}

const deploy = (version: string, ...more: string[]) =>
  go([
    'deploy',
    'catalog',
    '--env',
    'prod',
    '--version',
    version,
    '--host',
    `file:${f.site}`,
    '--base-url',
    BASE_URL,
    ...more,
  ]);

async function served(env = 'prod'): Promise<string | undefined> {
  const res = await fetch(`${server.url}/v1/index/${env}`);
  if (res.status === 404) return undefined;
  const body = (await res.json()) as { remotes: { name: string; version?: string }[] };
  return body.remotes.find((r) => r.name === 'catalog')?.version;
}

describe.skipIf(!supported)('server mode against a real server on 127.0.0.1', () => {
  it('deploys, moves to v2 and rolls back, without writing a static index', async () => {
    const localBefore = await f.localTree();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const first = await deploy('1.0.0');
    expect(first.code).toBe(0);
    expect(first.json).toMatchObject({
      ok: true,
      command: 'deploy',
      version: '1.0.0',
      servedBefore: null,
      published: true,
      localEntry: null,
      host: `server ${server.url}`,
    });
    expect(first.json.uploaded).toContain('catalog/1.0.0/mf-manifest.json');
    expect(first.json.uploaded).not.toContain('envs/prod/index.json');
    await buildRemote(f.root, 'catalog', '2.0.0');
    const second = await deploy('2.0.0');
    expect(second.json).toMatchObject({
      servedBefore: '1.0.0',
      previous: '1.0.0',
      published: true,
    });
    expect(await served()).toBe('2.0.0');
    const back = await go(['rollback', 'catalog', '--env', 'prod']);
    expect(back.code).toBe(0);
    expect(back.json).toMatchObject({ command: 'rollback', version: '1.0.0', published: true });
    expect(await served()).toBe('1.0.0');
    expect(Object.keys(await f.hostTree()).some((k) => k.startsWith('envs/'))).toBe(false);
    expect(await f.localTree()).toEqual(localBefore);
  });

  it('has the same --json fields as the static mode', async () => {
    await buildRemote(f.root, 'catalog', '1.0.0');
    const viaServer = await deploy('1.0.0');
    const site = await tempDir('mfeflow-static-site-');
    const rt = testRuntime();
    rt.io = fakeIo({ env: {} });
    await main(
      ['deploy', 'catalog', '--env', 'prod', '--host', `file:${site}`, '--base-url', BASE_URL],
      rt,
    );
    const stat = await go(
      ['deploy', 'catalog', '--env', 'prod', '--host', `file:${site}`, '--base-url', BASE_URL],
      { MFEFLOW_REGISTRY_URL: '' },
    );
    await removeDir(site);
    expect(Object.keys(viaServer.json).toSorted()).toEqual(Object.keys(stat.json).toSorted());
  });

  it('with --dry-run uploads and sends nothing', async () => {
    await buildRemote(f.root, 'catalog', '1.0.0');
    const dry = await deploy('1.0.0', '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.json).toMatchObject({ ok: true, dryRun: true, published: false, uploaded: [] });
    expect((dry.json.uploads as unknown[]).length).toBeGreaterThan(0);
    expect(dry.json.index).toBeDefined();
    expect(await f.hostTree()).toEqual({});
    expect(await served()).toBeUndefined();
    await deploy('1.0.0');
    await buildRemote(f.root, 'catalog', '2.0.0');
    await deploy('2.0.0');
    const dryBack = await go(['rollback', 'catalog', '--env', 'prod', '--dry-run']);
    expect(dryBack.json).toMatchObject({ dryRun: true, version: '1.0.0', published: false });
    expect(await served()).toBe('2.0.0');
  });

  it('promotes one environment to another', async () => {
    await buildRemote(f.root, 'catalog', '1.0.0');
    await go([
      'deploy',
      'catalog',
      '--env',
      'staging',
      '--host',
      `file:${f.site}`,
      '--base-url',
      BASE_URL,
    ]);
    const done = await go(['promote', 'catalog', '--from', 'staging', '--to', 'prod']);
    expect(done.code).toBe(0);
    expect(done.json).toMatchObject({ command: 'promote', fromEnv: 'staging', version: '1.0.0' });
    expect(await served('prod')).toBe('1.0.0');
  });

  it('runs a percentage rollout from a deploy: step, then abort', async () => {
    await buildRemote(f.root, 'catalog', '1.0.0');
    await deploy('1.0.0');
    await buildRemote(f.root, 'catalog', '2.0.0');
    const start = await deploy('2.0.0', '--percent', '10', '--steps', '50,100');
    expect(start.code).toBe(0);
    expect(start.json).toMatchObject({
      published: false,
      servedBefore: '1.0.0',
      rollout: { stable: '1.0.0', candidate: '2.0.0', percent: 10, steps: [50, 100] },
    });
    expect(await served()).toBe('1.0.0');
    const status = await go(['rollout', 'status', 'catalog', '--env', 'prod']);
    expect(status.code).toBe(0);
    expect(status.json).toMatchObject({
      action: 'status',
      candidate: '2.0.0',
      stable: '1.0.0',
      percent: 10,
      report: { steps: [50, 100], gate: { verdict: 'wait' }, reporterCapFull: false },
    });
    const step = await go(['rollout', 'step', 'catalog', '--env', 'prod']);
    expect(step.json).toMatchObject({ command: 'rollout', action: 'step', percent: 50 });
    const abort = await go([
      'rollout',
      'abort',
      'catalog',
      '--env',
      'prod',
      '--reason',
      'errors up',
    ]);
    expect(abort.json).toMatchObject({ action: 'abort', serves: '1.0.0', percent: 0 });
    expect(await served()).toBe('1.0.0');
  });

  it('starts a rollout with promote --percent and completes it', async () => {
    await buildRemote(f.root, 'catalog', '1.0.0');
    await deploy('1.0.0');
    await buildRemote(f.root, 'catalog', '2.0.0');
    await go([
      'deploy',
      'catalog',
      '--env',
      'staging',
      '--version',
      '2.0.0',
      '--host',
      `file:${f.site}`,
      '--base-url',
      BASE_URL,
    ]);
    const start = await go([
      'promote',
      'catalog',
      '--from',
      'staging',
      '--to',
      'prod',
      '--percent',
      '20',
    ]);
    expect(start.code).toBe(0);
    expect(start.json).toMatchObject({ rollout: { candidate: '2.0.0', percent: 20 } });
    const done = await go(['rollout', 'complete', 'catalog', '--env', 'prod']);
    expect(done.json).toMatchObject({ action: 'complete', serves: '2.0.0', percent: 100 });
    expect(await served()).toBe('2.0.0');
  });

  it('kills and restores a remote, and status shows it', async () => {
    await buildRemote(f.root, 'catalog', '1.0.0');
    await deploy('1.0.0');
    const dry = await go(['kill', 'catalog', '--env', 'prod', '--dry-run']);
    expect(dry.json).toMatchObject({ command: 'kill', dryRun: true, changed: null });
    expect(await served()).toBe('1.0.0');
    const kill = await go(['kill', 'catalog', '--env', 'prod', '--reason', 'bug']);
    expect(kill.json).toMatchObject({ command: 'kill', changed: true, killed: true });
    expect(await served()).toBeUndefined();
    const status = await go(['status', '--env', 'prod']);
    const envs = status.json.envs as { remotes: { name: string; killed?: boolean }[] }[];
    expect(envs[0]?.remotes).toMatchObject([{ name: 'catalog', killed: true }]);
    const back = await go(['restore', 'catalog', '--env', 'prod']);
    expect(back.json).toMatchObject({ command: 'restore', changed: true, killed: false });
    expect(await served()).toBe('1.0.0');
  });

  it('reports status from the server, with and without a token', async () => {
    await buildRemote(f.root, 'catalog', '1.0.0');
    await deploy('1.0.0');
    await buildRemote(f.root, 'catalog', '2.0.0');
    await deploy('2.0.0');
    const withToken = await go(['status', '--env', 'prod']);
    expect(withToken.code).toBe(0);
    expect(withToken.json).toMatchObject({
      command: 'status',
      host: `server ${server.url}`,
      envs: [
        {
          env: 'prod',
          published: true,
          remotes: [{ name: 'catalog', version: '2.0.0', previous: '1.0.0' }],
        },
      ],
    });
    const anonymous = await go(['status', '--env', 'prod'], { MFEFLOW_REGISTRY_TOKEN: '' });
    expect(anonymous.json).toMatchObject({ envs: [{ remotes: [{ version: '2.0.0' }] }] });
    const none = await go(['status', '--env', 'qa']);
    expect(none.json).toMatchObject({ envs: [{ env: 'qa', published: false }] });
  });

  it('prints plain text without --json, and still not the token', async () => {
    await buildRemote(f.root, 'catalog', '1.0.0');
    const rt = testRuntime();
    rt.io = fakeIo({ env: { MFEFLOW_REGISTRY_URL: server.url, MFEFLOW_REGISTRY_TOKEN: token } });
    const code = await main(
      [
        'deploy',
        'catalog',
        '--env',
        'prod',
        '--host',
        `file:${f.site}`,
        '--base-url',
        BASE_URL,
        '--cwd',
        f.root,
      ],
      rt,
    );
    expect(code).toBe(0);
    const text = rt.io.out.join('\n');
    expect(text).toContain('prod now serves catalog@1.0.0');
    expect(text).not.toContain(token);
  });

  describe('errors', () => {
    it('maps server answers to E5xx and exit 7', async () => {
      await buildRemote(f.root, 'catalog', '1.0.0');
      const noTarget = await go(['rollback', 'catalog', '--env', 'prod']);
      expect(noTarget.code).toBe(7);
      expect((noTarget.json.error as { code: string }).code).toBe('MFEFLOW_E508');
      await deploy('1.0.0');
      const noPrevious = await go(['rollback', 'catalog', '--env', 'prod']);
      expect((noPrevious.json.error as { code: string }).code).toBe('MFEFLOW_E508');
      const noRollout = await go(['rollout', 'step', 'catalog', '--env', 'prod']);
      expect(noRollout.code).toBe(7);
      expect((noRollout.json.error as { code: string }).code).toBe('MFEFLOW_E508');
      const gone = await go(['kill', 'nothing', '--env', 'prod']);
      expect(gone.code).toBe(7);
      await go(['kill', 'catalog', '--env', 'prod']);
      const killed = await deploy('1.0.0');
      expect(killed.code).toBe(7);
    });

    it('maps a changed version to E511', async () => {
      await buildRemote(f.root, 'catalog', '1.0.0');
      await deploy('1.0.0');
      await buildRemote(f.root, 'catalog', '1.0.0', { marker: 'other' });
      const again = await deploy('1.0.0');
      expect(again.code).toBe(7);
      expect((again.json.error as { code: string }).code).toBe('MFEFLOW_E511');
    });

    it('refuses a wrong token as E506 without echoing it', async () => {
      const bad = 'mfe_not_a_real_token_value';
      const ran = await go(['status', '--env', 'prod', '--verbose'], {});
      expect(ran.code).toBe(0);
      const rt = testRuntime();
      rt.io = fakeIo({ env: { MFEFLOW_REGISTRY_URL: server.url, MFEFLOW_REGISTRY_TOKEN: bad } });
      const code = await main(
        ['kill', 'catalog', '--env', 'prod', '--verbose', '--cwd', f.root],
        rt,
      );
      expect(code).toBe(7);
      const all = rt.io.out.join('') + rt.io.err.join('');
      expect(all).toContain('MFEFLOW_E506');
      expect(all).not.toContain(bad);
    });

    it('needs the token for a write', async () => {
      const ran = await go(['kill', 'catalog', '--env', 'prod'], { MFEFLOW_REGISTRY_TOKEN: '' });
      expect(ran.code).toBe(7);
      expect((ran.json.error as { message: string }).message).toContain('MFEFLOW_REGISTRY_TOKEN');
    });

    it('refuses plain http to a host that is not loopback, and a login in the address', async () => {
      const http = await go(['status', '--env', 'prod'], {
        MFEFLOW_REGISTRY_URL: 'http://registry.example.com',
      });
      expect(http.code).toBe(7);
      expect((http.json.error as { code: string }).code).toBe('MFEFLOW_E506');
      expect((http.json.error as { message: string }).message).toContain('plain http');
      const login = await go(['status', '--env', 'prod'], {
        MFEFLOW_REGISTRY_URL: 'https://user:pw@registry.example.com',
      });
      expect(login.code).toBe(7);
      expect(login.out).not.toContain('user:pw');
    });

    it('takes --registry-url over the environment', async () => {
      const ran = await go(['status', '--env', 'prod', '--registry-url', server.url], {
        MFEFLOW_REGISTRY_URL: 'http://registry.example.com',
      });
      expect(ran.code).toBe(0);
    });
  });
});

describe('static mode keeps the server-only commands out', () => {
  it('refuses --percent, rollout, kill and restore without a server, with exit 7', async () => {
    const root = await tempDir();
    try {
      const ran = async (...argv: string[]) => {
        const rt = testRuntime();
        rt.io = fakeIo({ env: {} });
        const code = await main([...argv, '--json', '--cwd', root], rt);
        return {
          code,
          error: (JSON.parse(rt.io.out.join('')) as { error: { code: string } }).error.code,
        };
      };
      expect(await ran('deploy', 'catalog', '--env', 'prod', '--percent', '10')).toEqual({
        code: 7,
        error: 'MFEFLOW_E505',
      });
      expect(
        await ran('promote', 'catalog', '--from', 'a', '--to', 'b', '--percent', '10'),
      ).toEqual({
        code: 7,
        error: 'MFEFLOW_E505',
      });
      expect(await ran('rollout', 'step', 'catalog', '--env', 'prod')).toEqual({
        code: 7,
        error: 'MFEFLOW_E505',
      });
      expect(await ran('kill', 'catalog', '--env', 'prod')).toEqual({
        code: 7,
        error: 'MFEFLOW_E506',
      });
      expect(await ran('restore', 'catalog', '--env', 'prod')).toEqual({
        code: 7,
        error: 'MFEFLOW_E506',
      });
    } finally {
      await removeDir(root);
    }
  });

  it('rejects a malformed --percent or --steps as a usage error', async () => {
    for (const flags of [
      ['--percent', '0'],
      ['--percent', '100'],
      ['--steps', '50'],
      ['--percent', '10', '--steps', '5,50'],
      ['--percent', 'x'],
    ]) {
      const rt = testRuntime();
      rt.io = fakeIo({
        env: { MFEFLOW_REGISTRY_URL: 'http://127.0.0.1:1', MFEFLOW_REGISTRY_TOKEN: 't' },
      });
      const code = await main(
        ['promote', 'catalog', '--from', 'a', '--to', 'b', ...flags, '--json'],
        rt,
      );
      expect(code, flags.join(' ')).toBe(2);
    }
  });
});
