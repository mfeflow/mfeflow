import { describe, expect, it } from 'vitest';
import { inRollout } from './rollout';

const ids = Array.from({ length: 10_000 }, (_, i) => `client-${String(i)}`);

describe('inRollout', () => {
  it.each([1, 10, 50, 90])('puts about %i%% of 10k clients in the candidate', (percent) => {
    const hits = ids.filter((id) => inRollout(id, 'checkout', 'r1', percent)).length;
    expect(Math.abs(hits / 100 - percent)).toBeLessThan(1.5);
  });

  it('gives the same client the same answer every time', () => {
    for (const id of ids.slice(0, 500))
      expect(inRollout(id, 'checkout', 'r1', 30)).toBe(inRollout(id, 'checkout', 'r1', 30));
  });

  it('only adds clients as the percent grows', () => {
    for (const id of ids.slice(0, 2000))
      if (inRollout(id, 'checkout', 'r1', 10))
        expect(inRollout(id, 'checkout', 'r1', 50)).toBe(true);
  });

  it('is 0 for nobody and 100 for everybody', () => {
    expect(ids.some((id) => inRollout(id, 'checkout', 'r1', 0))).toBe(false);
    expect(ids.every((id) => inRollout(id, 'checkout', 'r1', 100))).toBe(true);
  });

  it('reshuffles for another rollout id or remote', () => {
    const a = ids.filter((id) => inRollout(id, 'checkout', 'r1', 50));
    const b = new Set(ids.filter((id) => inRollout(id, 'checkout', 'r2', 50)));
    const c = new Set(ids.filter((id) => inRollout(id, 'cart', 'r1', 50)));
    expect(a.filter((id) => b.has(id)).length).toBeLessThan(a.length * 0.6);
    expect(a.filter((id) => c.has(id)).length).toBeLessThan(a.length * 0.6);
  });
});
