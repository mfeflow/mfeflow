// Serves the built storefront like production, with the same server features
// for the shell and the monolith baseline (gzip, long-lived caching of hashed files):
//   :4300 shell (SPA); remotes under /mfe/<name>/ on the same origin; /registry/index.json
//   :4302 monolith (SPA)
// The shell's index.html gets the edge injection: the registry inlined as
// window.__MFE_REGISTRY__ and preload hints for the current route's remote files.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { assetsFromManifest, injectIntoHead, registryInjection } from '@mfeflow/contracts';
import type { RegistryIndex, RouteNeed } from '@mfeflow/contracts';

const root = path.resolve(import.meta.dirname, '..');
const remotes = ['catalog', 'cart'];
const SHELL_PORT = Number(process.env.SHELL_PORT ?? '4300');
const MONOLITH_PORT = Number(process.env.MONOLITH_PORT ?? '4302');
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

const gzipCache = new Map<string, Buffer>();

function gzip(body: Buffer): Buffer {
  const key = crypto.createHash('sha1').update(body).digest('hex');
  const hit = gzipCache.get(key);
  if (hit) return hit;
  const packed = zlib.gzipSync(body, { level: 6 });
  gzipCache.set(key, packed);
  return packed;
}

function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  cache: string,
  transform?: (body: string) => string,
): void {
  const ext = path.extname(file);
  const source = fs.readFileSync(file);
  const body = transform ? Buffer.from(transform(source.toString('utf8'))) : source;
  const headers: Record<string, string> = {
    'Content-Type': types[ext] ?? 'application/octet-stream',
    'Cache-Control': cache,
  };
  if (compressible.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    res.end(gzip(body));
    return;
  }
  res.writeHead(200, headers);
  res.end(body);
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404);
  res.end('not found');
}

const cacheFor = (file: string) =>
  file.endsWith('.html') || file.endsWith('mf-manifest.json')
    ? 'no-cache'
    : 'public, max-age=31536000, immutable';

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const indexes = new Map<string, RegistryIndex>();

/** The registry for one origin: each remote's entry script and per-expose files, read from its built manifest. */
function registryFor(origin: string): RegistryIndex {
  const hit = indexes.get(origin);
  if (hit) return hit;
  const index: RegistryIndex = {
    shell: 'storefront',
    env: 'e2e',
    remotes: remotes.map((name) => {
      const manifestUrl = `${origin}/mfe/${name}/mf-manifest.json`;
      const assets = assetsFromManifest(
        readJson(path.join(root, name, 'dist', 'mf-manifest.json')),
        manifestUrl,
      );
      return { name, entry: manifestUrl, routes: [`/${name}`], ...assets };
    }),
  };
  indexes.set(origin, index);
  return index;
}

/** What each route renders: the page's remote plus the mini cart in every header. */
function needsFor(pathname: string): RouteNeed[] {
  const page = pathname.startsWith('/cart') ? 'cart' : 'catalog';
  return [
    { remote: page, expose: './App' },
    { remote: 'cart', expose: './MiniCart' },
  ];
}

function shellHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  const origin = `http://${req.headers.host ?? `localhost:${String(SHELL_PORT)}`}`;
  if (url.pathname === '/registry/index.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(registryFor(origin)));
    return;
  }
  if (url.pathname.startsWith('/mfe/')) {
    const [, , name, ...rest] = url.pathname.split('/');
    const dist = path.join(root, name ?? '', 'dist');
    const file = path.join(dist, ...rest.map(decodeURIComponent));
    if (name && remotes.includes(name) && file.startsWith(dist + path.sep) && isFile(file)) {
      send(req, res, file, cacheFor(file));
      return;
    }
    notFound(res);
    return;
  }
  const dist = path.join(root, 'shell', 'dist');
  const file = path.join(dist, decodeURIComponent(url.pathname));
  if (file.startsWith(dist + path.sep) && isFile(file) && !file.endsWith('.html')) {
    send(req, res, file, cacheFor(file));
    return;
  }
  send(req, res, path.join(dist, 'index.html'), 'no-cache', (html) =>
    INJECT
      ? injectIntoHead(
          html,
          registryInjection(registryFor(origin), HINTS ? needsFor(url.pathname) : []),
        )
      : html,
  );
}

function monolithHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  const dist = path.join(root, 'monolith', 'dist');
  const file = path.join(dist, decodeURIComponent(url.pathname));
  const target =
    file.startsWith(dist + path.sep) && isFile(file) ? file : path.join(dist, 'index.html');
  send(req, res, target, cacheFor(target));
}

http.createServer(shellHandler).listen(SHELL_PORT);
http.createServer(monolithHandler).listen(MONOLITH_PORT);
console.log(
  `storefront http://localhost:${String(SHELL_PORT)} (remotes under /mfe/), monolith http://localhost:${String(MONOLITH_PORT)}; gzip, registry + preload injected into the shell`,
);
