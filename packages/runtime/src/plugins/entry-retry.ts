import type { ModuleFederationRuntimePlugin } from '@module-federation/enhanced/runtime';

// Runtime plugins run before the shared scope exists, so this file imports no
// shared modules (mirrors report.ts). It retries a remote entry script that
// failed to load (network, 404), not one that threw while executing.
export interface EntryRetryOptions {
  /** Retries after the first failure. Default 2. */
  times?: number;
  /** Wait before retry n is `delayMs * n`. Default 300. */
  delayMs?: number;
}

type LoadEntryErrorHook = NonNullable<ModuleFederationRuntimePlugin['loadEntryError']>;
type LoadEntryErrorArgs = Parameters<LoadEntryErrorHook>[0];
type EntryExports = Awaited<ReturnType<LoadEntryErrorArgs['getRemoteEntry']>>;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Retries a failed remote entry with a growing delay and a `?retry=n` cache-buster. */
export function createEntryRetryPlugin(
  options: EntryRetryOptions = {},
): ModuleFederationRuntimePlugin {
  const times = options.times ?? 2;
  const delayMs = options.delayMs ?? 300;

  async function retry({
    getRemoteEntry,
    origin,
    remoteInfo,
    remoteEntryExports,
    globalLoading,
    uniqueKey,
  }: LoadEntryErrorArgs): Promise<EntryExports | undefined> {
    for (let attempt = 1; attempt <= times; attempt++) {
      // oxlint-disable-next-line no-await-in-loop -- attempts are sequential on purpose
      await sleep(delayMs * attempt);
      // The failed load is cached; drop it so getRemoteEntry fetches again.
      // oxlint-disable-next-line typescript/no-dynamic-delete -- keyed by the remote's unique key
      delete globalLoading[uniqueKey];
      try {
        // oxlint-disable-next-line no-await-in-loop -- attempts are sequential on purpose
        const exports = await getRemoteEntry({
          origin,
          remoteInfo,
          remoteEntryExports,
          getEntryUrl: (url: string) =>
            `${url}${url.includes('?') ? '&' : '?'}retry=${String(attempt)}`,
        });
        if (exports) return exports;
      } catch {
        // next attempt
      }
    }
    return undefined;
  }

  return {
    name: 'mfeflow-entry-retry',
    // The hook type asks for Promise<Promise<exports>>; the runtime just awaits it, so a plain promise is right.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    loadEntryError: retry as unknown as LoadEntryErrorHook,
  };
}

export default function mfeflowEntryRetryPlugin(): ModuleFederationRuntimePlugin {
  return createEntryRetryPlugin();
}
