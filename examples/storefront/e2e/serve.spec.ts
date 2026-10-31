import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('the test server', () => {
  test('honours q=0 and always varies on Accept-Encoding', async ({ request }) => {
    const asked = async (encoding: string) =>
      request.get('/catalog', { headers: { 'accept-encoding': encoding } });
    expect((await asked('gzip')).headers()['content-encoding']).toBe('gzip');
    expect((await asked('gzip;q=0')).headers()['content-encoding']).toBeUndefined();
    expect((await asked('gzip; q=0.0, br')).headers()['content-encoding']).toBeUndefined();
    expect((await asked('identity')).headers()['content-encoding']).toBeUndefined();
    const varies = await Promise.all(
      ['gzip', 'gzip;q=0', 'identity'].map(
        async (encoding) => (await asked(encoding)).headers().vary,
      ),
    );
    expect(varies).toEqual(['Accept-Encoding', 'Accept-Encoding', 'Accept-Encoding']);
  });

  test('answers the same page from the compression cache after the first request', async ({
    request,
  }) => {
    const first = await request.get('/catalog');
    const second = await request.get('/catalog');
    expect(second.headers()['content-encoding']).toBe(first.headers()['content-encoding']);
    expect(await second.text()).toBe(await first.text());
  });

  test('a bad Host header is a 400', async ({ request }) => {
    const res = await request.get('/catalog', { headers: { host: 'bad host/"<x>' } });
    expect(res.status()).toBe(400);
    expect((await request.get('/catalog')).status()).toBe(200);
  });

  test('a valid but foreign Host is a 421 and never reaches the registry or its cache', async ({
    request,
  }) => {
    const statuses = await Promise.all(
      ['/catalog', '/registry/index.json'].map(async (url) =>
        (await request.get(url, { headers: { host: 'evil.test' } })).status(),
      ),
    );
    expect(statuses).toEqual([421, 421]);
    const index = await (await request.get('/registry/index.json')).text();
    expect(index).not.toContain('evil.test');
    expect(index).toContain('http://localhost:4300/mfe/cart/');
  });
});

test('a missing remote build is a 503 for that request, not a dead server', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storefront-empty-'));
  fs.mkdirSync(path.join(root, 'shell/dist'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'shell/dist/index.html'),
    '<html><head><meta charset="utf-8"></head><body></body></html>',
  );
  fs.writeFileSync(path.join(root, 'shell/dist/app.js'), 'x');
  const base = 'http://localhost:4391';
  const server = spawn('node', [path.join(import.meta.dirname, 'serve.ts')], {
    env: { ...process.env, SERVE_ROOT: root, SHELL_PORT: '4391', MONOLITH_PORT: '4393' },
    stdio: 'ignore',
  });
  try {
    await expect
      .poll(
        async () =>
          fetch(`${base}/app.js`).then(
            (r) => r.status,
            () => 0,
          ),
        { timeout: 10_000 },
      )
      .toBe(200);
    expect((await fetch(`${base}/registry/index.json`)).status).toBe(503);
    expect((await fetch(`${base}/catalog`)).status).toBe(503);
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
    expect(server.exitCode).toBeNull();
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
