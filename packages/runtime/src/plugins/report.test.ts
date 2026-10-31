import { afterEach, describe, expect, it } from 'vitest';
import mfeflowReportPlugin from './report.js';

afterEach(() => {
  globalThis.mfeflowReports = undefined;
});

describe('mfeflowReportPlugin', () => {
  it('records the remote name and lifecycle and lets the error through', async () => {
    const plugin = mfeflowReportPlugin();
    const events: unknown[] = [];
    window.addEventListener('mfeflow:remote-error', (e) => events.push(e));
    const hook = plugin.errorLoadRemote;
    expect(typeof hook).toBe('function');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unsafe-assignment -- the hook only reads id, error and lifecycle; origin is a stub
    const result: unknown = await hook?.({
      id: 'cart/App',
      error: new Error('Failed to get manifest'),
      from: 'runtime',
      lifecycle: 'onLoad',
      origin: {},
    } as never);
    expect(result).toBeUndefined();
    expect(globalThis.mfeflowReports).toEqual([
      expect.objectContaining({
        mfe: 'cart',
        where: 'errorLoadRemote:onLoad',
        message: 'Failed to get manifest',
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(plugin.name).toBe('mfeflow-report');
  });
});
