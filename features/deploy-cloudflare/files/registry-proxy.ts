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

function keyFor(pathname: string, env: Env): { key: string; cache: string } | undefined {
  const rest = pathname.slice('/registry/'.length);
  if (rest === 'index.json') return { key: `envs/${env.MFE_ENV}/index.json`, cache: INDEX_CACHE };
  if (/^(?!envs\/)[^/]+\/[^/]+\/.+/.test(rest)) return { key: rest, cache: VERSIONED_CACHE };
  return undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    let target: ReturnType<typeof keyFor>;
    try {
      target = keyFor(decodeURIComponent(new URL(request.url).pathname), env);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (target === undefined) return new Response('Not found', { status: 404 });

    const object =
      request.method === 'HEAD'
        ? await env.REGISTRY.head(target.key)
        : await env.REGISTRY.get(target.key, { onlyIf: request.headers });
    if (object === null) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', target.cache);
    if (request.method === 'HEAD') return new Response(null, { headers });
    // An object with no body means the If-None-Match or If-Modified-Since check matched.
    if (object.body === undefined) return new Response(null, { status: 304, headers });
    return new Response(object.body, { headers });
  },
};
