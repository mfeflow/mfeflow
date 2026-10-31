// Serves the built storefront like production, with the same server features
// for the shell and the monolith baseline (gzip, long-lived caching of hashed files):
//   :4300 shell (SPA); remotes under /mfe/<name>/ on the same origin; /registry/index.json
//   :4302 monolith (SPA)
// The shell's index.html gets the edge injection: the registry inlined as
// window.__MFE_REGISTRY__ and preload hints for the current route's remote files.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { assetsFromManifest, injectIntoHead, registryInjection } from '@mfeflow/contracts';
import type { RegistryIndex, RouteNeed } from '@mfeflow/contracts';

// SERVE_ROOT points the server at another storefront build (the server's own tests use an empty one).
const root = process.env.SERVE_ROOT ?? path.resolve(import.meta.dirname, '..');
const remotes = ['catalog', 'cart'];
const SHELL_PORT = Number(process.env.SHELL_PORT ?? '4300');
const MONOLITH_PORT = Number(process.env.MONOLITH_PORT ?? '4302');
// SERVE_ENCODING=br serves brotli (quality 11) instead of gzip (level 6), for both apps.
const ENCODING = process.env.SERVE_ENCODING === 'br' ? 'br' : 'gzip';
// SERVE_MANIFEST_ONLY=1 leaves remoteEntry out of the registry, so the shell loads manifests.
const MANIFEST_ONLY = process.env.SERVE_MANIFEST_ONLY === '1';
// SERVE_INJECT=0 turns the edge injection off (perf ablations only).
const INJECT = process.env.SERVE_INJECT !== '0';
// SERVE_HINTS=0 keeps the inlined registry but drops the preload hints.
const HINTS = process.env.SERVE_HINTS !== '0';

const types: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
};
const compressible = new Set(['.js', '.json', '.html', '.css']);

function isFile(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

const packed = new Map<string, Buffer>();

// Keyed by what produced the body: the file, plus the route and origin for the transformed index.html.
function compress(key: string, body: Buffer): Buffer {
  const hit = packed.get(key);
  if (hit) return hit;
  const out =
    ENCODING === 'br'
      ? zlib.brotliCompressSync(body, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
          },
        })
      : zlib.gzipSync(body, { level: 6 });
  packed.set(key, out);
  return out;
}

/** Whether the client accepts our encoding: listed, and not given `q=0`. */
function acceptsEncoding(header: string | undefined): boolean {
  for (const part of (header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (name !== ENCODING) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  }
  return false;
}

function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  cache: string,
  transform?: (body: string) => string,
  variant = '',
): void {
  const ext = path.extname(file);
  const headers: Record<string, string> = {
    'Content-Type': types[ext] ?? 'application/octet-stream',
    'Cache-Control': cache,
    ...(compressible.has(ext) ? { Vary: 'Accept-Encoding' } : {}),
  };
  const packable = compressible.has(ext) && acceptsEncoding(req.headers['accept-encoding']);
  const key = `${file}\0${variant}`;
  const cached = packable ? packed.get(key) : undefined;
  if (cached) {
    res.writeHead(200, { ...headers, 'Content-Encoding': ENCODING });
    res.end(cached);
    return;
  }
  const source = fs.readFileSync(file);
  const body = transform ? Buffer.from(transform(source.toString('utf8'))) : source;
  if (packable) {
    res.writeHead(200, { ...headers, 'Content-Encoding': ENCODING });
    res.end(compress(key, body));
    return;
  }
  res.writeHead(200, headers);
  res.end(body);
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404);
  res.end('not found');
}

// Only content-hashed files (cart.7f57731a50.js) may be cached forever; mf-manifest.json,
// mf-stats.json, @mf-types.* and the like keep their name across releases.
const HASHED = /\.[0-9a-f]{8,}\./;
const cacheFor = (file: string) => {
  if (file.endsWith('.html') || file.endsWith('mf-manifest.json')) return 'no-cache';
  return HASHED.test(path.basename(file))
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=60';
};

function decode(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

function badRequest(res: http.ServerResponse): void {
  res.writeHead(400);
  res.end('bad request');
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const indexes = new Map<string, RegistryIndex>();

/** A request that cannot be served right now (a remote is not built); answered with 503 for that request only. */
class Unavailable extends Error {}

/** The registry for one origin: each remote's entry script and per-expose files, read from its built manifest. */
function registryFor(origin: string): RegistryIndex {
  const hit = indexes.get(origin);
  if (hit) return hit;
  try {
    const index: RegistryIndex = {
      shell: 'storefront',
      env: 'e2e',
      remotes: remotes.map((name) => {
        const manifestUrl = `${origin}/mfe/${name}/mf-manifest.json`;
        const assets = assetsFromManifest(
          readJson(path.join(root, name, 'dist', 'mf-manifest.json')),
          manifestUrl,
        );
        return {
          name,
          entry: manifestUrl,
          routes: [`/${name}`],
          ...(MANIFEST_ONLY ? {} : assets),
        };
      }),
    };
    indexes.set(origin, index);
    return index;
  } catch (error) {
    throw new Unavailable('registry unavailable (is every remote built?)', { cause: error });
  }
}

/** What each route renders: the page's remote plus the mini cart in every header. */
function needsFor(pathname: string): RouteNeed[] {
  const page = pathname.startsWith('/cart') ? 'cart' : 'catalog';
  return [
    { remote: page, expose: './App' },
    { remote: 'cart', expose: './MiniCart' },
  ];
}

// Only plain host[:port] values become part of the registry's URLs and its cache key.
const HOST = /^[\w.-]+(:\d{1,5})?$/;

function shellHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  const host = req.headers.host ?? `localhost:${String(SHELL_PORT)}`;
  if (!HOST.test(host)) {
    badRequest(res);
    return;
  }
  const origin = `http://${host}`;
  if (url.pathname === '/registry/index.json') {
    const body = JSON.stringify(registryFor(origin));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(body);
    return;
  }
  if (url.pathname.startsWith('/mfe/')) {
    const [, , name, ...rest] = url.pathname.split('/');
    const dist = path.join(root, name ?? '', 'dist');
    const parts = rest.map(decode);
    if (parts.some((p) => p === undefined)) {
      badRequest(res);
      return;
    }
    const file = path.join(dist, ...parts.map(String));
    if (name && remotes.includes(name) && file.startsWith(dist + path.sep) && isFile(file)) {
      send(req, res, file, cacheFor(file));
      return;
    }
    notFound(res);
    return;
  }
  const dist = path.join(root, 'shell', 'dist');
  const decoded = decode(url.pathname);
  if (decoded === undefined) {
    badRequest(res);
    return;
  }
  const file = path.join(dist, decoded);
  if (file.startsWith(dist + path.sep) && isFile(file) && !file.endsWith('.html')) {
    send(req, res, file, cacheFor(file));
    return;
  }
  send(
    req,
    res,
    path.join(dist, 'index.html'),
    'no-cache',
    (html) =>
      INJECT
        ? injectIntoHead(
            html,
            registryInjection(registryFor(origin), HINTS ? needsFor(url.pathname) : []),
          )
        : html,
    `${origin}|${needsFor(url.pathname)[0]?.remote ?? ''}`,
  );
}

function monolithHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  const dist = path.join(root, 'monolith', 'dist');
  const decoded = decode(url.pathname);
  if (decoded === undefined) {
    badRequest(res);
    return;
  }
  const file = path.join(dist, decoded);
  const target =
    file.startsWith(dist + path.sep) && isFile(file) ? file : path.join(dist, 'index.html');
  send(req, res, target, cacheFor(target));
}

/** One bad request must never take the server down: log it and answer 503 (a missing build) or 500. */
function guarded(handler: http.RequestListener): http.RequestListener {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (error) {
      console.error('%s %s:', req.method ?? 'GET', req.url ?? '', error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(error instanceof Unavailable ? 503 : 500);
      res.end(error instanceof Unavailable ? error.message : 'internal error');
    }
  };
}

http.createServer(guarded(shellHandler)).listen(SHELL_PORT);
http.createServer(guarded(monolithHandler)).listen(MONOLITH_PORT);
console.log(
  `storefront http://localhost:${String(SHELL_PORT)} (remotes under /mfe/), monolith http://localhost:${String(MONOLITH_PORT)}; ${ENCODING}, registry + preload injected into the shell`,
);
