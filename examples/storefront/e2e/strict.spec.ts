import { expect, test } from '@playwright/test';
import { analyticsCases } from './analytics-cases';

// The shell's development build (pnpm --filter @storefront/shell build:dev) renders under StrictMode with
// React's development checks, which run every effect twice. Production builds do not.
test.describe('StrictMode, development build', () => {
  test.use({ baseURL: 'http://localhost:4320' });
  analyticsCases();

  // Without this the cases above could pass on a production build, where StrictMode does nothing.
  test("is running React's development build", async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    await page.goto('/catalog');
    await expect(page.getByTestId('catalog-heading')).toBeVisible();
    expect(messages.some((text) => text.includes('Download the React DevTools'))).toBe(true);
  });
});
