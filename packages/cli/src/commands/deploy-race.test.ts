import fs from 'node:fs/promises';
import path from 'node:path';
import type { RegistryHost } from '@mfeflow/registry/static';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '..';
import {
  buildRemote,
  deployOf,
  failureOf,
  fixture,
  readObject,
  BASE_URL,
  type Fixture,
} from '../deploy-testing';
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

/** Lets another writer commit its own deploy just before the first index write, so that write goes out stale. */
function racer(other: () => Promise<void>): (host: RegistryHost) => RegistryHost {
  let fired = false;
  return (host) => ({
    ...host,
    async put(key, body, options) {
      if (!fired && key.endsWith('index.json')) {
        fired = true;
        await other();
      }
      return host.put(key, body, options);
    },
  });
}

async function otherDeploy(f: Fixture, version: string): Promise<void> {
  await buildRemote(f.root, 'catalog', version);
  const { code } = await f.run('deploy', 'catalog', '--env', 'prod');
  expect(code).toBe(0);
}

async function ship(f: Fixture, versions: string[]): Promise<void> {
  for (const version of versions) {
    // oxlint-disable-next-line no-await-in-loop -- each version follows the one before
    await buildRemote(f.root, 'catalog', version);
    // oxlint-disable-next-line no-await-in-loop -- see above
    await f.run('deploy', 'catalog', '--env', 'prod');
  }
}

function flags(f: Fixture, ...extra: string[]): string[] {
  return ['--host', `file:${f.site}`, '--base-url', BASE_URL, ...extra, '--json', '--cwd', f.root];
}

describe('a second writer between the read and the write', () => {
  it('makes deploy plan again on the index the other writer left', async () => {
    const f = await project();
    await ship(f, ['1.0.0']);
    await buildRemote(f.root, 'catalog', '2.0.0');
    const rt = testRuntime();
    rt.wrapHost = racer(() => otherDeploy(f, '3.0.0'));
    const code = await main(['deploy', 'catalog', '--env', 'prod', ...flags(f)], rt);
    expect(code).toBe(0);
    expect(deployOf(rt.io.out.join('')).servedBefore).toBe('3.0.0');
    expect(await f.served('prod')).toMatchObject({
      version: '2.0.0',
      previous: '3.0.0',
      history: ['3.0.0', '1.0.0'],
    });
  });

  it('stops a rollback with E510 when the served version moved, instead of skipping one', async () => {
    const f = await project();
    await ship(f, ['1.0.0', '2.0.0']);
    const rt = testRuntime();
    rt.wrapHost = racer(() => otherDeploy(f, '3.0.0'));
    const code = await main(['rollback', 'catalog', '--env', 'prod', ...flags(f)], rt);
    expect(code).toBe(7);
    const { error } = failureOf(rt.io.out.join(''));
    expect(error.code).toBe('MFEFLOW_E510');
    expect(error.message).toContain('catalog@3.0.0');
    expect(error.message).toContain('2.0.0');
    expect(await f.served('prod')).toMatchObject({ version: '3.0.0' });
  });

  it('keeps a rollback --to when the target is still valid on the fresh index', async () => {
    const f = await project();
    await ship(f, ['1.0.0', '2.0.0']);
    const rt = testRuntime();
    rt.wrapHost = racer(() => otherDeploy(f, '3.0.0'));
    const code = await main(
      ['rollback', 'catalog', '--env', 'prod', '--to', '1.0.0', ...flags(f)],
      rt,
    );
    expect(code).toBe(0);
    expect(await f.served('prod')).toMatchObject({ version: '1.0.0', rolledBackFrom: '3.0.0' });
  });

  it('refuses a rollback --to that the fresh index no longer offers', async () => {
    const f = await project();
    await ship(f, ['1.0.0', '2.0.0']);
    const rt = testRuntime();
    // The other writer rolls prod back to 1.0.0 itself, so 1.0.0 is now what is served.
    rt.wrapHost = racer(async () => {
      const { code } = await f.run('rollback', 'catalog', '--env', 'prod');
      expect(code).toBe(0);
    });
    const code = await main(
      ['rollback', 'catalog', '--env', 'prod', '--to', '1.0.0', ...flags(f)],
      rt,
    );
    expect(code).toBe(7);
    expect(failureOf(rt.io.out.join('')).error.code).toBe('MFEFLOW_E508');
    expect(await f.served('prod')).toMatchObject({ version: '1.0.0', rolledBackFrom: '2.0.0' });
  });
});

describe('rollback in an incident', () => {
  async function withIncompatibleShell(f: Fixture): Promise<string> {
    const file = path.join(f.root, 'shell-manifest.json');
    await fs.writeFile(
      file,
      JSON.stringify({ shared: [{ name: 'react', version: '18.3.1', singleton: true }] }),
    );
    return file;
  }

  it('stops on a failed compatibility check, and --force goes through with a loud warning', async () => {
    const f = await project();
    await ship(f, ['1.0.0', '2.0.0']);
    const shell = await withIncompatibleShell(f);
    const stopped = await f.run('rollback', 'catalog', '--env', 'prod', '--shell-manifest', shell);
    expect(stopped.code).toBe(7);
    expect(stopped.result.findings.map((x) => x.code)).toEqual(['MFEFLOW_E503']);
    expect((await f.served('prod'))?.version).toBe('2.0.0');
    const forced = await f.run(
      'rollback',
      'catalog',
      '--env',
      'prod',
      '--shell-manifest',
      shell,
      '--force',
    );
    expect(forced.code).toBe(0);
    expect(forced.result.warnings.join(' ')).toMatch(/FORCED: --force skipped 1 failed check/);
    expect((await f.served('prod'))?.version).toBe('1.0.0');
  });

  it('never skips the files check', async () => {
    const f = await project();
    await ship(f, ['1.0.0', '2.0.0']);
    await fs.rm(path.join(f.site, 'catalog/1.0.0/remoteEntry.js'));
    const { code, result } = await f.fail('rollback', 'catalog', '--env', 'prod', '--force');
    expect(code).toBe(7);
    expect(result.error.code).toBe('MFEFLOW_E509');
    expect((await f.served('prod'))?.version).toBe('2.0.0');
  });

  it('checks the files with HEAD and reads only the manifest', async () => {
    const f = await project();
    await ship(f, ['1.0.0', '2.0.0']);
    const reads: string[] = [];
    const rt = testRuntime();
    rt.wrapHost = (host) => ({
      ...host,
      async get(key) {
        reads.push(key);
        return host.get(key);
      },
    });
    expect(await main(['rollback', 'catalog', '--env', 'prod', ...flags(f)], rt)).toBe(0);
    expect(reads.filter((k) => k.startsWith('catalog/'))).toEqual([
      'catalog/1.0.0/mf-manifest.json',
    ]);
  });
});

describe('base URL checks', () => {
  async function tryUrl(f: Fixture, url: string) {
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
        url,
        '--json',
        '--cwd',
        f.root,
      ],
      rt,
    );
    return { code, out: rt.io.out.join('') };
  }

  it('refuses a ? or # anywhere, including an empty one, and http off localhost', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    for (const url of [
      'https://cdn.test#',
      'https://cdn.test?',
      'https://cdn.test/a#b',
      'http://cdn.test',
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- a few URLs
      const { code, out } = await tryUrl(f, url);
      expect(code, url).toBe(7);
      expect(failureOf(out).error.code).toBe('MFEFLOW_E506');
    }
    expect((await tryUrl(f, 'http://cdn.test')).out).toContain('only on localhost');
    expect(await f.hostTree()).toEqual({});
  });

  it('stores the normalised URL, and allows http on localhost', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    expect((await tryUrl(f, 'HTTPS://CDN.Test/assets/')).code).toBe(0);
    expect((await f.served('prod'))?.entry).toBe(
      'https://cdn.test/assets/catalog/1.0.0/mf-manifest.json',
    );
    await buildRemote(f.root, 'cart', '1.0.0');
    const rt = testRuntime();
    const local = await main(
      [
        'deploy',
        'cart',
        '--env',
        'staging',
        '--host',
        `file:${f.site}`,
        '--base-url',
        'http://localhost:4300',
        '--json',
        '--cwd',
        f.root,
      ],
      rt,
    );
    expect(local).toBe(0);
    expect((await f.served('staging', 'cart'))?.entry).toBe(
      'http://localhost:4300/cart/1.0.0/mf-manifest.json',
    );
  });

  it('checks the value in mfeflow.json too', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const file = path.join(f.root, 'mfeflow.json');
    const config = await readObject(file);
    await fs.writeFile(
      file,
      JSON.stringify({ ...config, registry: { baseUrl: 'http://cdn.test' } }),
    );
    const rt = testRuntime();
    const code = await main(
      ['deploy', 'catalog', '--env', 'prod', '--host', `file:${f.site}`, '--json', '--cwd', f.root],
      rt,
    );
    expect(code).toBe(3);
    expect(failureOf(rt.io.out.join('')).error.code).toBe('MFEFLOW_E104');
  });
});

describe('the shell manifest warning', () => {
  it('does not repeat what a bad file contained', async () => {
    const f = await project();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const file = path.join(f.root, 'shell.json');
    await fs.writeFile(file, '{"token": "TOP-SECRET-WORD" nope');
    const { result } = await f.run('deploy', 'catalog', '--env', 'prod', '--shell-manifest', file);
    expect(result.warnings.join(' ')).toContain('could not be read or is not valid JSON');
    expect(JSON.stringify(result)).not.toContain('TOP-SECRET-WORD');
  });
});

describe('promote with a second writer', () => {
  // staging serves 2.0.0 and prod was rolled back to 1.0.0, so promoting staging to prod really moves prod.
  async function staged(f: Fixture): Promise<void> {
    await ship(f, ['1.0.0', '2.0.0']);
    await f.run('promote', 'catalog', '--from', 'prod', '--to', 'staging');
    await f.run('rollback', 'catalog', '--env', 'prod');
  }

  it('plans again on the target the other writer changed', async () => {
    const f = await project();
    await staged(f);
    const rt = testRuntime();
    rt.wrapHost = racer(() => otherDeploy(f, '3.0.0'));
    const code = await main(
      ['promote', 'catalog', '--from', 'staging', '--to', 'prod', ...flags(f)],
      rt,
    );
    expect(code).toBe(0);
    expect(await f.served('prod')).toMatchObject({ version: '2.0.0', previous: '3.0.0' });
  });

  it('stops with E510 when the source env no longer serves the version', async () => {
    const f = await project();
    await staged(f);
    const rt = testRuntime();
    rt.wrapHost = racer(async () => {
      await buildRemote(f.root, 'catalog', '3.0.0');
      const other = await f.run('deploy', 'catalog', '--env', 'staging');
      expect(other.code).toBe(0);
      // The target changes too, so the write is refused and the command plans again.
      await otherDeploy(f, '3.0.1');
    });
    const code = await main(
      ['promote', 'catalog', '--from', 'staging', '--to', 'prod', ...flags(f)],
      rt,
    );
    expect(code).toBe(7);
    const { error } = failureOf(rt.io.out.join(''));
    expect(error.code).toBe('MFEFLOW_E510');
    expect(error.message).toContain('staging now serves catalog@3.0.0');
    expect((await f.served('prod'))?.version).toBe('3.0.1');
  });
});
