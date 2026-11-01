export interface RateLimitOptions {
  /** Requests a quiet client can make at once. */
  burst: number;
  /** Tokens added per minute. */
  perMinute: number;
  /** Most clients remembered; the one idle longest is forgotten first. */
  maxClients?: number;
  now?: () => number;
}

export interface RateLimiter {
  /** Takes a token for this client, or says how many seconds until one is back. */
  take(client: string): { ok: true } | { ok: false; retryAfterSeconds: number };
  size(): number;
}

/** A token bucket per client, kept in memory. A restart resets it, which is fine for a spam guard. */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const maxClients = options.maxClients ?? 10_000;
  const perMs = options.perMinute / 60_000;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(client) {
      const t = now();
      const known = buckets.get(client);
      const tokens = Math.min(
        options.burst,
        (known?.tokens ?? options.burst) + (known === undefined ? 0 : (t - known.at) * perMs),
      );
      // Delete then set keeps the map in least-recently-used order.
      buckets.delete(client);
      if (tokens < 1) {
        buckets.set(client, { tokens, at: t });
        return {
          ok: false,
          retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)),
        };
      }
      buckets.set(client, { tokens: tokens - 1, at: t });
      while (buckets.size > maxClients) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
      return { ok: true };
    },
    size: () => buckets.size,
  };
}
