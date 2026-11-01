import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, type StatusResult } from '..';
import { buildRemote, fixture, readObject, statusOf, type Fixture } from '../deploy-testing';
import { testRuntime } from '../testing';

const open: Fixture[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((f) => f.cleanup()));
});

async function project(): Promise<Fixture> {
  const f = await fixture();
  open.push(f);
  return f;
}

async function deploy(f: Fixture, version: string, ...extra: string[]): Promise<void> {
  await buildRemote(f.root, 'catalog', version);
  const { code } = await f.run('deploy', 'catalog', '--env', 'prod', ...extra);
  expect(code).toBe(0);
}

const prod = (result: StatusResult) => result.envs.find((e) => e.env === 'prod');

describe('mfeflow status', () => {
  it('shows nothing deployed on a fresh host, and no drift', async () => {
    const f = await project();
    const { code, result } = await f.status();
    expect(code).toBe(0);
    expect(result.envs.map((e) => [e.env, e.published])).toEqual([
      ['prod', false],
      ['staging', false],
    ]);
    expect(result.findings).toEqual([]);
  });

  it('shows version, previous and when, and is clean right after a deploy', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    await deploy(f, '2.0.0');
    const { code, result } = await f.status('--env', 'prod');
    expect(code).toBe(0);
    expect(result.envs).toHaveLength(1);
    expect(prod(result)?.published).toBe(true);
    expect(prod(result)?.generatedAt).toMatch(/^\d{4}-/);
    expect(prod(result)?.remotes).toEqual([
      {
        name: 'catalog',
        version: '2.0.0',
        previous: '1.0.0',
        history: ['1.0.0'],
        rolledBackFrom: null,
        local: '2.0.0',
        unreferenced: [],
        drift: [],
      },
    ]);
    expect(result.findings).toEqual([]);
  });

  it('shows the rolled-back state and stays clean after a rollback', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    await deploy(f, '2.0.0');
    await f.run('rollback', 'catalog', '--env', 'prod');
    const { result } = await f.status('--env', 'prod');
    expect(prod(result)?.remotes[0]).toMatchObject({
      version: '1.0.0',
      rolledBackFrom: '2.0.0',
      drift: [],
    });
  });

  it('shows drift after --no-publish: uploaded but not pointed at', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    await deploy(f, '2.0.0', '--no-publish');
    const { code, result } = await f.status('--env', 'prod');
    expect(code).toBe(0);
    const remote = prod(result)?.remotes[0];
    expect(remote).toMatchObject({ version: '1.0.0', unreferenced: ['2.0.0'] });
    expect(remote?.drift.join(' ')).toContain('uploaded but not pointed at: 2.0.0');
    expect(result.findings).toMatchObject([
      { code: 'MFEFLOW_E512', severity: 'warning', app: 'catalog' },
    ]);
  });

  it('does not call a version drift when another env points at it', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    await f.run('promote', 'catalog', '--from', 'prod', '--to', 'staging');
    await deploy(f, '2.0.0');
    const { result } = await f.status('--env', 'staging');
    expect(result.envs[0]?.remotes[0]).toMatchObject({
      version: '1.0.0',
      unreferenced: [],
      drift: [],
    });
    expect(result.findings).toEqual([]);
  });

  it('decodes a + version and shows drift when a local file differs from the host', async () => {
    const f = await project();
    await deploy(f, '1.0.0', '--version', '1.0.0+abc');
    const file = path.join(f.root, 'registry/envs/prod/catalog.json');
    const local = await readObject(file);
    await fs.writeFile(file, JSON.stringify({ ...local, version: '0.9.0' }));
    const { result } = await f.status('--env', 'prod');
    const remote = prod(result)?.remotes[0];
    expect(remote).toMatchObject({ version: '1.0.0+abc', local: '0.9.0', unreferenced: [] });
    expect(remote?.drift).toEqual([
      'registry/envs/prod/catalog.json says 0.9.0, the host serves 1.0.0+abc',
    ]);
  });

  it('flags a missing local file', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    await fs.rm(path.join(f.root, 'registry/envs/prod/catalog.json'));
    const { result } = await f.status('--env', 'prod');
    expect(result.findings.map((x) => x.message).join('\n')).toContain(
      'registry/envs/prod/catalog.json is missing',
    );
    expect(prod(result)?.remotes[0]).toMatchObject({ local: null });
  });

  it('does not mind local files for remotes that were never deployed', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    const { result } = await f.status('--env', 'prod');
    expect(await fs.readdir(path.join(f.root, 'registry/envs/prod'))).toContain('cart.json');
    expect(result.findings).toEqual([]);
  });

  it('does not call versions that aged out of the history drift', { timeout: 60_000 }, async () => {
    const f = await project();
    for (let n = 1; n <= 13; n += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each version follows the one before
      await deploy(f, `1.0.${String(n)}`);
    }
    const { result } = await f.status('--env', 'prod');
    const remote = prod(result)?.remotes[0];
    expect(remote?.history).toHaveLength(10);
    expect(remote?.unreferenced).toEqual([]);
    expect(remote?.drift).toEqual([]);
  });

  it('does not call the bad version drift after a rollback and a fix', async () => {
    const f = await project();
    for (const version of ['1.0.0', '1.1.0', '1.2.0']) {
      // oxlint-disable-next-line no-await-in-loop -- each version follows the one before
      await deploy(f, version);
    }
    await f.run('rollback', 'catalog', '--env', 'prod');
    await deploy(f, '1.3.0');
    const { result } = await f.status('--env', 'prod');
    expect(prod(result)?.remotes[0]).toMatchObject({
      version: '1.3.0',
      unreferenced: [],
      drift: [],
    });
    await deploy(f, '1.4.0', '--no-publish');
    const after = await f.status('--env', 'prod');
    expect(prod(after.result)?.remotes[0]?.unreferenced).toEqual(['1.4.0']);
  });

  it('reports "not checked" for unreferenced files when the host cannot list', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    const rt = testRuntime();
    rt.wrapHost = (host) => ({
      put: (key, body, options) => host.put(key, body, options),
      get: (key) => host.get(key),
      head: (key) => host.head(key),
    });
    const code = await main(
      ['status', '--env', 'prod', '--host', `file:${f.site}`, '--json', '--cwd', f.root],
      rt,
    );
    expect(code).toBe(0);
    expect(statusOf(rt.io.out.join('')).envs[0]?.remotes[0]?.unreferenced).toBeNull();
  });

  it('lists the envs on the host on a fresh clone with no registry/envs folders', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    await f.run('promote', 'catalog', '--from', 'prod', '--to', 'staging');
    await fs.rm(path.join(f.root, 'registry/envs'), { recursive: true });
    const { result } = await f.status();
    expect(result.envs.map((e) => [e.env, e.published])).toEqual([
      ['prod', true],
      ['staging', true],
    ]);
    expect(result.envs[0]?.remotes[0]).toMatchObject({ version: '1.0.0', unreferenced: [] });
  });

  it('sorts the waiting versions by semver, not as text', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    await deploy(f, '1.0.10', '--no-publish');
    await deploy(f, '1.0.9', '--no-publish');
    await deploy(f, '1.0.2', '--no-publish');
    const { result } = await f.status('--env', 'prod');
    expect(prod(result)?.remotes[0]?.unreferenced).toEqual(['1.0.2', '1.0.9', '1.0.10']);
  });

  it('prints a readable table without --json', async () => {
    const f = await project();
    await deploy(f, '1.0.0');
    await deploy(f, '2.0.0', '--no-publish');
    const rt = testRuntime();
    const code = await main(
      ['status', '--env', 'prod', '--host', `file:${f.site}`, '--cwd', f.root],
      rt,
    );
    expect(code).toBe(0);
    const text = rt.io.out.join('\n');
    expect(text).toContain('catalog  1.0.0  (no previous)  DRIFT');
    expect(text).toContain('drift: uploaded but not pointed at: 2.0.0');
    const clean = testRuntime();
    await main(['status', '--env', 'staging', '--host', `file:${f.site}`, '--cwd', f.root], clean);
    expect(clean.io.out.join('\n')).toContain('nothing deployed yet');
  });
});
