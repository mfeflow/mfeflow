import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createUrlFactory, defineEndpoints } from '@mfeflow/url-factory';
import { createHttpClient, HttpError, isHttpError } from '.';

const endpoints = defineEndpoints({
  health: { service: 'api', path: '/health' },
  listProducts: { service: 'api', path: '/products' },
  getProduct: { service: 'api', path: '/products/:sku' },
  addOrder: { service: 'api', path: '/orders' },
  setOrder: { service: 'api', path: '/orders/:id' },
});

const BASE = 'https://api.test';
const url = createUrlFactory(endpoints, () => BASE);
const fast = { retries: 2, baseDelayMs: 1, maxDelayMs: 5 };

interface Product {
  sku: string;
  name: string;
}

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});

const api = createHttpClient<typeof endpoints, { getProduct: Product; listProducts: Product[] }>({
  url,
  retry: fast,
});

describe('reading JSON', () => {
  it('returns the parsed body and builds the URL from the endpoint', async () => {
    let seen = '';
    server.use(
      http.get(`${BASE}/products/:sku`, ({ request, params }) => {
        seen = `${String(params.sku)}${new URL(request.url).search}`;
        return HttpResponse.json({ sku: 'A1', name: 'Mug' });
      }),
    );
    const product = await api.get('getProduct', { params: { sku: 'A1' }, query: { ref: 'home' } });
    expect(product).toEqual({ sku: 'A1', name: 'Mug' });
    expect(seen).toBe('A1?ref=home');
    expectTypeOf(product).toEqualTypeOf<Product>();
  });

  it('lets parse check the body and set the type', async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.json({ ok: true })));
    const ok = await api.get('health', {
      parse: (raw) => {
        if (typeof raw !== 'object' || raw === null || Reflect.get(raw, 'ok') !== true)
          throw new TypeError('not healthy');
        return true as const;
      },
    });
    expectTypeOf(ok).toEqualTypeOf<true>();
    expect(ok).toBe(true);
  });

  it('answers unknown for an endpoint with no declared response', async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.json({ ok: true })));
    expectTypeOf(await api.get('health')).toEqualTypeOf<unknown>();
  });

  it('returns undefined for an empty body and for 204', async () => {
    server.use(
      http.get(`${BASE}/health`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/products/:sku`, () => new HttpResponse('', { status: 200 })),
    );
    expect(await api.get('health')).toBeUndefined();
    expect(await api.delete('getProduct', { params: { sku: 'A1' } })).toBeUndefined();
  });

  it('throws a parse error, with the status, for a body that is not JSON', async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.text('<html>oops</html>')));
    const error = await api.get('health').catch((e: unknown) => e);
    expect(isHttpError(error)).toBe(true);
    expect(error).toMatchObject({ kind: 'parse', status: 200, endpoint: 'health', method: 'GET' });
    expect((error as Error).message).not.toContain('oops');
  });

  it('exposes the raw response for streams and files', async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.text('plain')));
    const response = await api.response('get', 'health');
    expect(await response.text()).toBe('plain');
  });
});

describe('writing JSON', () => {
  it('sends the body as JSON with a content type, and never retries a POST', async () => {
    const received: unknown[] = [];
    server.use(
      http.post(`${BASE}/orders`, async ({ request }) => {
        received.push(await request.json(), request.headers.get('content-type'));
        return HttpResponse.json({ error: 'busy' }, { status: 503 });
      }),
    );
    const error = await api.post('addOrder', { json: { sku: 'A1' } }).catch((e: unknown) => e);
    expect(received).toEqual([{ sku: 'A1' }, 'application/json']);
    expect(error).toMatchObject({ status: 503, attempts: 1 });
  });

  it('puts, patches and deletes with path params', async () => {
    const methods: string[] = [];
    server.use(
      http.all(`${BASE}/orders/:id`, ({ request, params }) => {
        methods.push(`${request.method} ${String(params.id)}`);
        return HttpResponse.json({ done: true });
      }),
    );
    await api.put('setOrder', { params: { id: 7 }, json: { a: 1 } });
    await api.patch('setOrder', { params: { id: 7 }, json: { a: 1 } });
    await api.delete('setOrder', { params: { id: 7 } });
    expect(methods).toEqual(['PUT 7', 'PATCH 7', 'DELETE 7']);
  });

  it('does not send a content type without a body', async () => {
    let type: string | null = 'unset';
    server.use(
      http.get(`${BASE}/health`, ({ request }) => {
        type = request.headers.get('content-type');
        return HttpResponse.json({});
      }),
    );
    await api.get('health');
    expect(type).toBeNull();
  });
});

describe('the token and headers', () => {
  it('sends the bearer token, asked for on every attempt', async () => {
    const tokens = ['old', 'new'];
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/health`, ({ request }) => {
        seen.push(request.headers.get('authorization'));
        return seen.length === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ ok: true });
      }),
    );
    const authed = createHttpClient({
      url,
      retry: fast,
      getToken: () => Promise.resolve(tokens.shift()),
    });
    await authed.get('health');
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('sends no header for a signed-out visitor, and lets a request set its own', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/health`, ({ request }) => {
        seen.push(request.headers.get('authorization'), request.headers.get('x-trace'));
        return HttpResponse.json({});
      }),
    );
    const getToken = vi.fn(() => undefined);
    const anon = createHttpClient({ url, getToken, headers: { 'x-trace': 'client' } });
    await anon.get('health');
    await anon.get('health', { headers: { authorization: 'Basic abc', 'x-trace': 'request' } });
    expect(seen).toEqual([null, 'client', 'Basic abc', 'request']);
    expect(getToken).toHaveBeenCalledOnce();
  });
});

describe('errors', () => {
  it('carries the status and the parsed body, and leaves both out of the message', async () => {
    server.use(
      http.get(`${BASE}/products/:sku`, () =>
        HttpResponse.json(
          { error: 'no such product', email: 'jane@example.com' },
          { status: 404, statusText: 'Not Found' },
        ),
      ),
    );
    const error = await api
      .get('getProduct', { params: { sku: 'jane@example.com' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    const failure = error as HttpError;
    expect(failure).toMatchObject({
      kind: 'status',
      status: 404,
      method: 'GET',
      endpoint: 'getProduct',
      attempts: 1,
      body: { error: 'no such product', email: 'jane@example.com' },
    });
    expect(failure.message).toBe('GET getProduct answered 404 Not Found');
    expect(failure.headers?.get('content-type')).toContain('json');
  });

  it('keeps a text body, cut to 4096 characters', async () => {
    server.use(
      http.get(`${BASE}/health`, () => HttpResponse.text('x'.repeat(10_000), { status: 400 })),
    );
    const failure = (await api.get('health').catch((e: unknown) => e)) as HttpError;
    expect(String(failure.body)).toHaveLength(4096);
  });

  it('keeps the text when a JSON body is cut short', async () => {
    server.use(
      http.get(
        `${BASE}/health`,
        () =>
          new HttpResponse('{"a":', {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const failure = (await api.get('health').catch((e: unknown) => e)) as HttpError;
    expect(failure.body).toBe('{"a":');
  });

  it('reports a dropped connection as a network error with the cause', async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.error()));
    const failure = (await api
      .get('health', { retry: false })
      .catch((e: unknown) => e)) as HttpError;
    expect(failure).toMatchObject({ kind: 'network', status: undefined, attempts: 1 });
    expect(failure.message).toBe('GET health could not reach the server');
    expect(failure.cause).toBeDefined();
  });

  it('is an Error with a name, for logging', () => {
    const error = new HttpError({ kind: 'timeout', method: 'GET', endpoint: 'x', attempts: 3 });
    expect(error.name).toBe('HttpError');
    expect(error.message).toBe('GET x timed out');
    expect(isHttpError(new Error('x'))).toBe(false);
  });
});

describe('retries', () => {
  it.each([502, 503, 504, 429, 408])(
    'retries a GET that answers %i until it works',
    async (status) => {
      let calls = 0;
      server.use(
        http.get(`${BASE}/health`, () => {
          calls += 1;
          return calls < 3 ? new HttpResponse(null, { status }) : HttpResponse.json({ ok: true });
        }),
      );
      expect(await api.get('health')).toEqual({ ok: true });
      expect(calls).toBe(3);
    },
  );

  it('gives up after the configured retries and says how many it sent', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/health`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    const failure = (await api.get('health').catch((e: unknown) => e)) as HttpError;
    expect(calls).toBe(3);
    expect(failure).toMatchObject({ status: 503, attempts: 3 });
  });

  it.each([400, 401, 403, 404, 422, 500])('does not retry a %i', async (status) => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/health`, () => {
        calls += 1;
        return new HttpResponse(null, { status });
      }),
    );
    await api.get('health').catch(() => undefined);
    expect(calls).toBe(1);
  });

  it.each([
    ['POST', 'addOrder'],
    ['PATCH', 'setOrder'],
  ] as const)('never retries a %s', async (method, key) => {
    let calls = 0;
    server.use(
      http.all(`${BASE}/orders*`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    const request =
      method === 'POST'
        ? api.post('addOrder', { json: {} })
        : api.patch('setOrder', { params: { id: 1 }, json: {} });
    await request.catch(() => undefined);
    expect(calls).toBe(1);
    expect(key).toBeDefined();
  });

  it('retries PUT and DELETE, which are idempotent', async () => {
    let calls = 0;
    server.use(
      http.all(`${BASE}/orders/:id`, () => {
        calls += 1;
        return calls % 2 === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({});
      }),
    );
    await api.put('setOrder', { params: { id: 1 }, json: {} });
    await api.delete('setOrder', { params: { id: 1 } });
    expect(calls).toBe(4);
  });

  it('retries a dropped connection', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/health`, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.error() : HttpResponse.json({ ok: true });
      }),
    );
    expect(await api.get('health')).toEqual({ ok: true });
  });

  it('can be switched off for the client or for one call', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/health`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    await api.get('health', { retry: false }).catch(() => undefined);
    await createHttpClient({ url, retry: false })
      .get('health')
      .catch(() => undefined);
    expect(calls).toBe(2);
    await api.get('health', { retry: { ...fast, retries: 0 } }).catch(() => undefined);
    expect(calls).toBe(3);
  });

  it('waits for a short Retry-After and skips a long one', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/health`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 429, headers: { 'retry-after': '0' } });
      }),
      http.get(`${BASE}/products`, () => {
        calls += 100;
        return new HttpResponse(null, { status: 429, headers: { 'retry-after': '120' } });
      }),
    );
    await api.get('health').catch(() => undefined);
    expect(calls).toBe(3);
    const failure = (await api.get('listProducts').catch((e: unknown) => e)) as HttpError;
    expect(calls).toBe(103);
    expect(failure).toMatchObject({ status: 429, attempts: 1 });
  });

  it('backs off with growing, capped jitter', async () => {
    const { backoffMs } = await import('./retry');
    const options = { retries: 5, baseDelayMs: 100, maxDelayMs: 1000 };
    expect([0, 1, 2, 3, 4, 5].map((n) => backoffMs(n, options, () => 1))).toEqual([
      100, 200, 400, 800, 1000, 1000,
    ]);
    expect(backoffMs(3, options, () => 0)).toBe(0);
  });
});

describe('timeouts and cancelling', () => {
  it('times out a slow server with kind timeout, and retries it', async () => {
    let calls = 0;
    const slow = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        calls += 1;
        init.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason);
        });
      });
    const failure = (await createHttpClient({ url, fetch: slow, retry: fast })
      .get('health', { timeoutMs: 20 })
      .catch((e: unknown) => e)) as HttpError;
    expect(failure).toMatchObject({ kind: 'timeout', attempts: 3 });
    expect(failure.message).toBe('GET health timed out');
    expect(calls).toBe(3);
  });

  it('calls it a timeout whatever the fetch rejects with', async () => {
    const odd = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('terminated'));
        });
      });
    const failure = (await createHttpClient({ url, fetch: odd, retry: false })
      .get('health', { timeoutMs: 10 })
      .catch((e: unknown) => e)) as HttpError;
    expect(failure).toMatchObject({ kind: 'timeout', attempts: 1 });
  });

  it('rethrows the caller’s own abort untouched, without retrying', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/health`, async () => {
        calls += 1;
        await delay(500);
        return HttpResponse.json({});
      }),
    );
    const controller = new AbortController();
    const pending = api.get('health', { signal: controller.signal }).catch((e: unknown) => e);
    setTimeout(() => {
      controller.abort(new DOMException('navigated away', 'AbortError'));
    }, 20);
    const error = await pending;
    expect(isHttpError(error)).toBe(false);
    expect(error).toMatchObject({ name: 'AbortError', message: 'navigated away' });
    expect(calls).toBe(1);
  });

  it('stops waiting between retries when the caller aborts', async () => {
    server.use(http.get(`${BASE}/health`, () => new HttpResponse(null, { status: 503 })));
    const slow = createHttpClient({
      url,
      retry: { retries: 3, baseDelayMs: 60_000, maxDelayMs: 60_000 },
    });
    const controller = new AbortController();
    const pending = slow.get('health', { signal: controller.signal }).catch((e: unknown) => e);
    setTimeout(() => {
      controller.abort(new DOMException('stop', 'AbortError'));
    }, 30);
    expect(await pending).toMatchObject({ name: 'AbortError' });
  });
});

describe('the timeout covers the headers, not the body', () => {
  const json = { 'content-type': 'application/json' };
  const text = (value: string) => new TextEncoder().encode(value);

  it('lets a body that streams slowly finish after the headers arrived in time', async () => {
    const slow = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(text('{"a":'));
              await delay(80);
              controller.enqueue(text('1}'));
              controller.close();
            },
          }),
          { headers: json },
        ),
      ),
    );
    const client = createHttpClient({ url, fetch: slow });
    expect(await client.get('health', { timeoutMs: 30 })).toEqual({ a: 1 });
  });

  it('turns a body that breaks into an HttpError, not a raw error', async () => {
    const broken = vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new TypeError('terminated'));
            },
          }),
          { headers: json },
        ),
      ),
    );
    const failure = (await createHttpClient({ url, fetch: broken })
      .get('health')
      .catch((e: unknown) => e)) as HttpError;
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure).toMatchObject({ kind: 'network', status: 200, attempts: 1 });
    expect(failure.cause).toBeInstanceOf(TypeError);
  });

  it('reports the caller’s abort during the body as the caller’s reason', async () => {
    const hanging = (_url: string, init: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init.signal?.addEventListener('abort', () => {
                controller.error(init.signal?.reason);
              });
            },
          }),
          { headers: json },
        ),
      );
    const controller = new AbortController();
    const pending = createHttpClient({ url, fetch: hanging })
      .get('health', { signal: controller.signal })
      .catch((e: unknown) => e);
    setTimeout(() => {
      controller.abort(new DOMException('stop', 'AbortError'));
    }, 20);
    expect(await pending).toMatchObject({ name: 'AbortError', message: 'stop' });
  });
});

describe('the token provider', () => {
  it.each([
    [
      'throws',
      () => {
        throw new Error('no session');
      },
    ],
    ['rejects', () => Promise.reject(new Error('no session'))],
  ])(
    'failing when it %s is an auth error with the cause, and is not retried or sent',
    async (_how, getToken) => {
      const sent = vi.fn(() => Promise.resolve(HttpResponse.json({})));
      const client = createHttpClient({ url, fetch: sent, retry: fast, getToken });
      const failure = (await client.get('health').catch((e: unknown) => e)) as HttpError;
      expect(failure).toMatchObject({ kind: 'auth', attempts: 1, status: undefined });
      expect(failure.message).toBe('GET health could not get a token');
      expect((failure.cause as Error).message).toBe('no session');
      expect(sent).not.toHaveBeenCalled();
    },
  );
});

describe('header names', () => {
  it('are one header whatever the case, and the request wins over the client', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/health`, ({ request }) => {
        seen.push(request.headers.get('authorization'), request.headers.get('accept'));
        return HttpResponse.json({});
      }),
    );
    const client = createHttpClient({
      url,
      headers: { Authorization: 'Basic client', Accept: 'text/plain' },
      getToken: () => 'never-used',
    });
    await client.get('health', {
      headers: { authorization: 'Bearer request', accept: 'application/x-test' },
    });
    expect(seen).toEqual(['Bearer request', 'application/x-test']);
  });
});

describe('fetch', () => {
  it('uses the global fetch as it is at the time of each request', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(HttpResponse.json({ patched: true }));
    const late = createHttpClient({ url });
    expect(await late.get('health')).toEqual({ patched: true });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('starts the request in the caller’s tick unless the token is async, so a span around the call parents it', async () => {
    const custom = vi.fn(() => Promise.resolve(HttpResponse.json({})));
    const plain = createHttpClient({ url, fetch: custom, getToken: () => 'sync' });
    const pending = plain.get('health');
    expect(custom).toHaveBeenCalledOnce();
    await pending;
    const later = createHttpClient({
      url,
      fetch: custom,
      getToken: () => Promise.resolve('async'),
    });
    const waiting = later.get('health');
    expect(custom).toHaveBeenCalledOnce();
    await waiting;
    expect(custom).toHaveBeenCalledTimes(2);
  });

  it('takes a fetch of its own, and passes credentials', async () => {
    const custom = vi.fn(() => Promise.resolve(HttpResponse.json({ own: true })));
    const own = createHttpClient({ url, fetch: custom, credentials: 'include' });
    expect(await own.get('health')).toEqual({ own: true });
    expect(custom).toHaveBeenCalledWith(
      `${BASE}/health`,
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    await own.get('health', { credentials: 'omit' });
    expect(custom).toHaveBeenLastCalledWith(
      `${BASE}/health`,
      expect.objectContaining({ credentials: 'omit' }),
    );
  });
});

describe('types', () => {
  it('requires params for a path that has them', () => {
    // @ts-expect-error getProduct needs sku
    void api.get('getProduct').catch(() => undefined);
    // @ts-expect-error getProduct needs sku
    void api.get('getProduct', {}).catch(() => undefined);
    // @ts-expect-error no such endpoint
    void api.get('nope').catch(() => undefined);
    // @ts-expect-error a read has no body
    void api.get('health', { json: {} }).catch(() => undefined);
    expect(true).toBe(true);
  });
});
