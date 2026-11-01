import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '.';
import {
  buildRemote,
  deployOf,
  failureOf,
  fixture,
  statusOf,
  BASE_URL,
  type Fixture,
} from './deploy-testing';
import { describeHost, openHost, parseHostSpec, redact, secretsOf } from './hosts';
import { fakeIo, testRuntime } from './testing';

const ACCESS = 'AKIA-SENTINEL-ACCESS-ID';
const SECRET = 'sentinel/secret+key=do-not-print';
const TOKEN = 'sentinel-session-token-do-not-print';
const ENDPOINT = 'https://sentinel-endpoint.s3.test';
const ENV = {
  MFEFLOW_S3_ENDPOINT: ENDPOINT,
  MFEFLOW_S3_REGION: 'auto',
  AWS_ACCESS_KEY_ID: ACCESS,
  AWS_SECRET_ACCESS_KEY: SECRET,
  AWS_SESSION_TOKEN: TOKEN,
};

describe('parseHostSpec', () => {
  it('resolves a folder against the folder it is given', () => {
    expect(parseHostSpec('file:site', '/work')).toEqual({
      kind: 'file',
      dir: path.resolve('/work/site'),
    });
    expect(describeHost(parseHostSpec('file:/srv/reg', '/work'))).toBe(
      `file:${path.resolve('/srv/reg')}`,
    );
  });

  it('reads a bucket and a prefix', () => {
    expect(parseHostSpec('s3://my-bucket', '/w')).toEqual({
      kind: 's3',
      bucket: 'my-bucket',
      prefix: '',
    });
    const spec = parseHostSpec('s3://my-bucket//a/b/', '/w');
    expect(spec).toEqual({ kind: 's3', bucket: 'my-bucket', prefix: 'a/b' });
    expect(describeHost(spec)).toBe('s3://my-bucket/a/b');
  });

  it.each([
    '',
    'ftp://x',
    'file:',
    's3://',
    's3://X',
    's3://bucket/a/../b',
    's3://key:secret@bucket',
  ])('rejects %j with E506, without echoing credentials', (spec) => {
    expect(() => parseHostSpec(spec, '/w')).toThrow(
      expect.objectContaining({ code: 'MFEFLOW_E506' }),
    );
    try {
      parseHostSpec(spec, '/w');
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
});

describe('credentials', () => {
  it('lists the secrets the environment holds', () => {
    expect(secretsOf(ENV).toSorted()).toEqual([ACCESS, SECRET, TOKEN].toSorted());
    expect(secretsOf({ AWS_ACCESS_KEY_ID: '' })).toEqual([]);
    expect(redact(`x ${SECRET} y ${TOKEN}`, secretsOf(ENV))).toBe('x *** y ***');
  });

  it('names the missing variables, never a value', () => {
    const spec = parseHostSpec('s3://b-ucket', '/w');
    expect(() => openHost(spec, { env: { AWS_ACCESS_KEY_ID: ACCESS } })).toThrow(
      /AWS_SECRET_ACCESS_KEY, MFEFLOW_S3_REGION/,
    );
    expect(() => openHost(spec, { env: {} })).toThrow(/AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY/);
  });
});

interface Stored {
  body: Uint8Array;
  etag: string;
  sha?: string;
}

/** A bucket in memory behind a fetch: path-style keys, create-only and If-Match writes, listing. */
function fakeBucket(options: { deny?: boolean } = {}) {
  const store = new Map<string, Stored>();
  const seen: string[] = [];
  let counter = 0;
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    seen.push(url.origin);
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(
      Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    if (options.deny)
      return Promise.resolve(
        new Response(
          `<Error><Code>AccessDenied</Code><Message>${SECRET} ${TOKEN}</Message></Error>`,
          { status: 403 },
        ),
      );
    const [, , ...rest] = url.pathname.split('/');
    const key = decodeURIComponent(rest.join('/'));
    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return Promise.resolve(
        new Response(
          `<ListBucketResult>${keys.map((k) => `<Key>${k}</Key>`).join('')}</ListBucketResult>`,
        ),
      );
    }
    if (method === 'PUT') {
      const existing = store.get(key);
      if (headers['if-none-match'] === '*' && existing)
        return Promise.resolve(new Response('', { status: 412 }));
      if (headers['if-match'] !== undefined && existing?.etag !== headers['if-match'])
        return Promise.resolve(new Response('', { status: 412 }));
      counter += 1;
      const etag = `"e${String(counter)}"`;
      const body = init?.body;
      store.set(key, {
        body:
          body instanceof Uint8Array
            ? body
            : new TextEncoder().encode(typeof body === 'string' ? body : ''),
        etag,
        ...(headers['x-amz-meta-sha256'] === undefined
          ? {}
          : { sha: headers['x-amz-meta-sha256'] }),
      });
      return Promise.resolve(new Response('', { headers: { etag } }));
    }
    const hit = store.get(key);
    if (!hit) return Promise.resolve(new Response('', { status: 404 }));
    const meta = {
      etag: hit.etag,
      'content-length': String(hit.body.length),
      ...(hit.sha === undefined ? {} : { 'x-amz-meta-sha256': hit.sha }),
    };
    return Promise.resolve(
      method === 'HEAD'
        ? new Response(null, { headers: meta })
        : new Response(hit.body, { headers: meta }),
    );
  };
  return { store, seen, fetch: impl };
}

const open: Fixture[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((f) => f.cleanup()));
});

async function s3Run(
  f: Fixture,
  bucket: ReturnType<typeof fakeBucket>,
  env: Record<string, string>,
  ...argv: string[]
) {
  const rt = testRuntime();
  rt.io = fakeIo({ env });
  rt.hostFetch = bucket.fetch;
  const code = await main(
    [
      ...argv,
      '--host',
      's3://reg-bucket/mfe',
      ...(argv[0] === 'status' ? [] : ['--base-url', BASE_URL]),
      '--json',
      '--cwd',
      f.root,
    ],
    rt,
  );
  return { code, rt, out: rt.io.out.join(''), err: rt.io.err.join('') };
}

describe('an S3 host', () => {
  it('deploys, reports status, and rolls back through the bucket', async () => {
    const f = await fixture({ configure: true });
    open.push(f);
    const bucket = fakeBucket();
    await buildRemote(f.root, 'catalog', '1.0.0');
    const first = await s3Run(f, bucket, ENV, 'deploy', 'catalog', '--env', 'prod');
    expect(first.code).toBe(0);
    expect(deployOf(first.out)).toMatchObject({ host: 's3://reg-bucket/mfe', published: true });
    expect([...bucket.store.keys()]).toContain('mfe/envs/prod/index.json');
    expect([...bucket.store.keys()]).toContain('mfe/catalog/1.0.0/remoteEntry.js');
    await buildRemote(f.root, 'catalog', '2.0.0');
    await s3Run(f, bucket, ENV, 'deploy', 'catalog', '--env', 'prod');
    const back = await s3Run(f, bucket, ENV, 'rollback', 'catalog', '--env', 'prod');
    expect(deployOf(back.out)).toMatchObject({ ok: true, version: '1.0.0' });
    const status = await s3Run(f, bucket, ENV, 'status', '--env', 'prod');
    const [prod] = statusOf(status.out).envs;
    expect(prod?.remotes[0]).toMatchObject({ version: '1.0.0', unreferenced: [], drift: [] });
    expect(new Set(bucket.seen)).toEqual(new Set([ENDPOINT]));
  });

  it('prints no credential, endpoint or token anywhere, even when the host refuses', async () => {
    const f = await fixture({ configure: true });
    open.push(f);
    await buildRemote(f.root, 'catalog', '1.0.0');
    const good = fakeBucket();
    const ok = await s3Run(f, good, ENV, 'deploy', 'catalog', '--env', 'prod', '--dry-run');
    const refused = await s3Run(
      f,
      fakeBucket({ deny: true }),
      ENV,
      'deploy',
      'catalog',
      '--env',
      'prod',
    );
    const text = await s3Run(f, fakeBucket({ deny: true }), ENV, 'status').then(
      (r) => r.out + r.err,
    );
    expect(refused.code).toBe(7);
    expect(failureOf(refused.out).error.code).toBe('MFEFLOW_E506');
    expect(failureOf(refused.out).error.message).toContain('denied');
    for (const output of [ok.out, ok.err, refused.out, refused.err, text])
      for (const secret of [ACCESS, SECRET, TOKEN, 'sentinel-endpoint'])
        expect(output, secret).not.toContain(secret);
  });

  it('fails with E506 and names the missing variables when credentials are absent', async () => {
    const f = await fixture({ configure: true });
    open.push(f);
    await buildRemote(f.root, 'catalog', '1.0.0');
    const { code, out } = await s3Run(
      f,
      fakeBucket(),
      { MFEFLOW_S3_REGION: 'auto' },
      'deploy',
      'catalog',
      '--env',
      'prod',
    );
    expect(code).toBe(7);
    expect(failureOf(out).error.message).toContain('AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
  });
});
