// Serves /registry/* from the REGISTRY R2 binding. `assets.run_worker_first` sends only those paths here.
// _headers does not apply to responses a Worker makes, so the cache rules are set below.
//   /registry/index.json                  ->  envs/<MFE_ENV>/index.json     checked on every load
//   /registry/<name>/<version>/<file>     ->  <name>/<version>/<file>       never changes
// The types below cover only what this file uses of the Cloudflare runtime.
interface R2Object {
  httpEtag: string;
  body?: ReadableStream;
  writeHttpMetadata(headers: Headers): void;
}

interface Env {
  MFE_ENV: string;
  REGISTRY: {
    get(key: string, options?: { onlyIf?: Headers }): Promise<R2Object | null>;
    head(key: string): Promise<R2Object | null>;
  };
}

const INDEX_CACHE = 'no-cache';
const VERSIONED_CACHE = 'public, max-age=31536000, immutable';

const PREFIX = '/registry/';

/** A plain response that also tells browsers not to guess the type. */
function reply(
  body: ReadableStream | string | null,
  init: ResponseInit = {},
  extra?: Headers,
): Response {
  const headers = new Headers(extra);
  for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(body, { ...init, headers });
}

// The key is the decoded path. Anything that could climb out of /registry or into envs/ is not a key.
function keyFor(pathname: string, env: Env): { key: string; cache: string } | undefined {
  if (!pathname.startsWith(PREFIX)) return undefined;
  const rest = decodeURIComponent(pathname.slice(PREFIX.length));
  if (
    rest.includes('\\') ||
    rest.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    return undefined;
  }
  if (rest === 'index.json') return { key: `envs/${env.MFE_ENV}/index.json`, cache: INDEX_CACHE };
  if (/^(?!envs\/)[^/]+\/[^/]+\/.+/.test(rest)) return { key: rest, cache: VERSIONED_CACHE };
  return undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    let target: ReturnType<typeof keyFor>;
    try {
      target = keyFor(new URL(request.url).pathname, env);
    } catch {
      return reply('Bad request', { status: 400 });
    }
    if (target === undefined) return reply('Not found', { status: 404 });

    const object =
      request.method === 'HEAD'
        ? await env.REGISTRY.head(target.key)
        : await env.REGISTRY.get(target.key, { onlyIf: request.headers });
    if (object === null) return reply('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', target.cache);
    if (request.method === 'HEAD') return reply(null, {}, headers);
    // An object with no body means the If-None-Match or If-Modified-Since check matched.
    if (object.body === undefined) return reply(null, { status: 304 }, headers);
    return reply(object.body, {}, headers);
  },
};
