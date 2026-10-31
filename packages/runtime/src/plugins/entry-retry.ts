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
type Loaded = Exclude<EntryExports, false | void | undefined>;

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

  // One retry loop per remote: callers that fail while it runs share its result.
  const inFlight = new Map<string, Promise<EntryExports | undefined>>();

  async function attempts(
    {
      getRemoteEntry,
      origin,
      remoteInfo,
      remoteEntryExports,
      globalLoading,
      uniqueKey,
    }: LoadEntryErrorArgs,
    joinable: Promise<Loaded>,
  ): Promise<EntryExports | undefined> {
    let failed = globalLoading[uniqueKey];
    try {
      for (let attempt = 1; attempt <= times; attempt++) {
        // Callers arriving while we wait join this retry instead of starting a plain load; never replace a load someone else started.
        if (globalLoading[uniqueKey] === failed || globalLoading[uniqueKey] === undefined) {
          globalLoading[uniqueKey] = joinable;
          failed = joinable;
        }
        // oxlint-disable-next-line no-await-in-loop -- attempts are sequential on purpose
        await sleep(delayMs * attempt);
        if (globalLoading[uniqueKey] === failed) {
          // oxlint-disable-next-line typescript/no-dynamic-delete -- keyed by the remote's unique key
          delete globalLoading[uniqueKey];
        }
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
        failed = globalLoading[uniqueKey];
      }
      return undefined;
    } finally {
      if (globalLoading[uniqueKey] === joinable) {
        // oxlint-disable-next-line typescript/no-dynamic-delete -- keyed by the remote's unique key
        delete globalLoading[uniqueKey];
      }
    }
  }

  function retry(args: LoadEntryErrorArgs): Promise<EntryExports | undefined> {
    const running = inFlight.get(args.uniqueKey);
    if (running) return running;
    let settle!: (exports: EntryExports | undefined) => void;
    const settled = new Promise<EntryExports | undefined>((resolve) => {
      settle = resolve;
    });
    const joinable = settled.then((exports) => {
      if (!exports)
        throw new Error(`entry of "${args.remoteInfo.name}" failed to load after retries`);
      return exports;
    });
    joinable.catch(() => undefined);
    const started = attempts(args, joinable)
      .finally(() => {
        inFlight.delete(args.uniqueKey);
      })
      .then((exports) => {
        settle(exports);
        return exports;
      });
    inFlight.set(args.uniqueKey, started);
    return started;
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
