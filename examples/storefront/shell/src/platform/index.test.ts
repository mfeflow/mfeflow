import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initAnalytics = vi.fn();
const initTelemetry = vi.fn();
const createGtmProvider = vi.fn();

vi.mock('@mfeflow/analytics', () => ({ initAnalytics }));
vi.mock('@mfeflow/analytics/gtm', () => ({ createGtmProvider }));
vi.mock('@mfeflow/telemetry', () => ({ initTelemetry }));

const { startPlatform } = await import('./index');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  initAnalytics.mockReset();
  initTelemetry.mockReset();
  createGtmProvider.mockReset();
  Reflect.deleteProperty(globalThis, '__MFE_RUNTIME_CONFIG__');
});

const withConfig = (config: Record<string, unknown>) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(config))),
  );
};

describe('startPlatform', () => {
  it('starts both when both are configured', async () => {
    withConfig({ gtmId: 'GTM-ABC1234', otlpEndpoint: 'https://c.example.com/v1/traces' });
    await startPlatform();
    expect(initAnalytics).toHaveBeenCalledTimes(1);
    expect(initTelemetry).toHaveBeenCalledTimes(1);
  });

  it('starts telemetry when the analytics provider throws on a bad gtmId', async () => {
    createGtmProvider.mockImplementation(() => {
      throw new Error('bad container id');
    });
    withConfig({ gtmId: 'oops', otlpEndpoint: 'https://c.example.com/v1/traces' });
    await expect(startPlatform()).resolves.toBeUndefined();
    expect(initTelemetry).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[analytics] not started', expect.any(Error));
  });

  it('keeps analytics running when telemetry throws while starting', async () => {
    initTelemetry.mockImplementation(() => {
      throw new Error('boom');
    });
    withConfig({ gtmId: 'GTM-ABC1234', otlpEndpoint: 'https://c.example.com/v1/traces' });
    await expect(startPlatform()).resolves.toBeUndefined();
    expect(initAnalytics).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[telemetry] not started', expect.any(Error));
  });
});
