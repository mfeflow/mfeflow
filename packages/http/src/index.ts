import type { Endpoints, PathParams, Query, UrlFactory } from '@mfeflow/url-factory';
import { HttpError } from './error';
import {
  backoffMs,
  canRetryMethod,
  canRetryStatus,
  DEFAULT_RETRY,
  retryAfterMs,
  sleep,
  type RetryOptions,
} from './retry';

export { HttpError, isHttpError, type HttpErrorKind } from './error';
export type { RetryOptions } from './retry';

const BODY_LIMIT = 4096;
const DEFAULT_TIMEOUT_MS = 10_000;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpClientOptions<E extends Endpoints> {
  /** The URL factory from `src/api/endpoints.ts`: it knows each service's base URL from the runtime config. */
  url: UrlFactory<E>;
  /**
   * The bearer token, asked for before every attempt so a refreshed token is picked up. Return
   * undefined for a signed-out visitor and no header is sent.
   */
  getToken?: () => string | undefined | Promise<string | undefined>;
  /** Sent with every request; a request's own headers win. */
  headers?: Record<string, string>;
  /** Per attempt, in ms. Default 10 000. */
  timeoutMs?: number;
  /** Set false to never retry. */
  retry?: RetryOptions | false;
  credentials?: RequestCredentials;
  /**
   * Defaults to the global `fetch`, looked up on every request, so instrumentation that wraps it
   * after this client was created (OpenTelemetry's trace headers) still applies.
   */
  fetch?: Fetch;
}

interface Extras<T> {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: RetryOptions | false;
  credentials?: RequestCredentials;
  /** Checks or reshapes the parsed body; its return type becomes the result type. */
  parse?: (raw: unknown) => T;
}

type ReadArgs<P extends string, T> = [PathParams<P>] extends [never]
  ? [options?: { query?: Query } & Extras<T>]
  : [
      options: {
        params: Readonly<Record<PathParams<P>, string | number>>;
        query?: Query;
      } & Extras<T>,
    ];

type WriteArgs<P extends string, T> = [PathParams<P>] extends [never]
  ? [options?: { query?: Query; json?: unknown } & Extras<T>]
  : [
      options: {
        params: Readonly<Record<PathParams<P>, string | number>>;
        query?: Query;
        json?: unknown;
      } & Extras<T>,
    ];

/** What each endpoint answers with, by endpoint key. Unlisted endpoints answer `unknown`. */
export type ResponseMap<E extends Endpoints> = Partial<Record<keyof E & string, unknown>>;

type ResponseOf<R, K> = K extends keyof R ? R[K] : unknown;

export interface HttpClient<E extends Endpoints, R extends ResponseMap<E> = ResponseMap<E>> {
  get: <K extends keyof E & string, T = ResponseOf<R, K>>(
    key: K,
    ...args: ReadArgs<E[K]['path'], T>
  ) => Promise<T>;
  post: <K extends keyof E & string, T = ResponseOf<R, K>>(
    key: K,
    ...args: WriteArgs<E[K]['path'], T>
  ) => Promise<T>;
  put: <K extends keyof E & string, T = ResponseOf<R, K>>(
    key: K,
    ...args: WriteArgs<E[K]['path'], T>
  ) => Promise<T>;
  patch: <K extends keyof E & string, T = ResponseOf<R, K>>(
    key: K,
    ...args: WriteArgs<E[K]['path'], T>
  ) => Promise<T>;
  delete: <K extends keyof E & string, T = ResponseOf<R, K>>(
    key: K,
    ...args: ReadArgs<E[K]['path'], T>
  ) => Promise<T>;
  /** The raw `Response` of a successful request, for streams and files. Errors still throw `HttpError`. */
  response: <K extends keyof E & string>(
    method: string,
    key: K,
    ...args: WriteArgs<E[K]['path'], unknown>
  ) => Promise<Response>;
}

interface Loose extends Extras<unknown> {
  params?: Readonly<Record<string, string | number>>;
  query?: Query;
  json?: unknown;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (text === '') return undefined;
  if (response.headers.get('content-type')?.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to the text
    }
  }
  return text.slice(0, BODY_LIMIT);
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

/**
 * A fetch client over your endpoints. Retries only idempotent methods (GET, HEAD, OPTIONS, PUT,
 * DELETE) on network errors, timeouts and 408, 425, 429, 502, 503, 504, with backoff. Trace headers
 * are not added here; `@mfeflow/telemetry` instruments `fetch` for that.
 *
 * ```ts
 * const api = createHttpClient<typeof endpoints, { listProducts: Product[] }>({ url: apiUrl });
 * const products = await api.get('listProducts', { query: { page: 1 } });
 * ```
 */
export function createHttpClient<E extends Endpoints, R extends ResponseMap<E> = ResponseMap<E>>(
  options: HttpClientOptions<E>,
): HttpClient<E, R> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the typed call is checked at the client's methods
  const urlFor = options.url as (key: string, args: unknown) => string;
  const doFetch: Fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  /** Headers for one attempt. Synchronous unless the token provider is async, so `fetch` runs in the caller's tick. */
  function headersFor(
    extra: Record<string, string> | undefined,
    hasBody: boolean,
  ): Headers | Promise<Headers> {
    const headers = new Headers({ accept: 'application/json', ...options.headers, ...extra });
    if (hasBody && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (headers.has('authorization') || !options.getToken) return headers;
    const withToken = (token: string | undefined): Headers => {
      if (token) headers.set('authorization', `Bearer ${token}`);
      return headers;
    };
    const token = options.getToken();
    return typeof token === 'object' ? token.then(withToken) : withToken(token);
  }

  async function attempt(
    method: string,
    key: string,
    url: string,
    request: Loose,
    count: number,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(
      request.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const hasBody = request.json !== undefined;
    try {
      const credentials = request.credentials ?? options.credentials;
      const headers = headersFor(request.headers, hasBody);
      return await doFetch(url, {
        method,
        headers: headers instanceof Headers ? headers : await headers,
        signal,
        ...(hasBody ? { body: JSON.stringify(request.json) } : {}),
        ...(credentials ? { credentials } : {}),
      });
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason;
      const timedOut = timeout.aborted && isAbort(error);
      throw new HttpError({
        kind: timedOut ? 'timeout' : 'network',
        method,
        endpoint: key,
        attempts: count,
        cause: error,
      });
    }
  }

  type Outcome =
    { ok: Response } | { failure: HttpError; retryable: boolean; asked: number | undefined };

  async function once(
    method: string,
    key: string,
    url: string,
    request: Loose,
    count: number,
  ): Promise<Outcome> {
    let response: Response;
    try {
      response = await attempt(method, key, url, request, count);
    } catch (error) {
      if (error instanceof HttpError) return { failure: error, retryable: true, asked: undefined };
      throw error;
    }
    if (response.ok) return { ok: response };
    const failure = new HttpError(
      {
        kind: 'status',
        method,
        endpoint: key,
        status: response.status,
        body: await readBody(response),
        headers: response.headers,
        attempts: count,
      },
      response.statusText,
    );
    return {
      failure,
      retryable: canRetryStatus(response.status),
      asked: retryAfterMs(response.headers),
    };
  }

  async function send(
    method: string,
    key: string,
    request: Loose,
  ): Promise<{ response: Response; attempts: number }> {
    const url = urlFor(key, { params: request.params, query: request.query });
    const setting = request.retry ?? options.retry;
    const policy: Required<RetryOptions> | undefined =
      setting === false || !canRetryMethod(method) ? undefined : { ...DEFAULT_RETRY, ...setting };
    /* oxlint-disable no-await-in-loop -- attempts are sequential on purpose */
    for (let count = 1; ; count++) {
      const outcome = await once(method, key, url, request, count);
      if ('ok' in outcome) return { response: outcome.ok, attempts: count };
      if (!policy || count > policy.retries || !outcome.retryable) throw outcome.failure;
      // A server that wants longer than we are willing to wait gets its error now, not a second 429.
      if (outcome.asked !== undefined && outcome.asked > policy.maxDelayMs) throw outcome.failure;
      await sleep(outcome.asked ?? backoffMs(count - 1, policy), request.signal);
    }
    /* oxlint-enable no-await-in-loop */
  }

  async function json(method: string, key: string, request: Loose): Promise<unknown> {
    const { response, attempts } = await send(method, key, request);
    const text = response.status === 204 || response.status === 205 ? '' : await response.text();
    if (text === '') return request.parse ? request.parse(undefined) : undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (cause) {
      throw new HttpError({
        kind: 'parse',
        method,
        endpoint: key,
        status: response.status,
        headers: response.headers,
        attempts,
        cause,
      });
    }
    return request.parse ? request.parse(raw) : raw;
  }

  const verb =
    (method: string) =>
    (key: string, request: Loose = {}) =>
      json(method, key, request);
  // The typed signatures are on `HttpClient`; underneath, every method takes the loose form of the same call.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
  return {
    get: verb('GET'),
    post: verb('POST'),
    put: verb('PUT'),
    patch: verb('PATCH'),
    delete: verb('DELETE'),
    response: async (method: string, key: string, request: Loose = {}) =>
      (await send(method.toUpperCase(), key, request)).response,
  } as unknown as HttpClient<E, R>;
}
