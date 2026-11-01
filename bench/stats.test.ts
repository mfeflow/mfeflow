import { describe, expect, it } from 'vitest';
import {
  indexServes,
  median,
  remoteEntryOf,
  resultName,
  rollbackResultName,
  summarize,
  summarizeRollback,
} from './stats';

describe('median', () => {
  it('takes the middle of an odd list and the mean of the middle two of an even one', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('does not reorder its input and refuses an empty list', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
    expect(() => median([])).toThrow('median of nothing');
  });
});

describe('summarize', () => {
  it('takes the median of each phase, not of the total, and rounds', () => {
    const run = (createMs: number, installMs: number, devMs: number) => ({
      createMs,
      installMs,
      devMs,
      totalMs: createMs + installMs + devMs,
    });
    expect(summarize([run(1, 10, 100), run(3, 30, 300), run(2, 20, 200.4)])).toEqual({
      createMs: 2,
      installMs: 20,
      devMs: 200,
      totalMs: 222,
    });
  });
});

describe('resultName', () => {
  it('names a result by date, or by date and time', () => {
    const date = new Date('2026-10-31T09:15:00.000Z');
    expect(resultName(date)).toBe('2026-10-31');
    expect(resultName(date, true)).toBe('2026-10-31T09-15-00');
  });
});

describe('summarizeRollback', () => {
  it('takes the median of each field and rounds', () => {
    const run = (commandMs: number, visibleMs: number, attempts: number) => ({
      commandMs,
      visibleMs,
      attempts,
    });
    expect(summarizeRollback([run(300, 900, 1), run(100, 500.4, 1), run(200, 700, 2)])).toEqual({
      commandMs: 200,
      visibleMs: 700,
      attempts: 1,
    });
  });
});

describe('rollbackResultName', () => {
  it('is the day plus -rollback, with the time when asked', () => {
    const at = new Date('2026-11-01T09:15:00Z');
    expect(rollbackResultName(at)).toBe('2026-11-01-rollback');
    expect(rollbackResultName(at, true)).toBe('2026-11-01T09-15-00-rollback');
  });
});

describe('indexServes', () => {
  const index = { remotes: [{ name: 'catalog', version: '1.0.0' }, { name: 'cart' }] };
  it('is true only for the remote at that version', () => {
    expect(indexServes(index, 'catalog', '1.0.0')).toBe(true);
    expect(indexServes(index, 'catalog', '2.0.0')).toBe(false);
    expect(indexServes(index, 'cart', '1.0.0')).toBe(false);
    expect(indexServes(index, 'missing', '1.0.0')).toBe(false);
  });
  it('is false for anything that is not an index', () => {
    for (const bad of [null, 'x', 3, {}, { remotes: 'no' }, { remotes: [null, 4] }])
      expect(indexServes(bad, 'catalog', '1.0.0')).toBe(false);
  });
});

describe('remoteEntryOf', () => {
  const index = {
    remotes: [{ name: 'catalog', remoteEntry: 'https://cdn.test/catalog.js' }, { name: 'cart' }],
  };
  it('returns the entry of that remote, or nothing', () => {
    expect(remoteEntryOf(index, 'catalog')).toBe('https://cdn.test/catalog.js');
    expect(remoteEntryOf(index, 'cart')).toBeUndefined();
    expect(remoteEntryOf(index, 'missing')).toBeUndefined();
    expect(remoteEntryOf({ remotes: 3 }, 'catalog')).toBeUndefined();
    expect(remoteEntryOf(null, 'catalog')).toBeUndefined();
  });
});
