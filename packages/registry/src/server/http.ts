import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Log } from './fallback';
import { ApiError, ENV_NAME, type RegistryService } from './service';
import type { Action, RegistryStorage, TokenRecord } from './storage';
import { allows, verifyToken } from './tokens';

export const INDEX_CACHE = 'private, max-age=5';

export interface HandlerOptions {
  service: RegistryService;
  storage: RegistryStorage;
  corsOrigins: readonly string[];
  maxBodyBytes: number;
  log: Log;
}

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

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type))
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

type Handler = (token: TokenRecord, body: unknown) => Promise<unknown>;

/** The `node:http` request listener. No framework: five POST/GET routes and a health check. */
export function createHandler(
  options: HandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const { service, storage, log } = options;

  const post: Record<
    string,
    { action: Action; scope: (b: unknown) => { env: string; remote: string }; run: Handler }
  > = {
    '/v1/deploy': {
      action: 'deploy',
      scope: (b) => ({ env: peek(b, 'env'), remote: peek(b, 'remote') }),
      run: (t, b) => service.deploy(t.id, b),
    },
    '/v1/promote': {
      action: 'promote',
      scope: (b) => ({ env: peek(b, 'to'), remote: peek(b, 'remote') }),
      run: (t, b) => service.promote(t.id, b),
    },
    '/v1/rollback': {
      action: 'rollback',
      scope: (b) => ({ env: peek(b, 'env'), remote: peek(b, 'remote') }),
      run: (t, b) => service.rollback(t.id, b),
    },
    '/v1/kill': {
      action: 'kill',
      scope: (b) => ({ env: peek(b, 'env'), remote: peek(b, 'remote') }),
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
      const index = await service.index(env);
      if (index === undefined) throw new ApiError(404, 'unknown_env', `no index for ${env}`);
      const origin = req.headers.origin;
      const cors =
        options.corsOrigins.length === 0
          ? {}
          : {
              vary: 'Origin',
              ...(origin !== undefined && options.corsOrigins.includes(origin)
                ? { 'access-control-allow-origin': origin }
                : {}),
            };
      send(res, 200, index, { 'cache-control': INDEX_CACHE, ...cors });
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
      const { env, remote } = handler.scope(body);
      if (!allows(token, { action: handler.action, env, remote }))
        throw new ApiError(
          403,
          'forbidden',
          `this token cannot ${handler.action} ${remote === '' ? 'that remote' : remote} in ${env === '' ? 'that env' : env}`,
        );
      send(res, 200, await handler.run(token, body));
      return 200;
    }

    throw new ApiError(404, 'not_found', `no route ${pathname}`);
  }

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://registry.invalid');
    route(req, res, url)
      .then((status) => {
        if (req.method !== 'GET')
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
