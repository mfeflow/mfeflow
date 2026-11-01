import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSafeKey, PreconditionFailedError, versionKey } from './host';
import { localHost } from './local';

let dir = '';
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-registry-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const opts = { contentType: 'text/plain', cacheControl: 'no-cache' };

describe('assertSafeKey', () => {
  it('accepts plain relative keys', () => {
    for (const key of ['envs/prod/index.json', 'cart/1.0.0_abc/static/js/App.js', 'a'])
      expect(() => assertSafeKey(key)).not.toThrow();
  });

  it('rejects anything that could leave the folder', () => {
    const bad = [
      '',
      '../x',
      'a/../../x',
      'a/./b',
      '/etc/passwd',
      'C:/Windows/x',
      'c:x',
      'a\\b',
      '..\\x',
      'a//b',
      'a/',
      'a\0b',
    ];
    for (const key of bad)
      expect(() => assertSafeKey(key), JSON.stringify(key)).toThrow(/unsafe key/);
  });
});

describe('versionKey', () => {
  it('replaces + so a key never needs escaping', () => {
    expect(versionKey('1.4.2+a1b2c3d')).toBe('1.4.2_a1b2c3d');
    expect(versionKey('1.4.2')).toBe('1.4.2');
    expect(versionKey('1.0.0-rc.1+a+b')).toBe('1.0.0-rc.1_a_b');
  });
});

describe('localHost', () => {
  it('writes, reads and heads files, creating folders', async () => {
    const host = localHost(dir);
    const put = await host.put('cart/1.0.0/mf-manifest.json', '{"a":1}', opts);
    expect(await fs.readFile(path.join(dir, 'cart', '1.0.0', 'mf-manifest.json'), 'utf8')).toBe(
      '{"a":1}',
    );
    const got = await host.get('cart/1.0.0/mf-manifest.json');
    expect(new TextDecoder().decode(got?.body)).toBe('{"a":1}');
    expect(got?.etag).toBe(put.etag);
    expect(await host.head('cart/1.0.0/mf-manifest.json')).toEqual({ etag: put.etag, size: 7 });
  });

  it('returns undefined for a key that is not there', async () => {
    const host = localHost(dir);
    expect(await host.get('nope.json')).toBeUndefined();
    expect(await host.head('nope/deeper.json')).toBeUndefined();
  });

  it('lists keys under a prefix', async () => {
    const host = localHost(dir);
    await host.put('cart/1.0.0/a.js', 'a', opts);
    await host.put('cart/1.0.0/b/c.js', 'c', opts);
    await host.put('envs/prod/index.json', '{}', opts);
    expect(await host.list?.('cart/')).toEqual(['cart/1.0.0/a.js', 'cart/1.0.0/b/c.js']);
    expect(await host.list?.('')).toHaveLength(3);
    expect(await localHost(path.join(dir, 'missing')).list?.('')).toEqual([]);
  });

  it('refuses keys that escape the folder, for every operation', async () => {
    const host = localHost(path.join(dir, 'site'));
    for (const key of ['../escape.txt', '/abs.txt', 'C:/win.txt', 'a\\b.txt']) {
      await expect(host.put(key, 'x', opts), key).rejects.toThrow(/unsafe key/);
      await expect(host.get(key), key).rejects.toThrow(/unsafe key/);
      await expect(host.head(key), key).rejects.toThrow(/unsafe key/);
    }
    await expect(fs.stat(path.join(dir, 'escape.txt'))).rejects.toThrow();
  });

  describe('ifMatch', () => {
    it('writes when the ETag still matches', async () => {
      const host = localHost(dir);
      const first = await host.put('envs/prod/index.json', '1', opts);
      const second = await host.put('envs/prod/index.json', '2', {
        ...opts,
        ifMatch: first.etag ?? '',
      });
      expect(second.etag).not.toBe(first.etag);
    });

    it('throws PreconditionFailedError when the file changed or is gone', async () => {
      const host = localHost(dir);
      const first = await host.put('envs/prod/index.json', '1', opts);
      await host.put('envs/prod/index.json', '2', opts);
      await expect(
        host.put('envs/prod/index.json', '3', { ...opts, ifMatch: first.etag ?? '' }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);
      await expect(
        host.put('envs/other/index.json', '3', { ...opts, ifMatch: '"x"' }),
      ).rejects.toThrow(/changed since it was read/);
      expect(await fs.readFile(path.join(dir, 'envs', 'prod', 'index.json'), 'utf8')).toBe('2');
    });
  });
});
