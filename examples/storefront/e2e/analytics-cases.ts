import { expect, test, type Page } from '@playwright/test';
import { runtimeConfig } from './support';

const GTM = 'https://www.googletagmanager.com/gtm.js*';

interface Entry {
  kind: string;
  args: unknown[];
  event?: unknown;
  mfe?: unknown;
  page_path?: unknown;
}

interface Request {
  url: string;
  layer: Entry[];
}

/** Answers gtm.js with a stub and remembers what `dataLayer` held when the request was made. */
async function interceptGtm(page: Page): Promise<Request[]> {
  const requests: Request[] = [];
  await page.route(GTM, async (route) => {
    const layer = await readLayer(page);
    requests.push({ url: route.request().url(), layer });
    await route.fulfill({ contentType: 'text/javascript', body: 'window.gtmStubLoaded = true;' });
  });
  return requests;
}

function readLayer(page: Page): Promise<Entry[]> {
  return page.evaluate(() => {
    const layer: unknown = Reflect.get(window, 'dataLayer');
    if (!Array.isArray(layer)) return [];
    return layer.map((entry: unknown): Entry => {
      const kind = Object.prototype.toString.call(entry);
      if (typeof entry !== 'object' || entry === null) return { kind, args: [] };
      return {
        kind,
        args: kind === '[object Arguments]' ? Object.values(entry) : [],
        event: Reflect.get(entry, 'event'),
        mfe: Reflect.get(entry, 'mfe'),
        page_path: Reflect.get(entry, 'page_path'),
      };
    });
  });
}

const events = (layer: Entry[], name: string) => layer.filter((e) => e.event === name);

/** The analytics checks, run against the production build and again against a StrictMode development build. */
export function analyticsCases(): void {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
  });

  test('consent defaults are in dataLayer before gtm.js is requested', async ({ page }) => {
    await runtimeConfig(page, { gtmId: 'GTM-TEST123' });
    const requests = await interceptGtm(page);
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-heading')).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);

    const [request] = requests;
    expect(request?.url).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-TEST123');
    const [consent, start] = request?.layer ?? [];
    // GTM reads gtag's `arguments` object; an array of the same values would be ignored.
    expect(consent?.kind).toBe('[object Arguments]');
    expect(consent?.args).toEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        analytics_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        wait_for_update: 500,
      },
    ]);
    expect(start?.event).toBe('gtm.js');
  });

  test('two remotes mounted: one gtm.js, and each event once', async ({ page }) => {
    await runtimeConfig(page, { gtmId: 'GTM-TEST123' });
    const requests = await interceptGtm(page);
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-heading')).toBeVisible();
    await expect(page.getByTestId('mini-cart')).toBeVisible();
    await expect.poll(async () => events(await readLayer(page), 'mini_cart_viewed').length).toBe(1);
    await page.waitForTimeout(300);

    const layer = await readLayer(page);
    expect(requests).toHaveLength(1);
    expect(events(layer, 'page_view')).toHaveLength(1);
    expect(events(layer, 'catalog_viewed')).toHaveLength(1);
    expect(events(layer, 'mini_cart_viewed')).toHaveLength(1);
    expect(events(layer, 'catalog_viewed')[0]?.mfe).toEqual({ name: 'catalog' });
    expect(events(layer, 'mini_cart_viewed')[0]?.mfe).toEqual({ name: 'cart' });

    await page.getByTestId('nav-cart').click();
    await expect(page.getByTestId('cart')).toBeVisible();
    await expect.poll(async () => events(await readLayer(page), 'cart_viewed').length).toBe(1);
    await page.waitForTimeout(300);
    const after = await readLayer(page);
    expect(events(after, 'page_view').map((e) => e.page_path)).toEqual(['/catalog', '/cart']);
    expect(events(after, 'cart_viewed')).toHaveLength(1);
    expect(events(after, 'mini_cart_viewed')).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  test("the visitor's choice is sent as a consent update, and remembered before gtm.js on the next visit", async ({
    page,
  }) => {
    await runtimeConfig(page, { gtmId: 'GTM-TEST123' });
    const requests = await interceptGtm(page);
    await page.goto('/catalog');
    await page.getByTestId('consent-accept').click();
    await expect(page.getByTestId('consent-accept')).toHaveCount(0);
    const granted = (await readLayer(page)).filter((e) => e.args[1] === 'update');
    expect(granted).toHaveLength(1);
    expect(granted[0]?.args[2]).toEqual({
      ad_storage: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });

    await page.reload();
    await expect.poll(() => requests.length).toBe(2);
    const second = requests[1]?.layer ?? [];
    expect(second[0]?.args[1]).toBe('default');
    expect(second[1]?.args.slice(0, 2)).toEqual(['consent', 'update']);
    await expect(page.getByTestId('consent-accept')).toHaveCount(0);
  });

  test('without a gtmId nothing is requested and no tracker call throws', async ({ page }) => {
    const requests = await interceptGtm(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-heading')).toBeVisible();
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
