import { describe, expect, it } from 'vitest';
import { median, percentile, resultName, summarize } from './stats';

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

describe('percentile', () => {
  it('takes the nearest rank and does not reorder its input', () => {
    const values = [30, 10, 20, 40, 50];
    expect(percentile(values, 50)).toBe(30);
    expect(percentile(values, 95)).toBe(50);
    expect(percentile(values, 0)).toBe(10);
    expect(values).toEqual([30, 10, 20, 40, 50]);
  });

  it('refuses an empty list', () => {
    expect(() => percentile([], 95)).toThrow('nothing');
  });
});
