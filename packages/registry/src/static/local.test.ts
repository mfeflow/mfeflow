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
      'a/b:stream',
      'CON',
      'a/nul.txt',
      'lpt1.log',
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
    expect(await host.head('cart/1.0.0/mf-manifest.json')).toMatchObject({
      etag: put.etag,
      size: 7,
    });
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

  describe('ifNoneMatch', () => {
    it('creates once, then refuses', async () => {
      const host = localHost(dir);
      await host.put('a/b.js', 'one', { ...opts, ifNoneMatch: '*' });
      await expect(host.put('a/b.js', 'two', { ...opts, ifNoneMatch: '*' })).rejects.toBeInstanceOf(
        PreconditionFailedError,
      );
      expect(await fs.readFile(path.join(dir, 'a', 'b.js'), 'utf8')).toBe('one');
      expect(await fs.readdir(path.join(dir, 'a'))).toEqual(['b.js']);
    });

    it('lets exactly one of several racing creators win', async () => {
      const host = localHost(dir);
      const results = await Promise.allSettled(
        ['1', '2', '3', '4'].map((body) => host.put('r.txt', body, { ...opts, ifNoneMatch: '*' })),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('atomic writes', () => {
    it('keeps the old file and leaves no temp file when the write cannot finish', async () => {
      const host = localHost(dir);
      await host.put('x.txt', 'old', opts);
      await fs.rm(path.join(dir, 'x.txt'));
      await fs.mkdir(path.join(dir, 'x.txt'));
      await expect(host.put('x.txt', 'new', opts)).rejects.toThrow();
      expect(await fs.readdir(dir)).toEqual(['x.txt']);
    });

    it('never shows a leftover temp file as a key', async () => {
      const host = localHost(dir);
      await fs.writeFile(path.join(dir, '.x.txt.crashed.tmp'), 'half');
      await host.put('x.txt', 'whole', opts);
      expect(await host.list?.('')).toEqual(['x.txt']);
      expect(await fs.readFile(path.join(dir, 'x.txt'), 'utf8')).toBe('whole');
    });

    it('heads the content hash', async () => {
      const host = localHost(dir);
      await host.put('x.txt', 'abc', opts);
      expect((await host.head('x.txt'))?.sha256).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });
  });

  describe('symlinks', () => {
    it('refuses a symlinked folder or file that leads outside the root', async (ctx) => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-outside-'));
      const site = path.join(dir, 'site');
      await fs.mkdir(site);
      try {
        await fs.symlink(outside, path.join(site, 'link'), 'dir');
        await fs.writeFile(path.join(outside, 'secret.txt'), 's');
        await fs.symlink(path.join(outside, 'secret.txt'), path.join(site, 'file.txt'));
      } catch {
        await fs.rm(outside, { recursive: true, force: true });
        ctx.skip();
        return;
      }
      const host = localHost(site);
      await expect(host.put('link/evil.txt', 'x', opts)).rejects.toThrow(/outside/);
      await expect(host.get('link/secret.txt')).rejects.toThrow(/outside/);
      await expect(host.get('file.txt')).rejects.toThrow(/symlink/);
      await expect(host.put('file.txt', 'x', opts)).rejects.toThrow(/symlink/);
      expect(await fs.readdir(outside)).toEqual(['secret.txt']);
      await fs.rm(outside, { recursive: true, force: true });
    });
  });

  it('list reports errors other than a missing folder', async () => {
    const file = path.join(dir, 'not-a-dir');
    await fs.writeFile(file, 'x');
    await fs.mkdir(path.join(dir, 'locked'));
    const host = localHost(dir);
    await fs.chmod(path.join(dir, 'locked'), 0o000);
    try {
      if (process.platform === 'win32' || process.getuid?.() === 0) return;
      await expect(host.list?.('')).rejects.toThrow(/EACCES/);
    } finally {
      await fs.chmod(path.join(dir, 'locked'), 0o755);
    }
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
