export interface RetryOptions {
  /** Extra tries after the first. Default 2. */
  retries?: number;
  /** First wait before a retry, in ms; each one doubles, with jitter. Default 200. */
  baseDelayMs?: number;
  /** Longest wait in ms. A server that asks for longer (Retry-After) is not waited for. Default 2000. */
  maxDelayMs?: number;
}

export const DEFAULT_RETRY = { retries: 2, baseDelayMs: 200, maxDelayMs: 2000 };

/** Methods that are safe to send twice (RFC 9110). POST and PATCH are never retried. */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const RETRY_STATUS = new Set([408, 425, 429, 502, 503, 504]);

export const canRetryMethod = (method: string): boolean => IDEMPOTENT.has(method);
export const canRetryStatus = (status: number): boolean => RETRY_STATUS.has(status);

/** The wait asked for by a `Retry-After` header (seconds or a date), in ms; undefined without one. */
export function retryAfterMs(headers: Headers, now = Date.now()): number | undefined {
  const value = headers.get('retry-after')?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Exponential backoff with full jitter: somewhere between 0 and base * 2^attempt, capped. */
export function backoffMs(
  attempt: number,
  options: Required<RetryOptions>,
  random = Math.random,
): number {
  return Math.round(random() * Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt));
}

/** Resolves after `ms`; rejects with the signal's reason if it aborts first. */
export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
