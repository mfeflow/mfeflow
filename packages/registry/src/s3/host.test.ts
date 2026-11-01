import { describe, expect, it } from 'vitest';
import { AccessDeniedError, HostError, PreconditionFailedError } from '../static/host';
import { s3Host, type S3Options } from './host';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | undefined;
}

const SECRET = 'SECRET/KEY+do-not-leak';
const TOKEN = 'session-token-do-not-leak';

function fakeFetch(respond: (call: Call) => Response | Error) {
  const calls: Call[] = [];
  const impl = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
      body: init?.body instanceof Uint8Array ? init.body : undefined,
    };
    calls.push(call);
    const out = respond(call);
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  };
  return { calls, fetch: impl };
}

const base = (extra: Partial<S3Options> = {}): S3Options => ({
  region: 'eu-west-1',
  bucket: 'my-registry',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: SECRET,
  now: () => new Date('2026-11-01T10:00:00Z'),
  ...extra,
});

const opts = { contentType: 'application/json', cacheControl: 'public, max-age=60' };

describe('s3Host URLs', () => {
  it('uses virtual-host style on AWS', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await s3Host(base({ fetch: f.fetch })).put('cart/1.0.0_abc/App.js', 'x', opts);
    expect(f.calls[0]?.url).toBe(
      'https://my-registry.s3.eu-west-1.amazonaws.com/cart/1.0.0_abc/App.js',
    );
  });

  it('uses path style for a custom endpoint, and keeps its port', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await s3Host(base({ fetch: f.fetch, endpoint: 'http://127.0.0.1:9000' })).put(
      'a/b.js',
      'x',
      opts,
    );
    expect(f.calls[0]?.url).toBe('http://127.0.0.1:9000/my-registry/a/b.js');
  });

  it('honours forcePathStyle on AWS and virtual-host on a custom endpoint', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await s3Host(base({ fetch: f.fetch, forcePathStyle: true })).put('k', 'x', opts);
    await s3Host(
      base({
        fetch: f.fetch,
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        forcePathStyle: false,
      }),
    ).put('k', 'x', opts);
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://s3.eu-west-1.amazonaws.com/my-registry/k',
      'https://my-registry.acct.r2.cloudflarestorage.com/k',
    ]);
  });

  it('percent-encodes odd characters in keys', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await s3Host(base({ fetch: f.fetch })).put('a b/c!d.js', 'x', opts);
    expect(f.calls[0]?.url).toContain('/a%20b/c%21d.js');
  });

  it('keeps a path on the endpoint', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await s3Host(base({ fetch: f.fetch, endpoint: 'https://gw.example.com/s3/' })).get('k');
    expect(f.calls[0]?.url).toBe('https://gw.example.com/s3/my-registry/k');
  });
});

describe('s3Host put', () => {
  it('signs and sends the cache and content headers and the body', async () => {
    const f = fakeFetch(() => new Response('', { status: 200, headers: { etag: '"e1"' } }));
    const result = await s3Host(base({ fetch: f.fetch })).put('envs/prod/index.json', '{}', opts);
    const call = f.calls[0];
    expect(result).toEqual({ etag: '"e1"' });
    expect(call?.method).toBe('PUT');
    expect(call?.headers['content-type']).toBe('application/json');
    expect(call?.headers['cache-control']).toBe('public, max-age=60');
    expect(call?.headers['x-amz-content-sha256']).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
    expect(call?.headers['if-match']).toBeUndefined();
    expect(call?.headers['x-amz-date']).toBe('20261101T100000Z');
    expect(call?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261101\/eu-west-1\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(new TextDecoder().decode(call?.body)).toBe('{}');
  });

  it('sends If-Match, signed, and includes the session token', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await s3Host(base({ fetch: f.fetch, sessionToken: TOKEN })).put('i', '{}', {
      ...opts,
      ifMatch: '"e1"',
    });
    const call = f.calls[0];
    expect(call?.headers['if-match']).toBe('"e1"');
    expect(call?.headers['x-amz-security-token']).toBe(TOKEN);
    expect(call?.headers.authorization).toContain('if-match;');
    expect(call?.headers.authorization).toContain('x-amz-security-token');
  });

  it('turns a 412 into a PreconditionFailedError that says what to do', async () => {
    const f = fakeFetch(
      () => new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 }),
    );
    const put = s3Host(base({ fetch: f.fetch })).put('envs/prod/index.json', '{}', {
      ...opts,
      ifMatch: '"old"',
    });
    await expect(put).rejects.toBeInstanceOf(PreconditionFailedError);
    await expect(put).rejects.toThrow(/envs\/prod\/index\.json changed since it was read.*retry/);
  });

  it('reports other failures with the S3 code and message only', async () => {
    const xml =
      '<Error><Code>AccessDenied</Code><Message>Access Denied</Message><RequestId>r</RequestId></Error>';
    const f = fakeFetch(() => new Response(xml, { status: 403 }));
    const error = await s3Host(base({ fetch: f.fetch }))
      .put('k', 'x', opts)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccessDeniedError);
    expect((error as HostError).message).toContain(
      'PUT k was denied (HTTP 403) (AccessDenied: Access Denied)',
    );
    expect((error as HostError).message).toContain('s3:PutObject');
    expect((error as HostError).status).toBe(403);
  });

  it('rejects an unsafe key before any request', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await expect(s3Host(base({ fetch: f.fetch })).put('../x', 'x', opts)).rejects.toThrow(
      /unsafe key/,
    );
    expect(f.calls).toHaveLength(0);
  });
});

describe('s3Host conditional writes and integrity', () => {
  it('sends If-None-Match and the content hash as metadata', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await s3Host(base({ fetch: f.fetch })).put('a.js', 'x', {
      ...opts,
      ifNoneMatch: '*',
      sha256: 'abc123',
    });
    const call = f.calls[0];
    expect(call?.headers['if-none-match']).toBe('*');
    expect(call?.headers['x-amz-meta-sha256']).toBe('abc123');
    expect(call?.headers.authorization).toContain('if-none-match');
    expect(call?.headers.authorization).toContain('x-amz-meta-sha256');
  });

  it('reads the content hash back on head', async () => {
    const f = fakeFetch(
      () => new Response('', { status: 200, headers: { 'x-amz-meta-sha256': 'abc123' } }),
    );
    expect((await s3Host(base({ fetch: f.fetch })).head('a.js'))?.sha256).toBe('abc123');
  });

  it.each([
    ['412', 412, undefined],
    ['409 ConditionalRequestConflict', 409, undefined],
    ['404 on If-Match for a missing key', 404, '"e"'],
  ])('maps %s to PreconditionFailedError', async (_name, status, ifMatch) => {
    const f = fakeFetch(() => new Response('<Error><Code>X</Code></Error>', { status }));
    const put = s3Host(base({ fetch: f.fetch })).put('envs/prod/index.json', '{}', {
      ...opts,
      ...(ifMatch === undefined ? {} : { ifMatch }),
    });
    await expect(put).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('says the bucket is missing when If-Match meets NoSuchBucket', async () => {
    const f = fakeFetch(
      () => new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404 }),
    );
    const put = s3Host(base({ fetch: f.fetch })).put('i', '{}', { ...opts, ifMatch: '"e"' });
    await expect(put).rejects.toThrow('bucket "my-registry" does not exist');
    await expect(put).rejects.not.toBeInstanceOf(PreconditionFailedError);
  });

  it('does not call a plain 404 on put a precondition failure', async () => {
    const f = fakeFetch(() => new Response('', { status: 404 }));
    await expect(s3Host(base({ fetch: f.fetch })).put('k', 'x', opts)).rejects.toThrow(
      'PUT k failed with HTTP 404',
    );
  });
});

describe('s3Host 403', () => {
  it('on get and head names the permissions instead of guessing the key is missing', async () => {
    const f = fakeFetch(
      () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
    );
    const host = s3Host(base({ fetch: f.fetch }));
    for (const read of [host.get('k'), host.head('k')]) {
      const error = await read.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect((error as Error).message).toContain('s3:GetObject and s3:ListBucket');
      expect((error as Error).message).toContain('a missing key also answers 403');
    }
  });
});

describe('s3Host response bodies', () => {
  it('cancels the body of responses it does not read', async () => {
    let cancelled = 0;
    const body = () =>
      new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancelled += 1;
        },
      });
    const statuses = [200, 404, 412];
    const f = fakeFetch(() => new Response(body(), { status: statuses.shift() ?? 200 }));
    const host = s3Host(base({ fetch: f.fetch }));
    await host.put('a', 'x', opts);
    expect(await host.head('a')).toBeUndefined();
    await expect(host.put('b', 'x', opts)).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(cancelled).toBe(3);
  });
});

describe('s3Host redaction', () => {
  it('never puts credentials in an error, even when the store echoes them', async () => {
    const xml = `<Error><Code>Bad</Code><Message>key AKIDEXAMPLE secret ${SECRET} token ${TOKEN}</Message></Error>`;
    const f = fakeFetch(() => new Response(xml, { status: 400 }));
    const host = s3Host(base({ fetch: f.fetch, sessionToken: TOKEN }));
    const error = await host.get('k').catch((e: unknown) => e);
    const text = (error as Error).message;
    for (const secret of [SECRET, TOKEN, 'AKIDEXAMPLE']) expect(text).not.toContain(secret);
    expect(text).toContain('***');
  });

  it('redacts a network error that carries a secret', async () => {
    const f = fakeFetch(() => new Error(`connect failed for ${SECRET}`));
    const error = await s3Host(base({ fetch: f.fetch }))
      .head('k')
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe('HEAD failed: connect failed for ***');
  });
});

describe('s3Host get, head and list', () => {
  it('returns the body and ETag, and undefined on 404', async () => {
    const f = fakeFetch((c) =>
      c.url.endsWith('/there')
        ? new Response('hello', { status: 200, headers: { etag: '"h"' } })
        : new Response('', { status: 404 }),
    );
    const host = s3Host(base({ fetch: f.fetch }));
    const got = await host.get('there');
    expect(new TextDecoder().decode(got?.body)).toBe('hello');
    expect(got?.etag).toBe('"h"');
    expect(await host.get('gone')).toBeUndefined();
    expect(f.calls[0]?.headers.authorization).toBeDefined();
  });

  it('heads size and ETag, undefined on 404, and an error on 500', async () => {
    const f = fakeFetch((c) =>
      c.url.endsWith('/there')
        ? new Response('', { status: 200, headers: { etag: '"h"', 'content-length': '12' } })
        : c.url.endsWith('/gone')
          ? new Response('', { status: 404 })
          : new Response('', { status: 500 }),
    );
    const host = s3Host(base({ fetch: f.fetch }));
    expect(await host.head('there')).toEqual({ etag: '"h"', size: 12 });
    expect(await host.head('gone')).toBeUndefined();
    await expect(host.head('boom')).rejects.toThrow('HEAD boom failed with HTTP 500');
    await expect(host.get('boom')).rejects.toThrow('GET boom failed with HTTP 500');
  });

  it('lists across pages with a prefix', async () => {
    const pages = [
      '<ListBucketResult><Key>cart/a.js</Key><Key>cart/b&amp;c.js</Key><NextContinuationToken>t1/+</NextContinuationToken></ListBucketResult>',
      '<ListBucketResult><Key>cart/d.js</Key></ListBucketResult>',
    ];
    const f = fakeFetch(() => new Response(pages.shift() ?? '', { status: 200 }));
    const keys = await s3Host(base({ fetch: f.fetch })).list?.('cart/');
    expect(keys).toEqual(['cart/a.js', 'cart/b&c.js', 'cart/d.js']);
    expect(f.calls[0]?.url).toBe(
      'https://my-registry.s3.eu-west-1.amazonaws.com/?list-type=2&prefix=cart%2F',
    );
    expect(f.calls[1]?.url).toContain('continuation-token=t1%2F%2B');
  });

  it('fails a list the store refuses', async () => {
    const f = fakeFetch(() => new Response('', { status: 403 }));
    await expect(s3Host(base({ fetch: f.fetch })).list?.('')).rejects.toThrow(
      'LIST  was denied (HTTP 403)',
    );
  });
});

describe('s3Host defaults', () => {
  it('uses the global fetch and the clock when none are given', async () => {
    const original = globalThis.fetch;
    let seen = '';
    globalThis.fetch = ((url: string) => {
      seen = url;
      return Promise.resolve(new Response('', { status: 404 }));
    }) as typeof fetch;
    try {
      const { now: _now, ...rest } = base();
      expect(await s3Host(rest).head('k')).toBeUndefined();
      expect(seen).toBe('https://my-registry.s3.eu-west-1.amazonaws.com/k');
    } finally {
      globalThis.fetch = original;
    }
  });
});
