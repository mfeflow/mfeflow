import { expect, test } from '@playwright/test';
import {
  flushSpans,
  parseTraceparent,
  providerName,
  runtimeConfig,
  startBackend,
  startCollector,
  telemetryRunning,
  type Backend,
  type CapturedSpan,
  type Collector,
} from './support';

let collector: Collector;
let backend: Backend;

test.beforeEach(async () => {
  collector = await startCollector();
  backend = await startBackend();
});
test.afterEach(async () => {
  await collector.close();
  await backend.close();
});

const urlOf = (span: CapturedSpan) =>
  String(span.attributes['url.full'] ?? span.attributes['http.url'] ?? '');

const findFetchSpan = () => collector.spans.find((s) => urlOf(s).endsWith('/stock/1'));

const config = (extra: Record<string, unknown> = {}) => ({
  otlpEndpoint: `${collector.origin}/v1/traces`,
  apiOrigin: backend.origin,
  propagateTraceHeaderCorsUrls: [backend.origin],
  ...extra,
});

test('a click in the shell, the remote fetch it starts and the backend span are one trace', async ({
  page,
}) => {
  await runtimeConfig(page, config());
  await page.goto('/catalog');
  await expect(page.getByTestId('catalog-heading')).toBeVisible();
  await telemetryRunning(page);

  await page.getByTestId('check-stock').click();
  await expect(page.getByTestId('check-stock')).toHaveText('7 in stock');
  // The fetch span ends a moment after the response, when the instrumentation has read the resource timing.
  await expect
    .poll(async () => {
      await flushSpans(page);
      return findFetchSpan() !== undefined;
    })
    .toBe(true);

  const click = collector.spans.find((s) => s.name === 'shell.check_stock_click');
  const stock = collector.spans.find((s) => s.name === 'catalog.check_stock');
  const fetchSpan = findFetchSpan();
  expect(click, 'click span').toBeDefined();
  expect(stock, 'remote span').toBeDefined();
  expect(fetchSpan, 'fetch span').toBeDefined();

  const received = backend.requests.map((r) => parseTraceparent(r.traceparent));
  expect(received).toHaveLength(1);
  const [reached] = received;
  expect(reached, 'the backend saw a traceparent').toBeDefined();

  expect(new Set([click?.traceId, stock?.traceId, fetchSpan?.traceId, reached?.traceId]).size).toBe(
    1,
  );
  expect(stock?.parentSpanId).toBe(click?.spanId);
  expect(fetchSpan?.parentSpanId).toBe(stock?.spanId);
  expect(reached?.parentSpanId).toBe(fetchSpan?.spanId);
  expect(reached?.sampled).toBe(true);

  expect(click?.attributes['mfe.name']).toBe('shell');
  expect(stock?.attributes['mfe.name']).toBe('catalog');
  expect(fetchSpan?.attributes['mfe.name']).toBe('catalog');
});

test('the exporter does not trace itself, and only the listed origin gets trace headers', async ({
  page,
}) => {
  const other = await startBackend();
  try {
    await runtimeConfig(page, config({ apiOrigin: other.origin }));
    await page.goto('/catalog');
    await telemetryRunning(page);
    await page.getByTestId('check-stock').click();
    await expect(page.getByTestId('check-stock')).toHaveText('7 in stock');
    await flushSpans(page);
    await expect.poll(() => collector.paths.some((p) => p.startsWith('POST'))).toBe(true);
    await flushSpans(page);
    expect(collector.spans.some((s) => urlOf(s).startsWith(collector.origin))).toBe(false);
    expect(other.requests[0]?.traceparent).toBeUndefined();
  } finally {
    await other.close();
  }
});

test('a sampling ratio of 0 sends no spans, and still passes the decision on', async ({ page }) => {
  await runtimeConfig(page, config({ traceSampleRatio: 0 }));
  await page.goto('/catalog');
  await telemetryRunning(page);
  await page.getByTestId('check-stock').click();
  await expect(page.getByTestId('check-stock')).toHaveText('7 in stock');
  await flushSpans(page);
  expect(
    collector.spans.filter((s) => s.name.startsWith('shell.') || s.name.startsWith('catalog.')),
  ).toEqual([]);
  expect(parseTraceparent(backend.requests[0]?.traceparent)?.sampled).toBe(false);
});

test('a remote that fails to load is reported with its name', async ({ page }) => {
  await runtimeConfig(page, config());
  await page.route('**/mfe/cart/**', (route) => route.fulfill({ status: 404, body: 'gone' }));
  await page.goto('/cart');
  await expect(page.locator('[data-mfeflow-fallback="cart"]').first()).toBeVisible();
  await telemetryRunning(page);
  await flushSpans(page);
  await expect.poll(() => collector.spans.some((s) => s.name === 'mfe.error')).toBe(true);
  const errors = collector.spans.filter((s) => s.name === 'mfe.error');
  expect(errors.every((s) => s.attributes['mfe.name'] === 'cart')).toBe(true);
  const where = errors.map((s) => s.attributes['mfe.error.where']);
  expect(where).toContain('load');
});

test('with no endpoint in the runtime config telemetry stays off and nothing is sent', async ({
  page,
}) => {
  await runtimeConfig(page, { otlpEndpoint: '' });
  await page.goto('/catalog');
  await expect(page.getByTestId('catalog-heading')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await providerName(page)).not.toBe('otel');
  expect(collector.paths).toEqual([]);
});

test('the SDK is downloaded after first paint and after the page has loaded', async ({ page }) => {
  await runtimeConfig(page, config());
  await page.goto('/catalog');
  await expect(page.getByTestId('catalog-heading')).toBeVisible();
  await telemetryRunning(page);
  const timing = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      loadStart: navigation instanceof PerformanceNavigationTiming ? navigation.loadEventStart : 0,
      firstPaint: paint?.startTime ?? 0,
      scripts: performance
        .getEntriesByType('resource')
        .filter((e) => e.name.endsWith('.js'))
        .map((e) => ({ url: e.name, start: e.startTime })),
    };
  });
  // `traceparent` is the W3C propagator's header name: only the chunk with the SDK has it.
  const bodies = await Promise.all(
    timing.scripts.map(async (script) => ({
      ...script,
      text: await (await page.request.get(script.url)).text(),
    })),
  );
  const sdk = bodies.find((script) => script.text.includes('traceparent'));
  expect(sdk, 'the chunk with the OpenTelemetry SDK').toBeDefined();
  expect(timing.firstPaint).toBeGreaterThan(0);
  expect(sdk?.start).toBeGreaterThanOrEqual(timing.firstPaint);
  expect(sdk?.start).toBeGreaterThanOrEqual(timing.loadStart);
});
