import { describe, expect, it, vi } from 'vitest';
import mfeflowEntryRetryPlugin, { createEntryRetryPlugin } from './entry-retry.js';

type Args = Parameters<NonNullable<ReturnType<typeof createEntryRetryPlugin>['loadEntryError']>>[0];

interface Harness {
  args: Args;
  urls: string[];
  globalLoading: Record<string, Promise<void> | undefined>;
}

// oxlint-disable typescript/no-unsafe-type-assertion -- the plugin reads only these fields; the rest is a stub
function harness(
  outcomes: (object | Error | undefined)[],
  entryUrl = 'http://x/remoteEntry.js',
): Harness {
  const urls: string[] = [];
  const globalLoading: Record<string, Promise<void> | undefined> = { cart: Promise.resolve() };
  let call = 0;
  const getRemoteEntry = vi.fn((params: { getEntryUrl?: (u: string) => string }) => {
    urls.push(params.getEntryUrl?.(entryUrl) ?? '');
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
  return { args, urls, globalLoading };
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
    expect(h.globalLoading.cart).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe(exports);
    expect(h.urls).toEqual(['http://x/remoteEntry.js?retry=1', 'http://x/remoteEntry.js?retry=2']);
    vi.useRealTimers();
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
