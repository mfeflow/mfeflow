import type { RegistryIndex } from '@mfeflow/contracts';
import { indexKey, INDEX_CACHE_CONTROL, type RegistryHost } from '../static';

export type Log = (level: 'info' | 'warn' | 'error', message: string) => void;

export interface FallbackOptions {
  host: RegistryHost;
  /** The stable-only index for an env right now, read again on every attempt so the latest state always wins. */
  stableIndex: (env: string) => Promise<RegistryIndex | undefined>;
  log: Log;
  /** Waits between retries. Tests pass one that returns at once. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Delay before retry n (0-based), in ms. */
  backoffMs?: (attempt: number) => number;
  /** Redacts secrets from an error before it is logged. */
  redact?: (text: string) => string;
}

const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
    timer.unref();
  });

const defaultBackoff = (attempt: number): number => Math.min(30_000, 1000 * 2 ** attempt);

/**
 * Keeps a static `envs/<env>/index.json` in step with the server so shells can boot from it when the
 * server is down. It runs beside requests, never inside them: a failed write is logged and retried
 * with backoff, and a newer change replaces an older one that has not landed.
 */
export class FallbackPublisher {
  private readonly dirty = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly stop = new AbortController();

  constructor(private readonly options: FallbackOptions) {}

  /** Ask for `env`'s fallback to be rewritten. Returns at once. */
  request(env: string): void {
    this.dirty.add(env);
    if (this.running.has(env) || this.stop.signal.aborted) return;
    const loop = this.loop(env).finally(() => this.running.delete(env));
    this.running.set(env, loop);
  }

  /** Resolves when nothing is pending. For tests and for a clean shutdown. */
  async idle(): Promise<void> {
    while (this.running.size > 0) {
      // oxlint-disable-next-line no-await-in-loop -- waits for one loop at a time
      await Promise.all(this.running.values());
    }
  }

  async close(): Promise<void> {
    this.stop.abort();
    await this.idle();
  }

  private async loop(env: string): Promise<void> {
    const { host, stableIndex, log } = this.options;
    const sleep = this.options.sleep ?? realSleep;
    const backoff = this.options.backoffMs ?? defaultBackoff;
    const redact = this.options.redact ?? ((s: string) => s);
    let attempt = 0;
    while (this.dirty.has(env) && !this.stop.signal.aborted) {
      this.dirty.delete(env);
      try {
        // oxlint-disable-next-line no-await-in-loop -- one write at a time per env, newest state each time
        const index = await stableIndex(env);
        if (index === undefined) continue;
        // oxlint-disable-next-line no-await-in-loop -- one write at a time per env
        await host.put(indexKey(env), `${JSON.stringify(index, null, 2)}\n`, {
          contentType: 'application/json',
          cacheControl: INDEX_CACHE_CONTROL,
        });
        attempt = 0;
      } catch (error) {
        const reason = redact(error instanceof Error ? error.message : String(error));
        const wait = backoff(attempt);
        attempt += 1;
        log(
          'warn',
          `fallback index for ${env} was not published (${reason}); retrying in ${String(wait)} ms`,
        );
        this.dirty.add(env);
        // oxlint-disable-next-line no-await-in-loop -- backoff between attempts
        await sleep(wait, this.stop.signal);
      }
    }
  }
}
