import fs from 'node:fs/promises';
import path from 'node:path';
import { PreconditionFailedError, type RegistryHost } from '@mfeflow/registry/static';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '..';
import {
  buildRemote,
  failureOf,
  fixture,
  readObject,
  BASE_URL,
  type Fixture,
} from '../deploy-testing';
import { scriptedPrompter, testRuntime } from '../testing';

const open: Fixture[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((f) => f.cleanup()));
});

async function project(): Promise<Fixture> {
  const f = await fixture();
  open.push(f);
  return f;
}

const codes = (result: { findings: { code: string }[] }) => result.findings.map((x) => x.code);

describe('mfeflow deploy', () => {
  it('uploads the build and points the index at it', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod');
    expect(code).toBe(0);
    expect(result).toMatchObject({
      ok: true,
      command: 'deploy',
      env: 'prod',
      remote: 'catalog',
      version: '1.0.0',
      servedBefore: null,
      published: true,
      dryRun: false,
      localEntry: 'registry/envs/prod/catalog.json',
    });
    expect(result.uploaded).toEqual([
      'catalog/1.0.0/mf-manifest.json',
      'catalog/1.0.0/remoteEntry.js',
      'catalog/1.0.0/static/js/App.js',
      'envs/prod/index.json',
    ]);
    expect((await f.served('prod'))?.version).toBe('1.0.0');
    const local = await readObject(path.join(f.root, result.localEntry ?? ''));
    expect(local).toMatchObject({
      version: '1.0.0',
      manifestUrl: `${BASE_URL}/catalog/1.0.0/mf-manifest.json`,
    });
  });

  it('moves the index to v2 and keeps v1 as previous', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'prod');
    await buildRemote(f.root, 'catalog', '2.0.0');
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod');
    expect(code).toBe(0);
    expect(result).toMatchObject({ servedBefore: '1.0.0', previous: '1.0.0', published: true });
    expect(await f.served('prod')).toMatchObject({ version: '2.0.0', previous: '1.0.0' });
  });

  it('takes the version from --version, and a + becomes _ in the path', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const { result } = await f.run(
      'deploy',
      'catalog',
      '--env',
      'staging',
      '--version',
      '1.0.0+abc1234',
    );
    expect(result.uploaded).toContain('catalog/1.0.0_abc1234/remoteEntry.js');
    expect((await f.served('staging'))?.version).toBe('1.0.0+abc1234');
  });

  it('uploads but leaves the index alone with --no-publish', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'prod');
    await buildRemote(f.root, 'catalog', '2.0.0');
    const local = await f.localTree();
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod', '--no-publish');
    expect(code).toBe(0);
    expect(result.published).toBe(false);
    expect(result.uploaded).not.toContain('envs/prod/index.json');
    expect(result.uploaded).toContain('catalog/2.0.0/remoteEntry.js');
    expect((await f.served('prod'))?.version).toBe('1.0.0');
    expect(await f.localTree()).toEqual(local);
  });

  it('runs again after a failed attempt: files already there are skipped', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'staging');
    const { result } = await f.run('deploy', 'catalog', '--env', 'prod');
    expect(result.uploaded).toEqual(['envs/prod/index.json']);
    expect(result.skipped).toHaveLength(3);
  });

  it('refuses to change a published version', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0', { marker: 'one' });
    await f.run('deploy', 'catalog', '--env', 'prod');
    await buildRemote(f.root, 'catalog', '1.0.0', { marker: 'other' });
    const { code, result } = await f.fail('deploy', 'catalog', '--env', 'prod');
    expect(code).toBe(7);
    expect(result.error.code).toBe('MFEFLOW_E511');
    expect(result.error.message).toContain('different content');
  });

  it('fails with E507 when there is no build', async () => {
    const f = await project();
    const { code, result } = await f.fail('deploy', 'catalog', '--env', 'prod');
    expect(code).toBe(7);
    expect(result.error.code).toBe('MFEFLOW_E507');
    await buildRemote(f.root, 'catalog', '1.0.0');
    await fs.rm(path.join(f.root, 'apps/catalog/dist/mf-manifest.json'));
    const second = await f.fail('deploy', 'catalog', '--env', 'prod');
    expect(second.result.error.message).toContain('mf-manifest.json is not there');
    await fs.writeFile(path.join(f.root, 'apps/catalog/dist/mf-manifest.json'), '{nope');
    const third = await f.fail('deploy', 'catalog', '--env', 'prod');
    expect(third.result.error.message).toContain('not valid JSON');
  });

  it('rejects a name that is not a remote and a missing --env', async () => {
    const f = await project();
    const unknown = await f.fail('deploy', 'nope', '--env', 'prod');
    expect(unknown.code).toBe(2);
    expect(unknown.result.error.message).toContain('not a remote');
    const noEnv = await f.fail('deploy', 'catalog');
    expect(noEnv.code).toBe(2);
    expect(noEnv.result.error.message).toContain('--env');
    const badFlag = await f.fail('deploy', 'catalog', '--env', 'prod', '--wat');
    expect(badFlag.code).toBe(2);
  });
});

describe('deploy gates', () => {
  it('rejects a manifest for another remote with E501', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const file = path.join(f.root, 'apps/catalog/dist/mf-manifest.json');
    const manifest = await readObject(file);
    await fs.writeFile(file, JSON.stringify({ ...manifest, name: 'cart' }));
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod');
    expect(code).toBe(7);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(['MFEFLOW_E501']);
    expect(result.uploaded).toEqual([]);
    expect(await f.hostTree()).toEqual({});
  });

  it('rejects overlapping routes with E502', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await buildRemote(f.root, 'cart', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'prod');
    const mfe = path.join(f.root, 'apps/cart/mfeflow.app.json');
    const cart = await readObject(mfe);
    await fs.writeFile(mfe, JSON.stringify({ ...cart, routes: ['/catalog/*'] }));
    const before = await f.hostTree();
    const { code, result } = await f.run('deploy', 'cart', '--env', 'prod');
    expect(code).toBe(7);
    expect(codes(result)).toEqual(['MFEFLOW_E502']);
    expect(result.findings[0]?.message).toContain('overlaps');
    expect(await f.hostTree()).toEqual(before);
  });

  it('rejects an incompatible shell with E503', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const shell = path.join(f.root, 'shell-manifest.json');
    await fs.writeFile(
      shell,
      JSON.stringify({
        name: 'shell',
        shared: [{ name: 'react', version: '18.3.1', singleton: true }],
      }),
    );
    const { code, result } = await f.run(
      'deploy',
      'catalog',
      '--env',
      'prod',
      '--shell-manifest',
      shell,
    );
    expect(code).toBe(7);
    expect(codes(result)).toEqual(['MFEFLOW_E503']);
    expect(result.findings[0]?.message).toContain('react');
  });

  it('reads the shell manifest from the host when it is there', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const key = path.join(f.site, 'envs/prod/shell/mf-manifest.json');
    await fs.mkdir(path.dirname(key), { recursive: true });
    await fs.writeFile(
      key,
      JSON.stringify({ shared: [{ name: 'react', version: '18.3.1', singleton: true }] }),
    );
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod');
    expect(code).toBe(7);
    expect(codes(result)).toEqual(['MFEFLOW_E503']);
  });

  it('falls back to workspace versions and says so', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const { result } = await f.run('deploy', 'catalog', '--env', 'prod');
    expect(result.warnings.join(' ')).toContain('no shell manifest');
  });

  it('rejects a remote over its budget with E504', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0', { entryBytes: 40_000 });
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod');
    expect(code).toBe(7);
    expect(codes(result)).toEqual(['MFEFLOW_E504']);
    expect(await f.hostTree()).toEqual({});
  });
});

describe('--dry-run', () => {
  it('prints the plan as data and writes nothing', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const hostBefore = await f.hostTree();
    const localBefore = await f.localTree();
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod', '--dry-run');
    expect(code).toBe(0);
    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      published: false,
      uploaded: [],
      skipped: [],
    });
    expect(result.uploads.map((u) => u.key)).toEqual([
      'catalog/1.0.0/mf-manifest.json',
      'catalog/1.0.0/remoteEntry.js',
      'catalog/1.0.0/static/js/App.js',
      'envs/prod/index.json',
    ]);
    expect(result.uploads[0]).toMatchObject({ guard: 'create-only' });
    expect(result.uploads.at(-1)).toMatchObject({
      guard: 'create-only',
      cacheControl: 'public, max-age=60',
    });
    expect(result.index?.remotes[0]).toMatchObject({ name: 'catalog', version: '1.0.0' });
    expect(await f.hostTree()).toEqual(hostBefore);
    expect(await f.localTree()).toEqual(localBefore);
  });

  it('writes nothing for promote and rollback either', async () => {
    const f = await project();
    for (const version of ['1.0.0', '2.0.0']) {
      // oxlint-disable-next-line no-await-in-loop -- v1 must be on the host before v2
      await buildRemote(f.root, 'catalog', version);
      // oxlint-disable-next-line no-await-in-loop -- see above
      await f.run('deploy', 'catalog', '--env', 'prod');
    }
    await f.run('promote', 'catalog', '--from', 'prod', '--to', 'staging');
    const hostBefore = await f.hostTree();
    const localBefore = await f.localTree();
    const promote = await f.run('promote', 'catalog', '--from', 'prod', '--to', 'qa', '--dry-run');
    expect(promote.result).toMatchObject({
      dryRun: true,
      published: false,
      fromEnv: 'prod',
      env: 'qa',
    });
    expect(promote.result.uploads.map((u) => u.key)).toEqual(['envs/qa/index.json']);
    const rollback = await f.run('rollback', 'catalog', '--env', 'prod', '--dry-run');
    expect(rollback.result).toMatchObject({ dryRun: true, version: '1.0.0', published: false });
    expect(rollback.result.index?.remotes[0]).toMatchObject({
      version: '1.0.0',
      rolledBackFrom: '2.0.0',
    });
    expect(await f.hostTree()).toEqual(hostBefore);
    expect(await f.localTree()).toEqual(localBefore);
  });
});

describe('mfeflow rollback', () => {
  async function twoVersions(f: Fixture, versions = ['1.0.0', '2.0.0']): Promise<void> {
    for (const v of versions) {
      // oxlint-disable-next-line no-await-in-loop -- v1 must be on the host before v2
      await buildRemote(f.root, 'catalog', v);
      // oxlint-disable-next-line no-await-in-loop -- see above
      await f.run('deploy', 'catalog', '--env', 'prod');
    }
  }

  it('points the index back at v1 and uploads only the index', async () => {
    const f = await project();
    await twoVersions(f);
    const { code, result } = await f.run('rollback', 'catalog', '--env', 'prod');
    expect(code).toBe(0);
    expect(result).toMatchObject({
      ok: true,
      command: 'rollback',
      version: '1.0.0',
      servedBefore: '2.0.0',
      rolledBackFrom: '2.0.0',
      published: true,
    });
    expect(result.uploaded).toEqual(['envs/prod/index.json']);
    expect(await f.served('prod')).toMatchObject({ version: '1.0.0', rolledBackFrom: '2.0.0' });
    const local = await readObject(path.join(f.root, 'registry/envs/prod/catalog.json'));
    expect(local.version).toBe('1.0.0');
  });

  it('goes to a version named with --to, and never back to the bad one', async () => {
    const f = await project();
    await twoVersions(f, ['1.0.0', '2.0.0', '3.0.0']);
    const { result } = await f.run('rollback', 'catalog', '--env', 'prod', '--to', '1.0.0');
    expect(result.version).toBe('1.0.0');
    expect(await f.served('prod')).toMatchObject({ version: '1.0.0', rolledBackFrom: '3.0.0' });
    const again = await f.fail('rollback', 'catalog', '--env', 'prod');
    expect(again.code).toBe(7);
    expect(again.result.error.code).toBe('MFEFLOW_E508');
    expect(again.result.error.message).toContain('no previous');
  });

  it('refuses a version that is not in the history, or the one being served', async () => {
    const f = await project();
    await twoVersions(f);
    const missing = await f.fail('rollback', 'catalog', '--env', 'prod', '--to', '0.5.0');
    expect(missing.result.error.code).toBe('MFEFLOW_E508');
    expect(missing.result.error.message).toContain('1.0.0');
    const same = await f.fail('rollback', 'catalog', '--env', 'prod', '--to', '2.0.0');
    expect(same.result.error.message).toContain('already serves');
    expect((await f.served('prod'))?.version).toBe('2.0.0');
  });

  it('checks the target files exist before moving the index', async () => {
    const f = await project();
    await twoVersions(f);
    await fs.rm(path.join(f.site, 'catalog/1.0.0/static/js/App.js'));
    const before = await f.hostTree();
    const { code, result } = await f.fail('rollback', 'catalog', '--env', 'prod');
    expect(code).toBe(7);
    expect(result.error.code).toBe('MFEFLOW_E509');
    expect(result.error.message).toContain('static/js/App.js');
    expect(await f.hostTree()).toEqual(before);
  });

  it('says so when the remote is not deployed in that env', async () => {
    const f = await project();
    const { code, result } = await f.fail('rollback', 'catalog', '--env', 'prod');
    expect(code).toBe(7);
    expect(result.error.code).toBe('MFEFLOW_E508');
    expect(result.error.message).toContain('not deployed');
  });

  it('still rolls back when the remote is over today’s budget', async () => {
    const f = await project();
    await twoVersions(f);
    const mfe = path.join(f.root, 'apps/catalog/mfeflow.app.json');
    const catalog = await readObject(mfe);
    await fs.writeFile(mfe, JSON.stringify({ ...catalog, budgets: { initialJsKb: 1 } }));
    const { code, result } = await f.run('rollback', 'catalog', '--env', 'prod');
    expect(code).toBe(0);
    expect(result.version).toBe('1.0.0');
  });
});

describe('mfeflow promote', () => {
  it('copies the pointer from staging to prod without uploading files', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'staging');
    const staging = await f.hostTree();
    const { code, result } = await f.run('promote', 'catalog', '--from', 'staging', '--to', 'prod');
    expect(code).toBe(0);
    expect(result).toMatchObject({
      command: 'promote',
      fromEnv: 'staging',
      env: 'prod',
      version: '1.0.0',
      servedBefore: null,
      published: true,
      localEntry: 'registry/envs/prod/catalog.json',
    });
    expect(result.uploaded).toEqual(['envs/prod/index.json']);
    expect((await f.served('prod'))?.version).toBe('1.0.0');
    const after = await f.hostTree();
    expect(after['envs/staging/index.json']).toBe(staging['envs/staging/index.json']);
  });

  it('does nothing when prod already serves that version', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'staging');
    await f.run('promote', 'catalog', '--from', 'staging', '--to', 'prod');
    const before = await f.hostTree();
    const { code, result } = await f.run('promote', 'catalog', '--from', 'staging', '--to', 'prod');
    expect(code).toBe(0);
    expect(result).toMatchObject({ published: false, uploaded: [], previous: null });
    expect(await f.hostTree()).toEqual(before);
  });

  it('runs the gates against the target env', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'staging');
    const shell = path.join(f.root, 'shell-manifest.json');
    await fs.writeFile(
      shell,
      JSON.stringify({ shared: [{ name: 'react', version: '18.3.1', singleton: true }] }),
    );
    const { code, result } = await f.run(
      'promote',
      'catalog',
      '--from',
      'staging',
      '--to',
      'prod',
      '--shell-manifest',
      shell,
    );
    expect(code).toBe(7);
    expect(codes(result)).toEqual(['MFEFLOW_E503']);
    expect(await f.served('prod')).toBeUndefined();
  });

  it('needs the remote in the source env, and two different envs', async () => {
    const f = await project();
    const missing = await f.fail('promote', 'catalog', '--from', 'staging', '--to', 'prod');
    expect(missing.result.error.code).toBe('MFEFLOW_E508');
    const same = await f.fail('promote', 'catalog', '--from', 'prod', '--to', 'prod');
    expect(same.code).toBe(2);
  });
});

describe('where the registry lives', () => {
  it('does not write registry/envs/dev, which mfeflow dev reads', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const before = await f.localTree();
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'dev');
    expect(code).toBe(0);
    expect(result).toMatchObject({ published: true, localEntry: null });
    expect(result.warnings.join(' ')).toContain('registry/envs/dev was not written');
    expect((await f.served('dev'))?.version).toBe('1.0.0');
    expect(await f.localTree()).toEqual(before);
  });

  it('refuses a --base-url that would put credentials or a query in the index', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const flags = ['deploy', 'catalog', '--env', 'prod', '--host', `file:${f.site}`];
    for (const url of [
      'https://user:pass@cdn.test',
      'https://cdn.test?token=1',
      'ftp://cdn.test',
      'cdn.test',
    ]) {
      const rt = testRuntime();
      // oxlint-disable-next-line no-await-in-loop -- a few URLs
      const code = await main([...flags, '--base-url', url, '--json', '--cwd', f.root], rt);
      const out = rt.io.out.join('');
      expect(code, url).toBe(7);
      expect(failureOf(out).error.code).toBe('MFEFLOW_E506');
      expect(out).not.toContain('pass');
    }
    expect(await f.hostTree()).toEqual({});
  });

  it('uses registry.host and registry.baseUrl from mfeflow.json', async () => {
    const f = await fixture({ configure: true });
    open.push(f);
    const file = path.join(f.root, 'mfeflow.json');
    const config = await readObject(file);
    await fs.writeFile(
      file,
      JSON.stringify({ ...config, registry: { host: `file:${f.site}`, baseUrl: `${BASE_URL}/` } }),
    );
    await buildRemote(f.root, 'catalog', '1.0.0');
    const bad = await f.fail('deploy', 'catalog', '--env', 'prod');
    expect(bad.result.error.code).toBe('MFEFLOW_E104');
    await fs.writeFile(
      file,
      JSON.stringify({ ...config, registry: { host: `file:${f.site}`, baseUrl: BASE_URL } }),
    );
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod');
    expect(code).toBe(0);
    expect(result.host).toBe(`file:${f.site}`);
  });

  describe('with the registry-static feature', () => {
    const addFeature = async (f: Fixture, ...options: string[]) =>
      main(
        [
          'add',
          'registry-static',
          '--no-install',
          ...options.flatMap((o) => ['--option', `registry-static.${o}`]),
          '--cwd',
          f.root,
        ],
        testRuntime(),
      );

    it('reads host and baseUrl from the options it was added with', async () => {
      const f = await fixture({ configure: true });
      open.push(f);
      expect(await addFeature(f, `host=file:${f.site}`, `baseUrl=${BASE_URL}`)).toBe(0);
      await buildRemote(f.root, 'catalog', '1.0.0');
      const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod');
      expect(code).toBe(0);
      expect(result.host).toBe(`file:${f.site}`);
      expect((await f.served('prod'))?.entry).toBe(`${BASE_URL}/catalog/1.0.0/mf-manifest.json`);
    });

    it('lets registry.host in mfeflow.json and then a flag win over the options', async () => {
      const f = await fixture({ configure: true });
      open.push(f);
      const elsewhere = path.join(path.dirname(f.site), 'elsewhere-site');
      expect(await addFeature(f, `host=file:${elsewhere}`, `baseUrl=${BASE_URL}`)).toBe(0);
      const file = path.join(f.root, 'mfeflow.json');
      const config = await readObject(file);
      await fs.writeFile(file, JSON.stringify({ ...config, registry: { host: `file:${f.site}` } }));
      await buildRemote(f.root, 'catalog', '1.0.0');
      const { result } = await f.run('deploy', 'catalog', '--env', 'prod');
      expect(result.host).toBe(`file:${f.site}`);
      expect((await f.served('prod'))?.version).toBe('1.0.0');
      const flagged = await f.run(
        'deploy',
        'catalog',
        '--env',
        'prod',
        '--host',
        `file:${elsewhere}`,
      );
      expect(flagged.result.host).toBe(`file:${elsewhere}`);
      await fs.rm(elsewhere, { recursive: true, force: true });
    });

    it('names the option when a baseUrl that came from it is refused', async () => {
      const f = await fixture({ configure: true });
      open.push(f);
      expect(await addFeature(f, `host=file:${f.site}`, 'baseUrl=https://cdn.test?token=1')).toBe(
        0,
      );
      await buildRemote(f.root, 'catalog', '1.0.0');
      const bad = await f.fail('deploy', 'catalog', '--env', 'prod');
      expect(bad.result.error.code).toBe('MFEFLOW_E506');
      expect(bad.result.error.message).toContain('registry-static option baseUrl');
    });

    it('treats empty options as not set', async () => {
      const f = await fixture({ configure: true });
      open.push(f);
      expect(await addFeature(f)).toBe(0);
      await buildRemote(f.root, 'catalog', '1.0.0');
      const none = await f.fail('deploy', 'catalog', '--env', 'prod');
      expect(none.result.error.code).toBe('MFEFLOW_E506');
      expect(none.result.error.message).toContain('no host');
    });
  });

  it('deploys the version in package.json, which is where the release feature puts it', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const pkgFile = path.join(f.root, 'apps/catalog/package.json');
    const pkg = await readObject(pkgFile);
    // What `changeset version` does to a private remote.
    await fs.writeFile(pkgFile, JSON.stringify({ ...pkg, version: '1.1.0' }));
    const { code, result } = await f.run('deploy', 'catalog', '--env', 'prod', '--dry-run');
    expect(code).toBe(0);
    expect(result.version).toBe('1.1.0');
  });

  it('fails with E506 when no host is set, or the spec is wrong', async () => {
    const f = await fixture({ configure: true });
    open.push(f);
    await buildRemote(f.root, 'catalog', '1.0.0');
    const none = await f.fail('deploy', 'catalog', '--env', 'prod');
    expect(none.code).toBe(7);
    expect(none.result.error.code).toBe('MFEFLOW_E506');
    expect(none.result.error.message).toContain('registry.host');
    for (const host of ['https://x.test', 'file:', 's3://', 's3://UPPER', 's3://bucket/../x']) {
      // oxlint-disable-next-line no-await-in-loop -- a few specs
      const bad = await f.fail('deploy', 'catalog', '--env', 'prod', '--host', host);
      expect(bad.result.error.code).toBe('MFEFLOW_E506');
    }
  });

  it('needs a base URL, and can read it back from the index', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await buildRemote(f.root, 'cart', '1.0.0');
    const rt = testRuntime();
    const argv = [
      'deploy',
      'catalog',
      '--env',
      'prod',
      '--host',
      `file:${f.site}`,
      '--json',
      '--cwd',
      f.root,
    ];
    expect(await main(argv, rt)).toBe(7);
    expect(rt.io.out.join('')).toContain('MFEFLOW_E506');
    await f.run('deploy', 'catalog', '--env', 'prod');
    const second = testRuntime();
    expect(
      await main(
        ['deploy', 'cart', '--env', 'prod', '--host', `file:${f.site}`, '--json', '--cwd', f.root],
        second,
      ),
    ).toBe(0);
    const { entry } = (await f.served('prod', 'cart')) ?? {};
    expect(entry).toBe(`${BASE_URL}/cart/1.0.0/mf-manifest.json`);
  });
});

describe('two writers', () => {
  function racing(times: number, calls: { index: number }): (host: RegistryHost) => RegistryHost {
    return (host) => ({
      ...host,
      async put(key, body, options) {
        if (key.endsWith('index.json')) {
          calls.index += 1;
          if (calls.index <= times) throw new PreconditionFailedError(key);
        }
        return host.put(key, body, options);
      },
    });
  }

  it('reads the index again and retries once', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const calls = { index: 0 };
    const rt = testRuntime();
    rt.wrapHost = racing(1, calls);
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
        '--json',
        '--cwd',
        f.root,
      ],
      rt,
    );
    expect(code).toBe(0);
    expect(calls.index).toBe(2);
    expect((await f.served('prod'))?.version).toBe('1.0.0');
  });

  it('stops with E510 naming what the other writer left', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    await f.run('deploy', 'catalog', '--env', 'prod');
    await buildRemote(f.root, 'catalog', '2.0.0');
    const calls = { index: 0 };
    const rt = testRuntime();
    rt.wrapHost = racing(2, calls);
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
        '--json',
        '--cwd',
        f.root,
      ],
      rt,
    );
    expect(code).toBe(7);
    const out = failureOf(rt.io.out.join(''));
    expect(out.error.code).toBe('MFEFLOW_E510');
    expect(out.error.message).toMatch(
      /rewritten at \d{4}-\d\d-\d\dT.*it now serves catalog@1\.0\.0/,
    );
    expect(calls.index).toBe(2);
    expect((await f.served('prod'))?.version).toBe('1.0.0');
  });
});

describe('the terminal', () => {
  it('asks before it moves anything, and a no leaves everything as it was', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const prompter = scriptedPrompter([false]);
    const rt = testRuntime({ prompter });
    rt.io = { ...rt.io, interactive: true };
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
    expect(code).toBe(130);
    expect(prompter.asked.join(' ')).toContain('Deploy catalog@1.0.0 to prod');
    expect(await f.hostTree()).toEqual({});
  });

  it('does not ask with --yes or --dry-run, and prints a readable summary', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const prompter = scriptedPrompter([]);
    const rt = testRuntime({ prompter });
    rt.io = { ...rt.io, interactive: true };
    const flags = ['--host', `file:${f.site}`, '--base-url', BASE_URL, '--cwd', f.root];
    expect(await main(['deploy', 'catalog', '--env', 'prod', '--dry-run', ...flags], rt)).toBe(0);
    expect(rt.io.out.join('\n')).toContain('Dry run: nothing was written.');
    expect(await main(['deploy', 'catalog', '--env', 'prod', '--yes', ...flags], rt)).toBe(0);
    expect(rt.io.out.join('\n')).toContain('prod now serves catalog@1.0.0 (first deploy).');
    expect(prompter.asked).toEqual([]);
  });

  it('prints a failed gate with its code, fix and docs link', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0', { entryBytes: 40_000 });
    const rt = testRuntime();
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
    expect(code).toBe(7);
    const text = rt.io.out.join('\n');
    expect(text).toContain('error MFEFLOW_E504');
    expect(text).toContain('Fix:');
    expect(text).toContain('/errors/E504');
    expect(text).toContain('Nothing was uploaded.');
  });
});
