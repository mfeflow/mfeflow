import { expect, test, type Page } from '@playwright/test';
import { runtimeConfig } from './support';

async function open(page: Page, path = '/catalog'): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('catalog-heading').or(page.getByTestId('cart'))).toBeVisible();
  await expect(page.getByTestId('mini-cart')).toHaveText(/items/);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
});

test.describe('event-bus', () => {
  test('a click in the catalog reaches the cart and the shell, which import neither', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByTestId('mini-cart')).toHaveText('0 items');
    await page.getByTestId('product-2').getByRole('button').click();
    await expect(page.getByTestId('mini-cart')).toHaveText('1 items');
    await expect(page.getByTestId('last-added')).toHaveText('+2');
    await page.getByTestId('product-3').getByRole('button').click();
    await expect(page.getByTestId('mini-cart')).toHaveText('2 items');
    await expect(page.getByTestId('last-added')).toHaveText('+3');

    await page.getByTestId('nav-cart').click();
    await expect(page.getByTestId('cart')).toBeVisible();
    await expect(page.getByTestId('cart').getByRole('listitem')).toHaveText(['2', '3']);
    expect(await page.evaluate(() => localStorage.getItem('cart:items'))).toBe('["2","3"]');
  });

  test('one click is one item, with a single subscriber however often the cart remounts', async ({
    page,
  }) => {
    await open(page);
    await page.getByTestId('nav-cart').click();
    await expect(page.getByTestId('cart')).toBeVisible();
    await page.getByTestId('nav-catalog').click();
    await expect(page.getByTestId('catalog-heading')).toBeVisible();
    await page.getByTestId('nav-cart').click();
    await page.getByTestId('nav-catalog').click();
    await expect(page.getByTestId('catalog-heading')).toBeVisible();
    await page.getByTestId('product-1').getByRole('button').click();
    await expect(page.getByTestId('mini-cart')).toHaveText('1 items');
    const count = await page.evaluate(() => {
      const state: unknown = Reflect.get(globalThis, Symbol.for('mfeflow.event-bus'));
      const listeners: unknown =
        typeof state === 'object' && state !== null ? Reflect.get(state, 'listeners') : undefined;
      const set: unknown =
        listeners instanceof Map ? listeners.get('cart.item-added.v1') : undefined;
      return set instanceof Set ? set.size : -1;
    });
    // The mini cart and the shell's status, and nothing left behind by the cart page.
    expect(count).toBe(2);
  });
});

test.describe('route-factory', () => {
  test('the shell nav is built from the contracts routes and moves between remotes without a page load', async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByTestId('nav-catalog')).toHaveAttribute('href', '/catalog');
    await expect(page.getByTestId('nav-cart')).toHaveAttribute('href', '/cart');
    await page.evaluate(() => {
      Reflect.set(globalThis, 'stillHere', true);
    });
    await page.getByTestId('nav-cart').click();
    await expect(page.getByTestId('cart')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/cart');
    expect(
      await page.evaluate((): unknown => {
        const still: unknown = Reflect.get(globalThis, 'stillHere');
        return still;
      }),
    ).toBe(true);
  });

  test('a path under a remote’s mount is served by that remote, and the front page by the catalog', async ({
    page,
  }) => {
    await page.goto('/cart/anything');
    await expect(page.getByTestId('cart')).toBeVisible();
    await page.goto('/');
    await expect(page.getByTestId('catalog-heading')).toBeVisible();
  });
});

test.describe('http', () => {
  test('a stock check retries a 503 and then shows the count', async ({ page }) => {
    await runtimeConfig(page, { apiOrigin: '' });
    const answers = [503, 200];
    let calls = 0;
    await page.route('**/stock/1', (route) => {
      calls += 1;
      const status = answers.shift() ?? 200;
      return status === 200
        ? route.fulfill({ json: { count: 4 } })
        : route.fulfill({ status, body: 'busy' });
    });
    await open(page);
    await page.getByTestId('check-stock').click();
    await expect(page.getByTestId('check-stock')).toHaveText('4 in stock');
    expect(calls).toBe(2);
  });

  test('a 404 is not retried, and the button says so', async ({ page }) => {
    await runtimeConfig(page, { apiOrigin: '' });
    let calls = 0;
    await page.route('**/stock/1', (route) => {
      calls += 1;
      return route.fulfill({ status: 404, json: { error: 'no such product' } });
    });
    await open(page);
    await page.getByTestId('check-stock').click();
    await expect.poll(() => calls).toBe(1);
    await expect(page.getByTestId('check-stock')).toHaveText('Stock unavailable');
  });
});
