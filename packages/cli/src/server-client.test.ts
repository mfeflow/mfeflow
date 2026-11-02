import { MfeflowError } from '@mfeflow/core';
import { describe, expect, it } from 'vitest';
import { testRuntime } from './testing';
import {
  errorCodeFor,
  normalizeServerUrl,
  ServerClient,
  ServerError,
  serverUrlOf,
} from './server-client';

const TOKEN = 'tok_super_secret_value';

describe('serverUrlOf', () => {
  it('takes the flag over the environment, and treats empty as unset', () => {
    expect(
      serverUrlOf({ 'registry-url': 'https://a.test' }, { MFEFLOW_REGISTRY_URL: 'https://b.test' }),
    ).toBe('https://a.test');
    expect(serverUrlOf({}, { MFEFLOW_REGISTRY_URL: 'https://b.test' })).toBe('https://b.test');
    expect(serverUrlOf({}, { MFEFLOW_REGISTRY_URL: '  ' })).toBeUndefined();
    expect(serverUrlOf({}, {})).toBeUndefined();
  });
});

describe('normalizeServerUrl', () => {
  it.each([
    ['https://registry.example.com/', 'https://registry.example.com'],
    ['https://registry.example.com/base//', 'https://registry.example.com/base'],
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787'],
    ['http://localhost:8787/', 'http://localhost:8787'],
  ])('accepts %s', (given, want) => {
    expect(normalizeServerUrl(given)).toBe(want);
  });

  it.each([
    'http://registry.example.com',
    'http://10.0.0.5:8787',
    'http://localhost.evil.com',
    'http://127.0.0.1.nip.io:8787',
    'http://[::ffff:7f00:1]:8787',
    'https://u:p@registry.example.com',
    'https://registry.example.com/?token=x',
    'https://registry.example.com/#x',
    'ftp://registry.example.com',
    'not a url',
  ])('refuses %s', (given) => {
    expect(() => normalizeServerUrl(given)).toThrow(/E506|registry server address/);
  });
});

describe('errorCodeFor', () => {
  it.each([
    [409, 'version_immutable', 'E511'],
    [422, 'artifact_missing', 'E509'],
    [404, 'not_deployed', 'E508'],
    [409, 'no_target', 'E508'],
    [404, 'no_rollout', 'E508'],
    [409, 'no_next_step', 'E508'],
    [409, 'conflict', 'E510'],
    [409, 'rollout_active', 'E510'],
    [409, 'killed', 'E510'],
    [409, 'route_overlap', 'E502'],
    [503, 'not_configured', 'E506'],
    [401, 'unauthorized', 'E506'],
    [403, 'forbidden', 'E506'],
    [500, 'internal_error', 'E506'],
    [429, 'rate_limited', 'E506'],
    [400, 'bad_request', 'E501'],
    [404, 'something_new', 'E508'],
    [409, 'something_new', 'E510'],
    [502, undefined, 'E506'],
  ])('%i %s -> %s', (status, code, want) => {
    expect(errorCodeFor(status, code)).toBe(want);
  });
});

const reply =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );

async function rejection(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('expected a rejection');
}

describe('ServerClient', () => {
  const client = (doFetch: typeof fetch, token: string | null = TOKEN) =>
    new ServerClient(
      'http://127.0.0.1:1',
      token ?? undefined,
      doFetch,
      token === null ? [] : [token],
    );

  describe('scrubError and guarded', () => {
    const c = client(() => Promise.reject(new Error('unused')));
    const rt = testRuntime();
    const thrown = async (value: unknown): Promise<unknown> => {
      try {
        await c.guarded(rt, () => Promise.reject(value));
      } catch (error) {
        return error;
      }
      throw new Error('expected a rejection');
    };

    it('scrubs the message, stack and fix of a catalogue error', async () => {
      const error = new MfeflowError('E508', `history ${TOKEN}`, { fix: `use ${TOKEN}` });
      error.stack = `stack ${TOKEN}`;
      const out = (await thrown(error)) as MfeflowError;
      expect([out.message, out.stack, out.fix].join('\n')).not.toContain(TOKEN);
    });

    it('scrubs the whole cause chain, and survives a cycle', async () => {
      const inner = new Error(`inner ${TOKEN}`);
      const outer = new Error('outer', { cause: new Error(`middle ${TOKEN}`, { cause: inner }) });
      inner.cause = outer;
      const out = (await thrown(outer)) as Error;
      const middle = out.cause as Error;
      expect(middle.message).not.toContain(TOKEN);
      expect((middle.cause as Error).message).not.toContain(TOKEN);
    });

    it('scrubs the errors inside an AggregateError', async () => {
      const aggregate = new AggregateError(
        [new Error(`a ${TOKEN}`), `b ${TOKEN}`],
        `many ${TOKEN}`,
      );
      const out = (await thrown(aggregate)) as AggregateError;
      expect(JSON.stringify([out.message, out.errors.map(String)])).not.toContain(TOKEN);
    });

    it('scrubs a thrown string and a thrown object', async () => {
      expect(await thrown(`plain ${TOKEN}`)).not.toContain(TOKEN);
      expect(JSON.stringify(await thrown({ detail: `obj ${TOKEN}` }))).not.toContain(TOKEN);
      expect(await thrown(42)).toBe(42);
    });
  });

  it('sends the token as a bearer header only', async () => {
    let seen: RequestInit | undefined;
    let seenUrl = '';
    const c = client(((url: string, init?: RequestInit) => {
      seenUrl = url;
      seen = init;
      return Promise.resolve(new Response('{"ok":true}'));
    }) as typeof fetch);
    await c.post('/v1/kill', { env: 'prod' });
    expect(seenUrl).not.toContain(TOKEN);
    expect(JSON.stringify(seen?.body)).not.toContain(TOKEN);
    expect(new Headers(seen?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(seen?.redirect).toBe('error');
  });

  it('scrubs the token from a network error', async () => {
    const c = client(() => Promise.reject(new Error(`boom ${TOKEN} boom`)));
    const failure = await rejection(c.run(() => c.post('/v1/kill', {})));
    expect(failure.message).toContain('cannot reach');
    expect(failure.message).not.toContain(TOKEN);
  });

  it('scrubs the token from a server message', async () => {
    const c = client(reply(401, { error: { code: 'unauthorized', message: `bad ${TOKEN}` } }));
    const failure = await rejection(c.run(() => c.post('/v1/kill', {})));
    expect(failure.message).not.toContain(TOKEN);
    expect(failure.message).toContain('***');
  });

  it('turns a page that is not a registry into E506', async () => {
    const c = client(reply(502, '<html>bad gateway</html>'));
    const failure = await rejection(c.run(() => c.index('prod')));
    expect(failure.message).toContain('answered HTTP 502');
  });

  it('passes gates_failed to the handler', async () => {
    const c = client(
      reply(422, {
        error: {
          code: 'gates_failed',
          message: 'refused',
          failures: [{ code: 'budget', message: 'too big' }],
        },
      }),
    );
    const out = await c.run(
      () => c.post('/v1/deploy', {}),
      (failure) => failure.failures?.map((f) => f.code),
    );
    expect(out).toEqual(['budget']);
  });

  it('wants a token for a write but not for the index', async () => {
    const c = client(reply(200, { remotes: [] }), null);
    await expect(c.post('/v1/kill', {})).rejects.toThrow(/MFEFLOW_REGISTRY_TOKEN/);
    expect(await c.index('prod')).toEqual({ remotes: [] });
  });

  it('turns a 404 index into undefined and other statuses into ServerError', async () => {
    expect(
      await client(reply(404, { error: { code: 'unknown_env', message: 'no' } })).index('x'),
    ).toBeUndefined();
    await expect(
      client(reply(500, { error: { code: 'internal_error', message: 'no' } })).get('/x'),
    ).rejects.toBeInstanceOf(ServerError);
  });
});
