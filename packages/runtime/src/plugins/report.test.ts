import { afterEach, describe, expect, it } from 'vitest';
import mfeflowReportPlugin from './report';

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

  it('adds the version the registry gave the remote', async () => {
    Reflect.set(globalThis, Symbol.for('mfeflow.remote-versions'), new Map([['cart', '1.2.3']]));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the hook only reads id, error and lifecycle
    await mfeflowReportPlugin().errorLoadRemote?.({
      id: 'cart/App',
      error: new Error('x'),
      from: 'runtime',
      lifecycle: 'onLoad',
      origin: {},
    } as never);
    Reflect.deleteProperty(globalThis, Symbol.for('mfeflow.remote-versions'));
    expect(globalThis.mfeflowReports?.[0]).toMatchObject({ mfe: 'cart', version: '1.2.3' });
  });
});
