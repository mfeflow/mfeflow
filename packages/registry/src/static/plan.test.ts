import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HostError, PreconditionFailedError, type RegistryHost } from './host';
import { filesFor, input, manifestFor, mfe } from './fixtures/remote';
import { localHost } from './local';
import {
  applyPlan,
  contentTypeOf,
  IMMUTABLE,
  INDEX_CACHE_CONTROL,
  planDeploy,
  readIndex,
} from './plan';

describe('planDeploy', () => {
  it('uploads every file under name/version with a one-year immutable cache, then the index', () => {
    const plan = planDeploy(input());
    expect(plan.failures).toEqual([]);
    const keys = plan.uploads.map((u) => u.key);
    expect(keys).toEqual([
      'cart/1.0.0/mf-manifest.json',
      'cart/1.0.0/remoteEntry.js',
      'cart/1.0.0/static/js/App.js',
      'envs/prod/index.json',
    ]);
    for (const upload of plan.uploads.slice(0, -1)) {
      expect(upload.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(upload.cacheControl).toBe(IMMUTABLE);
      expect(upload.ifMatch).toBeUndefined();
    }
    expect(plan.uploads.map((u) => u.contentType)).toEqual([
      'application/json',
      'text/javascript',
      'text/javascript',
      'application/json',
    ]);
  });

  it('serves the index for 60 seconds by default and takes a different value', () => {
    expect(planDeploy(input()).uploads.at(-1)?.cacheControl).toBe('public, max-age=60');
    expect(INDEX_CACHE_CONTROL).toBe('public, max-age=60');
    const short = planDeploy(input({ indexCacheControl: 'public, max-age=10' }));
    expect(short.uploads.at(-1)?.cacheControl).toBe('public, max-age=10');
  });

  it('makes the index upload conditional on the ETag it was read with', () => {
    const plan = planDeploy(input({ currentIndexEtag: '"abc"' }));
    expect(plan.uploads.at(-1)?.ifMatch).toBe('"abc"');
    expect(plan.indexKey).toBe('envs/prod/index.json');
    expect(JSON.parse(String(plan.uploads.at(-1)?.body))).toEqual(plan.index);
  });

  it('encodes + in the version in every key', () => {
    const plan = planDeploy(input({ version: '2.0.0+sha.1a2b' }));
    expect(plan.uploads.every((u) => !u.key.includes('+'))).toBe(true);
    expect(plan.uploads[0]?.key).toBe('cart/2.0.0_sha.1a2b/mf-manifest.json');
  });

  it('uploads nothing when a gate fails', () => {
    const plan = planDeploy(input({ rollout: {} }));
    expect(plan.uploads).toEqual([]);
    expect(plan.failures.map((f) => f.code)).toEqual(['rollout']);
    expect(plan.index.remotes).toHaveLength(1);
  });

  it('rejects an env that is not a plain name', () => {
    for (const env of ['../prod', 'Prod', 'a/b', '']) {
      const plan = planDeploy(input({ env }));
      expect(plan.uploads, env).toEqual([]);
      expect(plan.failures.some((f) => f.code === 'schema' && f.message.includes('env'))).toBe(
        true,
      );
    }
  });

  it('refuses a file path that would leave the version folder', () => {
    const manifest = manifestFor();
    const files = { ...filesFor(manifest), '../other/x.js': new Uint8Array([1]) };
    expect(() => planDeploy(input({ files }))).toThrow(/unsafe key/);
  });
});

describe('contentTypeOf', () => {
  it('maps common extensions and falls back to octet-stream', () => {
    expect(contentTypeOf('a/b.css')).toBe('text/css');
    expect(contentTypeOf('a.woff2')).toBe('font/woff2');
    expect(contentTypeOf('A.JS')).toBe('text/javascript');
    expect(contentTypeOf('LICENSE')).toBe('application/octet-stream');
    expect(contentTypeOf('x.unknown')).toBe('application/octet-stream');
  });
});

describe('applyPlan and readIndex', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mfeflow-plan-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('deploys to a folder and reads the index back with its ETag', async () => {
    const host = localHost(dir);
    expect(await readIndex(host, 'prod')).toEqual({ index: undefined });
    const result = await applyPlan(host, planDeploy(input()));
    expect(result.uploaded).toHaveLength(4);
    const read = await readIndex(host, 'prod');
    expect(read.index?.remotes[0]?.version).toBe('1.0.0');
    expect(read.etag).toBeDefined();
    expect(await fs.stat(path.join(dir, 'cart', '1.0.0', 'remoteEntry.js'))).toBeDefined();
  });

  it('a second deploy skips files already there and moves the index', async () => {
    const host = localHost(dir);
    const base = input();
    await applyPlan(host, planDeploy(base));
    const read = await readIndex(host, 'prod');
    const next = planDeploy({
      ...base,
      version: '1.1.0',
      ...(read.index === undefined ? {} : { currentIndex: read.index }),
      ...(read.etag === undefined ? {} : { currentIndexEtag: read.etag }),
    });
    const result = await applyPlan(host, next);
    expect(result.uploaded).toHaveLength(4);
    const again = await applyPlan(
      host,
      planDeploy({ ...base, version: '1.1.0', currentIndex: next.index }),
    );
    expect(again.skipped).toHaveLength(3);
    expect(again.uploaded).toEqual(['envs/prod/index.json']);
    expect((await readIndex(host, 'prod')).index?.remotes[0]?.previous).toBe('1.0.0');
  });

  it('stops when a published file would change, and when the index changed under it', async () => {
    const host = localHost(dir);
    const base = input();
    await applyPlan(host, planDeploy(base));
    const changed = filesFor(manifestFor(), 4096);
    await expect(applyPlan(host, planDeploy({ ...base, files: changed }))).rejects.toThrow(
      /publish a new version/,
    );

    const stale = planDeploy({ ...base, version: '1.2.0', currentIndexEtag: '"stale"' });
    await expect(applyPlan(host, stale)).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('will not apply a plan with failed gates', async () => {
    await expect(
      applyPlan(localHost(dir), planDeploy(input({ rollout: {} }))),
    ).rejects.toBeInstanceOf(HostError);
  });

  it('uploads the artifacts before the index', async () => {
    const order: string[] = [];
    const host: RegistryHost = {
      put: (key) => {
        order.push(key);
        return Promise.resolve({});
      },
      get: () => Promise.resolve(undefined),
      head: () => Promise.resolve(undefined),
    };
    await applyPlan(host, planDeploy(input()));
    expect(order.at(-1)).toBe('envs/prod/index.json');
    expect(order.slice(0, -1).every((k) => k.startsWith('cart/'))).toBe(true);
  });

  it('refuses an index that is not valid', async () => {
    const host = localHost(dir);
    await host.put('envs/prod/index.json', '{"remotes": 3}', {
      contentType: 'application/json',
      cacheControl: 'no-cache',
    });
    await expect(readIndex(host, 'prod')).rejects.toThrow(/not a valid registry index/);
  });
});

describe('fixtures', () => {
  it('mfe() claims the route it is given', () => {
    expect(mfe('cart', ['/a']).routes).toEqual(['/a']);
  });
});
