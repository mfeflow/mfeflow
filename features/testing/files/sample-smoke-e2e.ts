import fs from 'node:fs';
import { expect, test } from '@playwright/test';

// The remotes the dev registry lists; each one's App carries data-testid="<name>".
const remotes = fs
  .readdirSync('registry/envs/dev')
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .toSorted();

test('the shell loads without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('header')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const name of remotes) {
  test(`the shell renders ${name}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId(name)).toBeVisible();
  });
}
