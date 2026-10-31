// Serves the built storefront like production, on two origins:
//   :4300 shell (SPA) + /registry/index.json
//   :4301 CDN with each remote under /<name>/
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const remotes = ['catalog', 'cart'];
// SERVE_INLINE=1 plays the part of a server or CDN edge: it inlines the registry
// index and preloads the current route's remote, cutting the boot waterfall.
const inline = process.env.SERVE_INLINE === '1';

function remoteEntryOf(name: string): string | undefined {
  try {
    const manifest: unknown = JSON.parse(
      fs.readFileSync(path.join(root, name, 'dist', 'mf-manifest.json'), 'utf8'),
    );
    const meta: unknown =
      typeof manifest === 'object' && manifest !== null
        ? Reflect.get(manifest, 'metaData')
        : undefined;
    const entry: unknown =
      typeof meta === 'object' && meta !== null ? Reflect.get(meta, 'remoteEntry') : undefined;
    const file: unknown =
      typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'name') : undefined;
    return typeof file === 'string' ? file : undefined;
  } catch {
    return undefined;
  }
}

function withInlineRegistry(html: string, host: string, route: string): string {
  const cdn = `http://${host}:4301`;
  const needed = [route.startsWith('/cart') ? 'cart' : 'catalog', 'cart'];
  const hints: string[] = [];
  for (const name of new Set(needed)) {
    hints.push(
      `<link rel="preload" href="${cdn}/${name}/mf-manifest.json" as="fetch" crossorigin>`,
    );
    const entry = remoteEntryOf(name);
    if (entry) hints.push(`<link rel="preload" href="${cdn}/${name}/${entry}" as="script">`);
  }
  const data = JSON.stringify(index(host)).replace(/</g, '\\u003c');
  return html.replace(
    '</head>',
    `<script>globalThis.mfeflowRegistry=${data}</script>${hints.join('')}</head>`,
  );
}
const types: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
};

function send(res: http.ServerResponse, file: string, cache: string): void {
  res.writeHead(200, {
    'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': cache,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(fs.readFileSync(file));
}

function inside(dir: string, file: string): boolean {
  return file.startsWith(dir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile();
}

const index = (host: string) => ({
  shell: 'storefront',
  env: 'e2e',
  remotes: remotes.map((name) => ({
    name,
    entry: `http://${host}:4301/${name}/mf-manifest.json`,
    routes: [`/${name}`],
  })),
});

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/registry/index.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(
        JSON.stringify(index((req.headers.host ?? 'localhost').split(':')[0] ?? 'localhost')),
      );
      return;
    }
    const dist = path.join(root, 'shell', 'dist');
    const file = path.join(dist, decodeURIComponent(url.pathname));
    if (inside(dist, file) && !file.endsWith('.html')) {
      send(res, file, 'public, max-age=31536000');
      return;
    }
    const host = (req.headers.host ?? 'localhost').split(':')[0] ?? 'localhost';
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(inline ? withInlineRegistry(html, host, url.pathname) : html);
  })
  .listen(4300);

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const [, name, ...rest] = url.pathname.split('/');
    if (name && remotes.includes(name)) {
      const dist = path.join(root, name, 'dist');
      const file = path.join(dist, ...rest.map(decodeURIComponent));
      if (inside(dist, file)) {
        send(res, file, 'public, max-age=60');
        return;
      }
    }
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    res.end('not found');
  })
  .listen(4301);

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const dist = path.join(root, 'monolith', 'dist');
    const file = path.join(dist, decodeURIComponent(url.pathname));
    send(
      res,
      inside(dist, file) ? file : path.join(dist, 'index.html'),
      file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000',
    );
  })
  .listen(4302);

console.log(
  `storefront http://localhost:4300 (cdn :4301, monolith :4302)${inline ? ', inline registry + preload' : ''}`,
);
