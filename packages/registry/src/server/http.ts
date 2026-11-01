import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Log } from './fallback';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { ApiError, ENV_NAME, type RegistryService } from './service';
import type { RegistryStorage, TokenRecord } from './storage';
import { allows, verifyToken, type Need } from './tokens';

export const INDEX_CACHE = 'private, max-age=5';

export interface HandlerOptions {
  service: RegistryService;
  storage: RegistryStorage;
  corsOrigins: readonly string[];
  maxBodyBytes: number;
  log: Log;
  /** Beacons per client address: `burst` at once, then `perMinute`. */
  beaconLimit?: { burst: number; perMinute: number };
  /** Read the client address from the last `X-Forwarded-For` entry; set only behind your own proxy. */
  trustProxy?: boolean;
  limiter?: RateLimiter;
}

/** A beacon is one page's report, at most 20 short entries; anything bigger is not one. */
export const BEACON_MAX_BYTES = 4096;
export const DEFAULT_BEACON_LIMIT = { burst: 60, perMinute: 60 };

const JSON_TYPE = 'application/json; charset=utf-8';

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': JSON_TYPE,
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function fail(res: ServerResponse, error: ApiError, headers: Record<string, string> = {}): void {
  send(
    res,
    error.status,
    { error: { code: error.code, message: error.message, ...error.details } },
    headers,
  );
}

async function readJson(
  req: IncomingMessage,
  max: number,
  accept: RegExp = /^application\/json\s*(;|$)/i,
): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!accept.test(type))
    throw new ApiError(415, 'unsupported_media_type', 'send the body as application/json');
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) throw new ApiError(413, 'too_large', `the body is over ${String(max)} bytes`);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > max) throw new ApiError(413, 'too_large', `the body is over ${String(max)} bytes`);
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'bad_json', 'the body is not valid JSON');
  }
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  const match = header === undefined ? null : /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

function peek(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value: unknown = Object.entries(body).find(([k]) => k === key)?.[1];
  return typeof value === 'string' ? value : '';
}

function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
      .split(',')
      .at(-1)
      ?.trim();
    if (last !== undefined && last !== '') return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

type Handler = (token: TokenRecord, body: unknown) => Promise<unknown>;

/** The `node:http` request listener. No framework: five POST/GET routes and a health check. */
export function createHandler(
  options: HandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const { service, storage, log } = options;
  const limiter = options.limiter ?? createRateLimiter(options.beaconLimit ?? DEFAULT_BEACON_LIMIT);
  const corsFor = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    return options.corsOrigins.length === 0
      ? {}
      : {
          vary: 'Origin',
          ...(origin !== undefined && options.corsOrigins.includes(origin)
            ? { 'access-control-allow-origin': origin }
            : {}),
        };
  };

  const post: Record<string, { scope: (b: unknown) => Need[]; run: Handler }> = {
    '/v1/deploy': {
      scope: (b) => [{ action: 'deploy', env: peek(b, 'env'), remote: peek(b, 'remote') }],
      run: (t, b) => service.deploy(t.id, b),
    },
    '/v1/promote': {
      scope: (b) => [
        { action: 'promote', env: peek(b, 'to'), remote: peek(b, 'remote') },
        { action: 'read', env: peek(b, 'from'), remote: peek(b, 'remote') },
      ],
      run: (t, b) => service.promote(t.id, b),
    },
    '/v1/rollback': {
      scope: (b) => [{ action: 'rollback', env: peek(b, 'env'), remote: peek(b, 'remote') }],
      run: (t, b) => service.rollback(t.id, b),
    },
    '/v1/rollout/step': {
      scope: (b) => [{ action: 'rollout', env: peek(b, 'env'), remote: peek(b, 'remote') }],
      run: (t, b) => service.rolloutStep(t.id, b),
    },
    '/v1/rollout/complete': {
      scope: (b) => [{ action: 'rollout', env: peek(b, 'env'), remote: peek(b, 'remote') }],
      run: (t, b) => service.rolloutComplete(t.id, b),
    },
    '/v1/rollout/abort': {
      scope: (b) => [{ action: 'rollout', env: peek(b, 'env'), remote: peek(b, 'remote') }],
      run: (t, b) => service.rolloutAbort(t.id, b),
    },
    '/v1/kill': {
      scope: (b) => [{ action: 'kill', env: peek(b, 'env'), remote: peek(b, 'remote') }],
      run: (t, b) => service.kill(t.id, b),
    },
  };

  async function authenticate(req: IncomingMessage): Promise<TokenRecord> {
    const given = bearer(req);
    const token = given === undefined ? undefined : await verifyToken(storage, given);
    if (token === undefined)
      throw new ApiError(
        401,
        'unauthorized',
        'send a valid token as "Authorization: Bearer <token>"',
      );
    return token;
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<number> {
    const { pathname } = url;
    const method = req.method ?? 'GET';
    const wrongMethod = (allow: string): number => {
      fail(res, new ApiError(405, 'method_not_allowed', `use ${allow}`), { allow });
      return 405;
    };

    if (pathname === '/healthz') {
      if (method !== 'GET') return wrongMethod('GET');
      await storage.ping();
      send(res, 200, { ok: true });
      return 200;
    }

    const indexMatch = /^\/v1\/index\/([^/]+)$/.exec(pathname);
    if (indexMatch !== null) {
      if (method !== 'GET') return wrongMethod('GET');
      const env = indexMatch[1] ?? '';
      if (!ENV_NAME.test(env))
        throw new ApiError(400, 'bad_request', `"${env}" is not an env name`);
      const client = url.searchParams.get('u');
      if (client !== null && !/^[\w.:-]{1,128}$/.test(client))
        throw new ApiError(400, 'bad_request', '"u" must be 1 to 128 letters, digits and . : _ -');
      const index = await service.index(env, client ?? undefined);
      if (index === undefined) throw new ApiError(404, 'unknown_env', `no index for ${env}`);
      send(res, 200, index, { 'cache-control': INDEX_CACHE, ...corsFor(req) });
      return 200;
    }

    if (pathname === '/v1/beacon') {
      if (method !== 'POST') return wrongMethod('POST');
      const taken = limiter.take(clientAddress(req, options.trustProxy === true));
      if (!taken.ok) {
        fail(res, new ApiError(429, 'rate_limited', 'too many beacons; slow down'), {
          'retry-after': String(taken.retryAfterSeconds),
        });
        return 429;
      }
      // sendBeacon sends strings as text/plain, which skips the CORS preflight a browser would make for JSON.
      const body = await readJson(
        req,
        Math.min(options.maxBodyBytes, BEACON_MAX_BYTES),
        /^(application\/json|text\/plain)\s*(;|$)/i,
      );
      await service.beacon(body);
      send(res, 202, { ok: true }, corsFor(req));
      return 202;
    }

    if (pathname === '/v1/rollout') {
      if (method !== 'GET') return wrongMethod('GET');
      const token = await authenticate(req);
      const env = url.searchParams.get('env') ?? '';
      const remote = url.searchParams.get('remote') ?? '';
      if (!ENV_NAME.test(env) || remote === '')
        throw new ApiError(400, 'bad_request', 'pass ?env= and ?remote=');
      if (!allows(token, { action: 'read', env, remote }))
        throw new ApiError(403, 'forbidden', `this token cannot read ${remote} in ${env}`);
      send(res, 200, await service.rolloutStatus(env, remote));
      return 200;
    }

    if (pathname === '/v1/audit') {
      if (method !== 'GET') return wrongMethod('GET');
      const token = await authenticate(req);
      const env = url.searchParams.get('env') ?? undefined;
      if (env !== undefined && !ENV_NAME.test(env))
        throw new ApiError(400, 'bad_request', `"${env}" is not an env name`);
      const remote = url.searchParams.get('remote') ?? undefined;
      if (
        !allows(token, {
          action: 'read',
          env: env ?? '*',
          ...(remote === undefined ? {} : { remote }),
        })
      )
        throw new ApiError(403, 'forbidden', 'this token cannot read that audit log');
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const entries = await service.audit(token, {
        env,
        remote,
        limit: Number.isFinite(limit) ? limit : 100,
      });
      send(res, 200, { entries });
      return 200;
    }

    const handler = post[pathname];
    if (handler !== undefined) {
      if (method !== 'POST') return wrongMethod('POST');
      const token = await authenticate(req);
      const body = await readJson(req, options.maxBodyBytes);
      const denied = handler.scope(body).find((need) => !allows(token, need));
      if (denied !== undefined)
        throw new ApiError(
          403,
          'forbidden',
          `this token cannot ${denied.action} ${denied.remote === '' ? 'that remote' : (denied.remote ?? '')} in ${denied.env === '' ? 'that env' : denied.env}`,
        );
      send(res, 200, await handler.run(token, body));
      return 200;
    }

    throw new ApiError(404, 'not_found', `no route ${pathname}`);
  }

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'https://registry.invalid');
    route(req, res, url)
      .then((status) => {
        if (req.method !== 'GET' && url.pathname !== '/v1/beacon')
          log('info', `${req.method ?? ''} ${url.pathname} ${String(status)}`);
      })
      .catch((error: unknown) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (error instanceof ApiError) {
          const headers: Record<string, string> = {};
          if (error.status === 401) headers['www-authenticate'] = 'Bearer';
          if (error.status === 413) headers.connection = 'close';
          fail(res, error, headers);
          log('info', `${req.method ?? ''} ${url.pathname} ${String(error.status)} ${error.code}`);
          return;
        }
        log(
          'error',
          `${req.method ?? ''} ${url.pathname} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        fail(res, new ApiError(500, 'internal_error', 'something went wrong; see the server log'));
      });
  };
}
