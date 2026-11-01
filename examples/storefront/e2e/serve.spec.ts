import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { isRegistryIndex } from '@mfeflow/contracts';

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
  const server = spawn(process.execPath, [path.join(import.meta.dirname, 'serve.ts')], {
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

const manifest = JSON.stringify({
  metaData: { publicPath: 'auto', remoteEntry: { name: 'entry.js', path: '' } },
  exposes: [],
});

/** A storefront build on disk: both remotes built, and a shell whose bundle is `shellJs`. */
function fakeBuild(shellJs: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storefront-fake-'));
  for (const name of ['catalog', 'cart']) {
    fs.mkdirSync(path.join(root, name, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'dist/mf-manifest.json'), manifest);
  }
  fs.mkdirSync(path.join(root, 'shell/dist/static/js'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'shell/dist/index.html'),
    '<html><head></head><body></body></html>',
  );
  fs.writeFileSync(path.join(root, 'shell/dist/static/js/index.js'), shellJs);
  return root;
}

/** Runs the server on `port` until it answers, hands back what it wrote to stderr. */
async function serving(
  port: number,
  env: Record<string, string>,
  shellJs: string,
  run: (base: string) => Promise<void>,
): Promise<string> {
  const root = fakeBuild(shellJs);
  const server = spawn(process.execPath, [path.join(import.meta.dirname, 'serve.ts')], {
    env: {
      ...process.env,
      SERVE_ROOT: root,
      SHELL_PORT: String(port),
      MONOLITH_PORT: String(port + 2),
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const base = `http://localhost:${String(port)}`;
  try {
    await expect
      .poll(
        async () =>
          fetch(`${base}/static/js/index.js`).then(
            (r) => r.status,
            () => 0,
          ),
        { timeout: 10_000 },
      )
      .toBe(200);
    await run(base);
  } finally {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
  return stderr;
}

const nothing = async () => undefined;

test.describe('SERVE_ORIGIN', () => {
  test('is reduced to its origin, so the registry URLs have no stray path or slash', async () => {
    let entry = '';
    await serving(4381, { SERVE_ORIGIN: 'http://localhost:4381/some/path/' }, 'x', async (base) => {
      const index: unknown = await (await fetch(`${base}/registry/index.json`)).json();
      entry = isRegistryIndex(index) ? (index.remotes[0]?.entry ?? '') : '';
    });
    expect(entry).toBe('http://localhost:4381/mfe/catalog/mf-manifest.json');
  });
});

test.describe('SERVE_MANIFEST_ONLY', () => {
  const noSnapshot = 'o=t.snapshot??!1,n=[];';
  const withSnapshot = 'o=t.snapshot??!0,n=[];';
  const warning = /SERVE_MANIFEST_ONLY=1.*without the manifest loader/;

  test('warns when the shell was built without the manifest loader', async () => {
    const stderr = await serving(4383, { SERVE_MANIFEST_ONLY: '1' }, noSnapshot, nothing);
    expect(stderr).toMatch(warning);
  });

  test('stays quiet for a shell that has the loader, or when not in use', async () => {
    expect(await serving(4385, { SERVE_MANIFEST_ONLY: '1' }, withSnapshot, nothing)).not.toMatch(
      warning,
    );
    expect(await serving(4387, {}, noSnapshot, nothing)).not.toMatch(warning);
  });
});

const indexOf = (version: string) =>
  JSON.stringify({
    remotes: [
      {
        name: 'catalog',
        entry: `http://localhost:4371/reg/catalog/${version}/mf-manifest.json`,
        version,
        routes: ['/catalog'],
      },
    ],
  });

/** A host folder with an index (and one file) for env `prod`, handed to `run` along with a way to rewrite the index. */
async function hosted(
  run: (base: string, setIndex: (version: string) => void) => Promise<void>,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storefront-host-'));
  fs.mkdirSync(path.join(dir, 'envs/prod'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'catalog/1.0.0'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'catalog/1.0.0/entry.js'), 'v1'.repeat(400));
  const setIndex = (version: string) => {
    fs.writeFileSync(path.join(dir, 'envs/prod/index.json'), indexOf(version));
  };
  setIndex('1.0.0');
  try {
    await serving(4371, { SERVE_REGISTRY_DIR: dir }, 'x', (base) => run(base, setIndex));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test.describe('SERVE_REGISTRY_DIR', () => {
  test('serves the index with a 60 s max-age and re-reads it on every request', async () => {
    await hosted(async (base, setIndex) => {
      const first = await fetch(`${base}/registry/index.json`);
      expect(first.headers.get('cache-control')).toBe('public, max-age=60');
      expect(await first.text()).toContain('/catalog/1.0.0/');
      setIndex('0.9.0');
      expect(await (await fetch(`${base}/registry/index.json`)).text()).toContain(
        '/catalog/0.9.0/',
      );
      const file = await fetch(`${base}/reg/envs/prod/index.json`);
      expect(file.headers.get('cache-control')).toBe('public, max-age=60');
      expect(await file.text()).toContain('/catalog/0.9.0/');
    });
  });

  test('does not keep the compressed page or index file from before the folder changed', async () => {
    await hosted(async (base, setIndex) => {
      const page = async () => (await fetch(`${base}/catalog`)).text();
      const hostIndex = async () => (await fetch(`${base}/reg/envs/prod/index.json`)).text();
      expect(await page()).toContain('/catalog/1.0.0/');
      expect(await hostIndex()).toContain('/catalog/1.0.0/');
      setIndex('0.9.0');
      const after = await page();
      expect(after).toContain('/catalog/0.9.0/');
      expect(after).not.toContain('/catalog/1.0.0/');
      expect(await hostIndex()).toContain('/catalog/0.9.0/');
    });
  });

  test('serves version files as immutable and refuses paths outside the folder', async () => {
    await hosted(async (base) => {
      const file = await fetch(`${base}/reg/catalog/1.0.0/entry.js`);
      expect(file.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await file.text()).toBe('v1'.repeat(400));
      expect((await fetch(`${base}/reg/nope.js`)).status).toBe(404);
      expect((await fetch(`${base}/reg/..%2f..%2fetc%2fpasswd`)).status).toBe(404);
    });
  });

  test('answers 503 until something is deployed, and logs the request quoted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storefront-host-'));
    try {
      const stderr = await serving(4373, { SERVE_REGISTRY_DIR: dir }, 'x', async (base) => {
        expect((await fetch(`${base}/registry/index.json?a=%0d%0aforged`)).status).toBe(503);
      });
      expect(stderr).toContain('GET /registry/index.json?a=%0d%0aforged:');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
