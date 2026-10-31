import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, path = '/catalog'): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('catalog-heading').or(page.getByTestId('cart'))).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
});

test('theme set in the shell reaches every remote, and a reload does not flash', async ({
  page,
}) => {
  await open(page);
  const card = page.getByTestId('product-1');
  const light = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByTestId('theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() => card.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(light);
  await page.goto('/catalog', { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--mf-color-bg')),
  ).toBe('#0b1020');
});

test('language switch re-renders the shell and each remote, loading remote messages from the remote', async ({
  page,
}) => {
  const remoteMessages: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/mfe/catalog/') && r.url().endsWith('.js')) remoteMessages.push(r.url());
  });
  await open(page);
  await expect(page.getByTestId('catalog-heading')).toHaveText('Catalog');
  await page.getByTestId('language').selectOption('hi');
  await expect(page.getByTestId('catalog-heading')).toHaveText('कैटलॉग');
  await expect(page.getByTestId('nav-catalog')).toHaveText('कैटलॉग');
  await expect(page.getByTestId('mini-cart')).toHaveText('0 आइटम');
  await page.getByTestId('language').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('catalog-heading')).toHaveText('الكتالوج');
  expect(remoteMessages.length).toBeGreaterThan(0);
});

test('remotes keep their own storage and stay in sync inside the cart remote', async ({ page }) => {
  await open(page, '/cart');
  await page.getByTestId('cart-add').click();
  await page.getByTestId('cart-add').click();
  await expect(page.getByTestId('mini-cart')).toHaveText('2 items');
  await page.getByTestId('nav-catalog').click();
  await page.getByTestId('product-2').getByRole('button').click();
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual(expect.arrayContaining(['cart:items', 'catalog:lastViewed']));
});

test('every platform singleton loads once', async ({ page }) => {
  await open(page, '/catalog?mfeflow-assert');
  await page.getByTestId('nav-cart').click();
  await expect(page.getByTestId('cart')).toBeVisible();
  await page.waitForFunction(() => Reflect.get(globalThis, 'mfeflowAssertReady') !== undefined);
  const result: unknown = await page.evaluate(async (): Promise<unknown> => {
    const ready: unknown = Reflect.get(globalThis, 'mfeflowAssertReady');
    if (ready instanceof Promise) await ready;
    const check: unknown = Reflect.get(globalThis, 'mfeflowCheckSingletons');
    return typeof check === 'function' ? Reflect.apply(check, undefined, []) : undefined;
  });
  expect(result).toEqual({ missing: [], duplicated: [] });
});

test('a remote that fails to load shows its fallback and the rest keeps working', async ({
  page,
}) => {
  await page.route('**/mfe/cart/**', (route) => route.fulfill({ status: 404, body: 'gone' }));
  await open(page);
  await expect(page.locator('[data-mfeflow-fallback="cart"]')).toBeVisible();
  await expect(page.getByTestId('catalog-heading')).toHaveText('Catalog');
  const mfes: unknown = await page.evaluate((): unknown => {
    const reports: unknown = Reflect.get(globalThis, 'mfeflowReports');
    if (!Array.isArray(reports)) return [];
    return reports.map((r: unknown): unknown => {
      const mfe: unknown = typeof r === 'object' && r !== null ? Reflect.get(r, 'mfe') : undefined;
      return mfe;
    });
  });
  expect(mfes).toContain('cart');
});

test('a remote entry that 404s is retried with ?retry= and then loads', async ({ page }) => {
  // Every request for the entry without ?retry= fails, the edge preload included,
  // so the remote can only load through the retry plugin.
  const attempts: string[] = [];
  await page.route('**/mfe/cart/static/js/cart.*.js*', (route) => {
    const url = route.request().url();
    attempts.push(url);
    if (new URL(url).searchParams.has('retry')) return route.continue();
    return route.fulfill({ status: 404, body: 'gone' });
  });
  await open(page, '/cart');
  await expect(page.getByTestId('cart')).toBeVisible();
  expect(attempts.some((u) => u.includes('retry=1'))).toBe(true);
  expect(attempts.some((u) => !u.includes('retry='))).toBe(true);
});

test('only content-hashed files are cached forever', async ({ request }) => {
  const manifest = await request.get('/mfe/cart/mf-manifest.json');
  expect(manifest.headers()['cache-control']).toBe('no-cache');
  const stats = await request.get('/mfe/cart/mf-stats.json');
  expect(stats.headers()['cache-control']).not.toContain('immutable');
  const html = await request.get('/catalog');
  const entry = /href="[^"]*\/mfe\/cart\/(static\/js\/cart\.[0-9a-f]+\.js)"/.exec(
    await html.text(),
  );
  expect(entry).not.toBeNull();
  const hashed = await request.get(`/mfe/cart/${entry?.[1] ?? ''}`);
  expect(hashed.headers()['cache-control']).toContain('immutable');
});

test('a malformed URL escape is a 400, not a crash', async ({ request }) => {
  expect((await request.get('/%E0%A4%A')).status()).toBe(400);
  expect((await request.get('/mfe/cart/%zz')).status()).toBe(400);
  expect((await request.get('/catalog')).status()).toBe(200);
});

test('the registry is read from the page, and fetched from the same origin when the edge did not inline it', async ({
  page,
}) => {
  const inlined = await page.request.get('/catalog').then((r) => r.text());
  expect(inlined).toContain('window.__MFE_REGISTRY__=');
  expect(inlined).toMatch(/<link rel="preload" as="script" href="http:\/\/[^"]*\/mfe\/catalog\//);
  expect(inlined).not.toContain('crossorigin');

  const fetched: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/registry/index.json')) fetched.push(r.url());
  });
  await open(page);
  expect(fetched).toEqual([]);

  await page.route('**/catalog', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/<script>window\.__MFE_REGISTRY__=.*?<\/script>/, '');
    await route.fulfill({ response: res, body });
  });
  await open(page);
  expect(fetched).toHaveLength(1);
});

test('a production shell ignores ?mfe-override and says so', async ({ page }) => {
  await open(page, '/catalog?mfe-override=cart@http://localhost:4312/mf-manifest.json');
  const reports: unknown = await page.evaluate((): unknown => {
    const all: unknown = Reflect.get(globalThis, 'mfeflowReports');
    return Array.isArray(all)
      ? all.map((r: unknown) => String(Reflect.get(Object(r), 'where')))
      : [];
  });
  expect(reports).toContain('override');
  expect(await page.evaluate(() => sessionStorage.getItem('shell:mfe-overrides'))).toBeNull();
});
