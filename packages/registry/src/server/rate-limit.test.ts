import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  it('lets a burst through, then refuses with a retry time', () => {
    let t = 0;
    const limiter = createRateLimiter({ burst: 3, perMinute: 60, now: () => t });
    expect([1, 2, 3].map(() => limiter.take('a').ok)).toEqual([true, true, true]);
    const refused = limiter.take('a');
    expect(refused).toEqual({ ok: false, retryAfterSeconds: 1 });
    t += 1000;
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
  });

  it('keeps clients apart', () => {
    const limiter = createRateLimiter({ burst: 1, perMinute: 1, now: () => 0 });
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
    expect(limiter.take('b').ok).toBe(true);
  });

  it('never refills past the burst', () => {
    let t = 0;
    const limiter = createRateLimiter({ burst: 2, perMinute: 600, now: () => t });
    limiter.take('a');
    t += 3_600_000;
    expect([1, 2, 3].map(() => limiter.take('a').ok)).toEqual([true, true, false]);
  });

  it('forgets the longest idle client past its cap', () => {
    const limiter = createRateLimiter({ burst: 1, perMinute: 1, maxClients: 2, now: () => 0 });
    limiter.take('a');
    limiter.take('b');
    limiter.take('c');
    expect(limiter.size()).toBe(2);
    expect(limiter.take('a').ok).toBe(true);
  });
});
