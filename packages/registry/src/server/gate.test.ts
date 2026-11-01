import { describe, expect, it } from 'vitest';
import { DEFAULT_GATE, evaluateGate } from './gate';

const gate = (candidate: [number, number], stable: [number, number]) =>
  evaluateGate(
    { loads: candidate[0], errors: candidate[1] },
    { loads: stable[0], errors: stable[1] },
    DEFAULT_GATE,
  );

describe('evaluateGate', () => {
  it('waits below the minimum sample, even with every load failing', () => {
    expect(gate([199, 199], [5000, 0]).verdict).toBe('wait');
    expect(gate([0, 0], [0, 0]).verdict).toBe('wait');
  });

  it('judges at exactly the minimum sample', () => {
    expect(gate([200, 200], [5000, 0]).verdict).toBe('halt');
  });

  it('passes a candidate with no errors', () => {
    expect(gate([500, 0], [5000, 50]).verdict).toBe('ok');
    expect(gate([500, 0], [0, 0]).verdict).toBe('ok');
  });

  it('passes equal rates and a candidate better than stable', () => {
    expect(gate([400, 8], [4000, 80]).verdict).toBe('ok');
    expect(gate([400, 4], [4000, 80]).verdict).toBe('ok');
  });

  it('halts a clear regression and says the numbers', () => {
    const verdict = gate([300, 30], [3000, 30]);
    expect(verdict.verdict).toBe('halt');
    if (verdict.verdict !== 'halt') return;
    expect(verdict.candidateRate).toBeCloseTo(0.1);
    expect(verdict.stableRate).toBeCloseTo(0.01);
    expect(verdict.reason).toContain('10.0%');
    expect(verdict.reason).toContain('1.0%');
  });

  it('halts against a stable with no errors once the floor is passed', () => {
    expect(gate([200, 4], [1000, 0]).verdict).toBe('halt');
    expect(gate([200, 3], [1000, 0]).verdict).toBe('ok');
  });

  it('does not halt a noisy borderline case: over the factor but under the floor', () => {
    // 1.5% vs 0.5% is 3x stable but only one point worse.
    expect(gate([400, 6], [4000, 20]).verdict).toBe('ok');
  });

  it('does not halt exactly at the factor', () => {
    expect(gate([400, 24], [4000, 120]).verdict).toBe('ok');
  });

  it('honours custom settings', () => {
    const verdict = evaluateGate(
      { loads: 50, errors: 5 },
      { loads: 1000, errors: 10 },
      { minLoads: 50, factor: 3, floor: 0.01 },
    );
    expect(verdict.verdict).toBe('halt');
  });
});
