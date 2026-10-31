// Serves the built storefront like production, on two origins:
//   :4300 shell (SPA) + /registry/index.json
//   :4301 CDN with each remote under /<name>/
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const remotes = ['catalog', 'cart'];
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
    send(
      res,
      inside(dist, file) ? file : path.join(dist, 'index.html'),
      file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000',
    );
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

console.log('storefront http://localhost:4300 (cdn :4301)');
