import { describe, expect, it, vi } from 'vitest';
import mfeflowEntryRetryPlugin, { createEntryRetryPlugin } from './entry-retry.js';

type Args = Parameters<NonNullable<ReturnType<typeof createEntryRetryPlugin>['loadEntryError']>>[0];

interface Harness {
  args: Args;
  urls: string[];
  loadingAtCall: (Promise<void> | undefined)[];
  globalLoading: Record<string, Promise<void> | undefined>;
}

// oxlint-disable typescript/no-unsafe-type-assertion -- the plugin reads only these fields; the rest is a stub
function harness(
  outcomes: (object | Error | undefined)[],
  entryUrl = 'http://x/remoteEntry.js',
): Harness {
  const urls: string[] = [];
  const loadingAtCall: (Promise<void> | undefined)[] = [];
  const globalLoading: Record<string, Promise<void> | undefined> = { cart: Promise.resolve() };
  let call = 0;
  const getRemoteEntry = vi.fn((params: { getEntryUrl?: (u: string) => string }) => {
    urls.push(params.getEntryUrl?.(entryUrl) ?? '');
    loadingAtCall.push(globalLoading.cart);
    const outcome = outcomes[call++];
    if (outcome instanceof Error) return Promise.reject(outcome);
    return Promise.resolve(outcome);
  });
  const args = {
    getRemoteEntry,
    origin: {},
    remoteInfo: { name: 'cart' },
    globalLoading,
    uniqueKey: 'cart',
  } as unknown as Args;
  return { args, urls, loadingAtCall, globalLoading };
}
// oxlint-enable typescript/no-unsafe-type-assertion

const run = (plugin: ReturnType<typeof createEntryRetryPlugin>, args: Args): Promise<unknown> =>
  Promise.resolve(plugin.loadEntryError?.(args));

describe('entry retry plugin', () => {
  it('retries a failed entry with a growing delay and a cache-busting query', async () => {
    vi.useFakeTimers();
    const exports = { get: () => undefined };
    const h = harness([new Error('404'), exports]);
    const pending = run(createEntryRetryPlugin({ delayMs: 100 }), h.args);
    await vi.advanceTimersByTimeAsync(99);
    expect(h.urls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.urls).toEqual(['http://x/remoteEntry.js?retry=1']);
    expect(h.loadingAtCall).toEqual([undefined]);
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe(exports);
    expect(h.urls).toEqual(['http://x/remoteEntry.js?retry=1', 'http://x/remoteEntry.js?retry=2']);
    vi.useRealTimers();
  });

  it('runs one retry for concurrent failures of the same remote and shares its result', async () => {
    vi.useFakeTimers();
    const exports = { get: () => undefined };
    const h = harness([exports]);
    const plugin = createEntryRetryPlugin({ delayMs: 100 });
    const first = run(plugin, h.args);
    await vi.advanceTimersByTimeAsync(50);
    const second = run(plugin, h.args);
    await vi.advanceTimersByTimeAsync(100);
    await expect(Promise.all([first, second])).resolves.toEqual([exports, exports]);
    expect(h.urls).toEqual(['http://x/remoteEntry.js?retry=1']);
    vi.useRealTimers();
  });

  it('does not drop a load another caller started while it waited', async () => {
    vi.useFakeTimers();
    const h = harness([{}]);
    const other = Promise.resolve();
    const pending = run(createEntryRetryPlugin({ delayMs: 100 }), h.args);
    h.globalLoading.cart = other;
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(h.globalLoading.cart).toBe(other);
    vi.useRealTimers();
  });

  it('lets a caller arriving during any delay join the retry instead of starting a plain load', async () => {
    vi.useFakeTimers();
    const exports = { get: () => undefined };
    const h = harness([new Error('404'), exports]);
    const original = h.globalLoading.cart;
    const pending = run(createEntryRetryPlugin({ delayMs: 100 }), h.args);
    await vi.advanceTimersByTimeAsync(50);
    const duringFirst = h.globalLoading.cart;
    expect(duringFirst).toBeDefined();
    expect(duringFirst).not.toBe(original);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.loadingAtCall).toEqual([undefined]);
    await vi.advanceTimersByTimeAsync(100);
    const duringSecond = h.globalLoading.cart;
    expect(duringSecond).toBe(duringFirst);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe(exports);
    await expect(duringSecond).resolves.toBe(exports);
    expect(h.globalLoading.cart).toBeUndefined();
    vi.useRealTimers();
  });

  it('rejects the callers that joined when every retry fails, and leaves nothing cached', async () => {
    vi.useFakeTimers();
    const h = harness([undefined]);
    const pending = run(createEntryRetryPlugin({ times: 1, delayMs: 10 }), h.args);
    await vi.advanceTimersByTimeAsync(5);
    const joined = h.globalLoading.cart;
    const rejection = expect(joined).rejects.toThrow(/failed to load after retries/);
    await vi.advanceTimersByTimeAsync(10);
    await pending;
    await rejection;
    expect(h.globalLoading.cart).toBeUndefined();
    vi.useRealTimers();
  });

  it('starts a fresh retry once the previous one has finished', async () => {
    const h = harness([undefined, {}]);
    const plugin = createEntryRetryPlugin({ times: 1, delayMs: 1 });
    await run(plugin, h.args);
    await run(plugin, h.args);
    expect(h.urls).toHaveLength(2);
  });

  it('gives up after the configured retries and lets the error through', async () => {
    const h = harness([new Error('a'), undefined, new Error('c')]);
    await expect(
      run(createEntryRetryPlugin({ times: 2, delayMs: 1 }), h.args),
    ).resolves.toBeUndefined();
    expect(h.urls).toHaveLength(2);
  });

  it('adds to a query string that is already there', async () => {
    const h = harness([{}], 'http://x/e.js?v=1');
    await run(createEntryRetryPlugin({ delayMs: 1 }), h.args);
    expect(h.urls).toEqual(['http://x/e.js?v=1&retry=1']);
  });

  it('has a default export with the plugin name', () => {
    expect(mfeflowEntryRetryPlugin().name).toBe('mfeflow-entry-retry');
  });
});
