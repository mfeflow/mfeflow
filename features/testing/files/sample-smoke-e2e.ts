import fs from 'node:fs';
import { expect, test } from '@playwright/test';

// The remotes the dev registry lists; each one's App carries data-testid="<name>".
const remotes = fs
  .readdirSync('registry/envs/dev')
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .toSorted();

// With env-t3 the shell fetches /config/runtime-config.json at boot and keeps it on globalThis.
const hasRuntimeConfig = fs.existsSync('scripts/check-runtime-config.ts');

test('the shell loads cleanly, with its runtime config', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  page.on('requestfailed', (request) =>
    problems.push(
      `request failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
    ),
  );
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      problems.push(`${String(response.status())} ${response.url()}`);
    }
  });
  await page.goto('/');
  await expect(page.locator('header')).toBeVisible();
  if (hasRuntimeConfig) {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const config: unknown = Reflect.get(globalThis, '__MFE_RUNTIME_CONFIG__');
          return typeof config === 'object' && config !== null && 'environment' in config
            ? config.environment
            : undefined;
        }),
      )
      .toBeTruthy();
  }
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});

for (const name of remotes) {
  test(`the shell renders ${name}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId(name)).toBeVisible();
  });
}
