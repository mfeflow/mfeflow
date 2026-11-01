import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addTrusted,
  configDirOf,
  parseTrustEnv,
  readTrusted,
  removeTrusted,
  trustedNamespaces,
  trustFileIn,
} from './trust';

const A = { namespace: '@acme', template: 'https://acme.dev/{name}.json' };
const B = { namespace: '@bee', template: 'https://bee.dev/{name}.json' };

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-trust-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('configDirOf', () => {
  const home = path.join(os.tmpdir(), 'home');

  it('uses MFEFLOW_CONFIG_DIR first, then XDG_CONFIG_HOME', () => {
    expect(configDirOf({ MFEFLOW_CONFIG_DIR: dir, XDG_CONFIG_HOME: '/x' }, 'linux', home)).toBe(
      dir,
    );
    expect(configDirOf({ XDG_CONFIG_HOME: '/x' }, 'linux', home)).toBe(path.join('/x', 'mfeflow'));
  });

  it('uses APPDATA on Windows and ~/.config elsewhere', () => {
    const appData = path.join(home, 'AppData');
    expect(configDirOf({ APPDATA: appData }, 'win32', home)).toBe(path.join(appData, 'mfeflow'));
    expect(configDirOf({ APPDATA: appData }, 'darwin', home)).toBe(
      path.join(home, '.config', 'mfeflow'),
    );
    expect(configDirOf({}, 'linux', home)).toBe(path.join(home, '.config', 'mfeflow'));
    expect(configDirOf({ XDG_CONFIG_HOME: '' }, 'linux', home)).toBe(
      path.join(home, '.config', 'mfeflow'),
    );
  });
});

describe('the trust file', () => {
  it('trusts nothing before anything is recorded', async () => {
    expect(await readTrusted(dir)).toEqual([]);
  });

  it('records a namespace with its URL template, once, and keeps them sorted', async () => {
    expect(await addTrusted(dir, B)).toBe(true);
    expect(await addTrusted(dir, A)).toBe(true);
    expect(await addTrusted(dir, A)).toBe(false);
    expect(await readTrusted(dir)).toEqual([A, B]);
    const written: unknown = JSON.parse(await fs.readFile(trustFileIn(dir), 'utf8'));
    expect(written).toEqual({ version: 1, registries: [A, B] });
  });

  it('creates the config folder when it is missing', async () => {
    const nested = path.join(dir, 'a', 'b');
    await addTrusted(nested, A);
    expect(await readTrusted(nested)).toEqual([A]);
  });

  it('forgets every entry of a namespace', async () => {
    await addTrusted(dir, A);
    await addTrusted(dir, { ...A, template: 'https://other.dev/{name}.json' });
    await addTrusted(dir, B);
    expect(await removeTrusted(dir, '@acme')).toBe(2);
    expect(await readTrusted(dir)).toEqual([B]);
    expect(await removeTrusted(dir, '@acme')).toBe(0);
  });

  it('trusts nothing from a damaged file, and drops entries that are not valid', async () => {
    await fs.writeFile(trustFileIn(dir), '{not json');
    expect(await readTrusted(dir)).toEqual([]);
    await fs.writeFile(
      trustFileIn(dir),
      JSON.stringify({
        version: 1,
        registries: [A, { namespace: 'acme', template: A.template }, { namespace: '@x' }, 4],
      }),
    );
    expect(await readTrusted(dir)).toEqual([A]);
  });
});

describe('trustedNamespaces', () => {
  const registries = { '@acme': A.template, '@bee': 'https://bee.dev/other/{name}.json' };

  it('needs the namespace and the very same template', () => {
    const trusted = trustedNamespaces(registries, [A, B]);
    expect([...trusted.fetch]).toEqual(['@acme']);
    expect([...trusted.privateOk]).toEqual(['@acme']);
  });

  it('lets a namespace named only in the environment be asked, but never on a private address', () => {
    const trusted = trustedNamespaces(registries, [], parseTrustEnv('@bee,@nobody'));
    expect([...trusted.fetch]).toEqual(['@bee']);
    expect(trusted.privateOk.size).toBe(0);
  });

  it('lets an environment item pinned to the project template reach private addresses', () => {
    const env = parseTrustEnv(`@acme=${A.template}`);
    const trusted = trustedNamespaces(registries, [], env);
    expect([...trusted.fetch]).toEqual(['@acme']);
    expect([...trusted.privateOk]).toEqual(['@acme']);
  });

  it('ignores an environment item pinned to another template', () => {
    const trusted = trustedNamespaces(
      registries,
      [],
      parseTrustEnv('@acme=https://evil.dev/{name}.json'),
    );
    expect(trusted.fetch.size).toBe(0);
    expect(trusted.privateOk.size).toBe(0);
  });
});

describe('parseTrustEnv', () => {
  it('reads a comma list, with optional pinned templates, and skips what is not a namespace', () => {
    expect(parseTrustEnv(' @a, @b-2=https://x.dev/{name}.json?v=1 ,nope,,*')).toEqual([
      { namespace: '@a' },
      { namespace: '@b-2', template: 'https://x.dev/{name}.json?v=1' },
    ]);
    expect(parseTrustEnv(undefined)).toEqual([]);
  });
});
