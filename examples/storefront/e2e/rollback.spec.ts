import { expect, test, type Browser } from '@playwright/test';
import {
  createRig,
  HEADING_V1,
  HEADING_V2,
  ROLLBACK_HOST,
  ROLLBACK_PORT,
} from './rollback-support';

const origin = `http://localhost:${String(ROLLBACK_PORT)}`;

/** A page in a new browser context, so nothing from an earlier load (HTTP cache, storage) is reused. */
async function freshHeading(browser: Browser): Promise<{ heading: string; assets: string[] }> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const assets: string[] = [];
    page.on('request', (r) => {
      if (r.url().startsWith(`${origin}/reg/`)) assets.push(r.url());
    });
    await page.goto(`${origin}/catalog`);
    const heading = await page.getByTestId('catalog-heading').textContent({ timeout: 15_000 });
    return { heading: heading ?? '', assets };
  } finally {
    await context.close();
  }
}

test('a rollback with the real commands shows the old version on a fresh page load', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const rig = createRig(`${origin}/reg`, ROLLBACK_HOST);
  try {
    rig.resetHost();
    for (const done of [
      rig.deploy('cart', '1.0.0'),
      rig.deploy('catalog', '1.0.0', 'v1'),
      rig.deploy('catalog', '2.0.0', 'v2'),
    ]) {
      expect(done.code, done.stdout + done.stderr).toBe(0);
    }

    const index = await fetch(`${origin}/registry/index.json`);
    expect(index.headers.get('cache-control')).toBe('public, max-age=60');

    const before = await freshHeading(browser);
    expect(before.heading).toBe(HEADING_V2);
    expect(before.assets.some((url) => url.includes('/catalog/2.0.0/'))).toBe(true);

    const back = rig.rollback('catalog');
    expect(back.code, back.stdout + back.stderr).toBe(0);

    const after = await freshHeading(browser);
    expect(after.heading).toBe(HEADING_V1);
    expect(after.assets.some((url) => url.includes('/catalog/1.0.0/'))).toBe(true);
    expect(after.assets.some((url) => url.includes('/catalog/2.0.0/'))).toBe(false);
  } finally {
    rig.resetHost();
    rig.cleanup();
  }
});
