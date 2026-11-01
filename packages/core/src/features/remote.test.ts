import { describe, expect, it } from 'vitest';
import { rejection } from '../testing';
import {
  fetchFeatureIndex,
  fetchRemoteText,
  checkIntegrity,
  getHttps,
  indexedVersion,
  integrityOf,
  registryUrl,
  type FetchLike,
  type FetchResponse,
} from './remote';

const registries = { '@acme': 'https://acme.example/{name}.json' };
const encoder = new TextEncoder();

interface Streamed {
  response: FetchResponse;
  pulled: () => number;
  cancelled: () => boolean;
}

/** A response whose body is `chunks`, counting how many were pulled and whether the reader gave up. */
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}): Streamed {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulled];
      pulled += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const response: FetchResponse = {
    ok: true,
    status: 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body,
    text: () => Promise.reject(new Error('text() must not be used when a body is available')),
  };
  return { response, pulled: () => pulled, cancelled: () => cancelled };
}

const fetching =
  (response: FetchResponse): FetchLike =>
  () =>
    Promise.resolve(response);
const get = (response: FetchResponse) =>
  fetchRemoteText('@acme/segment', registries, fetching(response));

describe('fetchRemoteText size cap', () => {
  it('reads a small body from the stream', async () => {
    const { response } = streamed([encoder.encode('{"a":'), encoder.encode('1}')]);
    expect(await get(response)).toBe('{"a":1}');
  });

  it('decodes a multi-byte character split across chunks', async () => {
    const bytes = encoder.encode('€');
    const { response } = streamed([bytes.slice(0, 1), bytes.slice(1)]);
    expect(await get(response)).toBe('€');
  });

  it('refuses from content-length alone, without reading the body', async () => {
    const { response, pulled, cancelled } = streamed([encoder.encode('x')], {
      'content-length': '2000000',
    });
    expect((await rejection(get(response))).code).toBe('MFEFLOW_E402');
    expect(pulled()).toBeLessThanOrEqual(1);
    expect(cancelled()).toBe(true);
  });

  it('counts bytes, not characters: 400k euro signs are 1.2 MB', async () => {
    const chunk = encoder.encode('€'.repeat(100_000));
    const { response, pulled, cancelled } = streamed(Array.from({ length: 8 }, () => chunk));
    expect('€'.repeat(400_000).length).toBeLessThan(1_000_000);
    const error = await rejection(get(response));
    expect(error.code).toBe('MFEFLOW_E402');
    expect(cancelled()).toBe(true);
    expect(pulled()).toBeLessThanOrEqual(6);
  });

  it('stops reading as soon as the cap is passed, whatever content-length said', async () => {
    const chunk = new Uint8Array(400_000).fill(120);
    const { response, pulled, cancelled } = streamed(
      Array.from({ length: 50 }, () => chunk),
      { 'content-length': '10' },
    );
    expect((await rejection(get(response))).code).toBe('MFEFLOW_E402');
    expect(cancelled()).toBe(true);
    expect(pulled()).toBeLessThan(10);
  });

  it('accepts a body of exactly the cap', async () => {
    const { response } = streamed([new Uint8Array(1_000_000).fill(32)]);
    expect((await get(response)).length).toBe(1_000_000);
  });

  it('falls back to text() for a response without a body, counting bytes there too', async () => {
    const text = '€'.repeat(400_000);
    const response: FetchResponse = { ok: true, status: 200, text: () => Promise.resolve(text) };
    expect((await rejection(get(response))).code).toBe('MFEFLOW_E402');
  });
});

describe('fetchRemoteText redirects', () => {
  const redirect = (location: string | null): FetchResponse => ({
    ok: false,
    status: 302,
    headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) },
    text: () => Promise.resolve(''),
  });
  const ok = (text: string): FetchResponse => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
  });
  const script = (...replies: FetchResponse[]) => {
    const asked: { url: string; redirect: unknown }[] = [];
    const fetch: FetchLike = (url, init) => {
      asked.push({ url, redirect: init?.redirect });
      const reply = replies[asked.length - 1];
      return reply ? Promise.resolve(reply) : Promise.reject(new Error('unexpected request'));
    };
    return { fetch, asked };
  };

  it('follows a redirect that stays on https, asking for each hop by hand', async () => {
    const { fetch, asked } = script(redirect('/moved.json'), ok('{"a":1}'));
    expect(await fetchRemoteText('@acme/segment', registries, fetch)).toBe('{"a":1}');
    expect(asked).toEqual([
      { url: 'https://acme.example/segment.json', redirect: 'manual' },
      { url: 'https://acme.example/moved.json', redirect: 'manual' },
    ]);
  });

  it('refuses a redirect to http (E401) without ever requesting it', async () => {
    const { fetch, asked } = script(redirect('http://evil.example/x.json'), ok('{}'));
    const error = await rejection(fetchRemoteText('@acme/segment', registries, fetch));
    expect(error.code).toBe('MFEFLOW_E401');
    expect(error.message).toContain('not https');
    expect(asked).toHaveLength(1);
  });

  it('refuses a redirect with no address and one that never ends (E401)', async () => {
    const none = script(redirect(null));
    expect((await rejection(fetchRemoteText('@acme/s', registries, none.fetch))).message).toContain(
      'no address',
    );
    const hop = redirect('https://acme.example/again');
    const loop = script(hop, hop, hop, hop, hop, hop, hop);
    expect((await rejection(fetchRemoteText('@acme/s', registries, loop.fetch))).message).toContain(
      'too many',
    );
  });
});

describe('plain http on the machine you are on', () => {
  const local = { '@test': 'http://127.0.0.1:4010/{name}.json' };
  const redirect = (location: string): FetchResponse => ({
    ok: false,
    status: 302,
    headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) },
    text: () => Promise.resolve(''),
  });
  const ok = (body: string): FetchResponse => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
  });
  const script = (...replies: FetchResponse[]) => {
    const asked: string[] = [];
    const fetch: FetchLike = (url) => {
      asked.push(url);
      const reply = replies[asked.length - 1];
      return reply ? Promise.resolve(reply) : Promise.reject(new Error('unexpected request'));
    };
    return { fetch, asked };
  };

  it.each(['http://127.0.0.1:4010', 'http://localhost:4010', 'http://[::1]:4010'])(
    'fetches from %s',
    async (origin) => {
      const { fetch, asked } = script(ok('{"a":1}'));
      const registry = { '@test': `${origin}/{name}.json` };
      expect(await fetchRemoteText('@test/hello', registry, fetch, undefined, true)).toBe(
        '{"a":1}',
      );
      expect(asked).toEqual([`${origin}/hello.json`]);
    },
  );

  it.each([
    'http://example.com/{name}.json',
    'http://127.0.0.1.nip.io/{name}.json',
    'http://localhost@evil.com/{name}.json',
    'http://localhost.evil.com/{name}.json',
    'http://192.168.1.5/{name}.json',
  ])('still refuses %s without asking the network', async (template) => {
    const { fetch, asked } = script(ok('{}'));
    const error = await rejection(fetchRemoteText('@test/hello', { '@test': template }, fetch));
    expect(error.code).toBe('MFEFLOW_E401');
    expect(error.message).toContain('not https');
    expect(asked).toEqual([]);
  });

  it('lets a loopback registry redirect within loopback and to https', async () => {
    const within = script(redirect('http://localhost:4010/moved.json'), ok('{}'));
    await fetchRemoteText('@test/hello', local, within.fetch, undefined, true);
    expect(within.asked[1]).toBe('http://localhost:4010/moved.json');
    const up = script(redirect('https://cdn.example/hello.json'), ok('{}'));
    await fetchRemoteText('@test/hello', local, up.fetch, undefined, true);
    expect(up.asked[1]).toBe('https://cdn.example/hello.json');
  });

  it('refuses a loopback registry that redirects to another plain http host', async () => {
    const { fetch, asked } = script(redirect('http://example.com/hello.json'), ok('{}'));
    const error = await rejection(fetchRemoteText('@test/hello', local, fetch, undefined, true));
    expect(error.message).toContain('not https');
    expect(asked).toHaveLength(1);
  });

  it('refuses an https registry that redirects to the machine it runs on', async () => {
    const { fetch, asked } = script(redirect('http://127.0.0.1:6379/'), ok('{}'));
    const error = await rejection(fetchRemoteText('@acme/segment', registries, fetch));
    expect(error.message).toContain('not https');
    expect(asked).toHaveLength(1);
  });

  it('refuses an answer that ended up off the allowed hosts', async () => {
    const { fetch } = script({ ...ok('{}'), url: 'http://example.com/x' });
    expect(
      (await rejection(fetchRemoteText('@test/hello', local, fetch, undefined, true))).message,
    ).toContain('ended up at');
    const garbled = script({ ...ok('{}'), url: 'not a url' });
    expect(
      (await rejection(fetchRemoteText('@test/hello', local, garbled.fetch, undefined, true))).code,
    ).toBe('MFEFLOW_E401');
  });

  it('keeps other callers on https: loopback http is off unless asked for', async () => {
    const { fetch, asked } = script(ok('{}'), ok('{}'));
    const url = 'http://127.0.0.1:4010/preset.json';
    const refused = await rejection(
      getHttps('https://example.com/p.json', script(redirect(url)).fetch, 'E109'),
    );
    expect(refused.code).toBe('MFEFLOW_E109');
    await getHttps(url, fetch, 'E109', { loopback: true });
    expect(asked).toEqual([url]);
  });

  it('puts the version into the URL', () => {
    expect(
      registryUrl('@test/hello', { '@test': 'http://localhost/{name}/{version}.json' }, '1.2.0'),
    ).toBe('http://localhost/hello/1.2.0.json');
  });
});

describe('fetchFeatureIndex', () => {
  const index = { items: [{ name: 'hello', version: '1.0.0', description: 'Says hello' }] };
  const reply = (status: number, body: string): FetchLike => {
    return () => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(body) });
  };
  const where: string[] = [];
  const asking: FetchLike = (url) => {
    where.push(url);
    return reply(200, JSON.stringify(index))(url);
  };

  it('asks for index.json in the folder the template starts in', async () => {
    expect(await fetchFeatureIndex('@acme', registries, asking)).toEqual(index.items);
    expect(where).toEqual(['https://acme.example/index.json']);
  });

  it('is E210 for a namespace that is not configured, E401 for a template that cannot be used', async () => {
    expect((await rejection(fetchFeatureIndex('@nope', registries, asking))).code).toBe(
      'MFEFLOW_E210',
    );
    const bad = await rejection(
      fetchFeatureIndex('@acme', { '@acme': 'http://acme.example/{name}.json' }, asking),
    );
    expect(bad.code).toBe('MFEFLOW_E401');
    expect(bad.message).toContain('must be https');
  });

  it('is E401 for a missing index and a network failure, with a hint for a 404', async () => {
    const missing = await rejection(fetchFeatureIndex('@acme', registries, reply(404, '')));
    expect(missing.code).toBe('MFEFLOW_E401');
    expect(missing.message).toContain('no index.json');
    const down = await rejection(
      fetchFeatureIndex('@acme', registries, () => Promise.reject(new Error('ECONNREFUSED'))),
    );
    expect(down.message).toContain('ECONNREFUSED');
  });

  it('is E403 for text that is not JSON, not an index, or too big', async () => {
    const html = await rejection(fetchFeatureIndex('@acme', registries, reply(200, '<html>')));
    expect(html.code).toBe('MFEFLOW_E403');
    const escape = await rejection(fetchFeatureIndex('@acme', registries, reply(200, '\u001b[2J')));
    expect(escape.message).not.toMatch(/\p{Cc}/u);
    const shape = await rejection(
      fetchFeatureIndex(
        '@acme',
        registries,
        reply(200, JSON.stringify({ items: [{ name: 'X' }, { name: 'Y' }] })),
      ),
    );
    expect(shape.code).toBe('MFEFLOW_E403');
    expect(shape.message).toContain('items[0].name');
    expect(shape.message).toContain('more');
    const big = await rejection(
      fetchFeatureIndex('@acme', registries, reply(200, 'x'.repeat(1_000_001))),
    );
    expect(big.message).toContain('larger than 1 MB');
  });
});

describe('private addresses need a trusted registry', () => {
  const ok = (body: string): FetchResponse => ({
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
  });
  const never: FetchLike = () => Promise.reject(new Error('the network must not be asked'));

  it.each([
    'http://127.0.0.1:4010',
    'http://localhost:4010',
    'http://[::1]:4010',
    'https://10.0.0.5',
    'https://172.20.1.1',
    'https://192.168.1.5',
    'https://169.254.169.254',
    'https://[fd00::1]',
    'https://registry.localhost',
  ])('does not request %s until it is trusted', async (origin) => {
    const registry = { '@test': `${origin}/{name}.json` };
    const error = await rejection(fetchRemoteText('@test/hello', registry, never));
    expect(error.code).toBe('MFEFLOW_E405');
    const index = await rejection(fetchFeatureIndex('@test', registry, never));
    expect(index.code).toBe('MFEFLOW_E405');
  });

  it('requests a private address once it is trusted', async () => {
    const registry = { '@test': 'https://192.168.1.5/{name}.json' };
    const text = await fetchRemoteText(
      '@test/hello',
      registry,
      () => Promise.resolve(ok('{}')),
      undefined,
      true,
    );
    expect(text).toBe('{}');
  });

  it('refuses a public registry that redirects to a private address, and asks no further', async () => {
    const asked: string[] = [];
    const fetch: FetchLike = (url) => {
      asked.push(url);
      return Promise.resolve({
        ok: false,
        status: 302,
        headers: { get: () => 'https://169.254.169.254/latest/meta-data' },
        text: () => Promise.resolve(''),
      });
    };
    const error = await rejection(fetchRemoteText('@acme/segment', registries, fetch));
    expect(error.code).toBe('MFEFLOW_E405');
    expect(asked).toHaveLength(1);
  });
});

describe('integrity and the index version', () => {
  it('hashes the exact text that was served', () => {
    expect(integrityOf('a')).toBe(
      'sha256-ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
    );
    expect(integrityOf('a')).not.toBe(integrityOf('a '));
  });

  const was = integrityOf('one');
  const now = integrityOf('two');

  it('passes when the served bytes match the recorded hash', () => {
    expect(checkIntegrity('@acme/segment', was, was, false)).toBe(false);
  });

  it('is E406 when the registry now serves other bytes, naming both hashes', async () => {
    const error = await rejection(
      Promise.resolve().then(() => checkIntegrity('@acme/segment', was, now, false)),
    );
    expect(error.code).toBe('MFEFLOW_E406');
    expect(error.message).toContain(was);
    expect(error.message).toContain(now);
  });

  it('takes the change when it is accepted, and says it changed', () => {
    expect(checkIntegrity('@acme/segment', was, now, true)).toBe(true);
  });

  const index = { items: [{ name: 'segment', version: '1.2.0', description: 'Segment' }] };
  const serving =
    (status: number, body: string): FetchLike =>
    () =>
      Promise.resolve({ ok: status === 200, status, text: () => Promise.resolve(body) });

  it('reads the version the index lists for a feature', async () => {
    const listed = await indexedVersion(
      '@acme',
      'segment',
      registries,
      serving(200, JSON.stringify(index)),
    );
    expect(listed).toBe('1.2.0');
    const other = await indexedVersion(
      '@acme',
      'other',
      registries,
      serving(200, JSON.stringify(index)),
    );
    expect(other).toBeUndefined();
  });

  it('answers undefined for a registry without an index, and still fails for a broken one', async () => {
    expect(await indexedVersion('@acme', 'segment', registries, serving(404, ''))).toBeUndefined();
    const error = await rejection(indexedVersion('@acme', 'segment', registries, serving(500, '')));
    expect(error.code).toBe('MFEFLOW_E401');
  });
});

describe('secrets in URLs stay out of errors', () => {
  const secret = { '@acme': 'https://acme.example/{name}.json?token=hunter2&v=1' };
  const notFound: FetchLike = () =>
    Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });

  it('hides a token when the registry answers with an error', async () => {
    const error = await rejection(fetchRemoteText('@acme/segment', secret, notFound));
    expect(error.message).toContain('token=***');
    expect(error.message).not.toContain('hunter2');
  });

  it('hides a token when the connection fails or the index is missing', async () => {
    const down = await rejection(
      fetchRemoteText('@acme/segment', secret, () => Promise.reject(new Error('ECONNREFUSED'))),
    );
    expect(down.message).not.toContain('hunter2');
    const missing = await rejection(fetchFeatureIndex('@acme', secret, notFound));
    expect(missing.message).not.toContain('hunter2');
  });
});
