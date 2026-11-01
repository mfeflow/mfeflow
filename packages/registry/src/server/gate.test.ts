import { describe, expect, it } from 'vitest';
import { DEFAULT_GATE, evaluateGate } from './gate';

const gate = (candidate: [number, number], stable: [number, number]) =>
  evaluateGate(
    { loads: candidate[0], errors: candidate[1], clients: candidate[0] },
    { loads: stable[0], errors: stable[1], clients: stable[0] },
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
    expect(gate([500, 0], [50, 0]).verdict).toBe('ok');
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

  it('waits for enough distinct clients on each side, however many loads and errors', () => {
    const few = { loads: 1000, errors: 1000, clients: 49 };
    const many = { loads: 1000, errors: 10, clients: 1000 };
    expect(evaluateGate(few, many, DEFAULT_GATE).verdict).toBe('wait');
    expect(evaluateGate(many, { ...few, errors: 0 }, DEFAULT_GATE).verdict).toBe('wait');
    expect(evaluateGate({ ...few, clients: 50 }, many, DEFAULT_GATE).verdict).toBe('halt');
  });

  it('waits when stable has no reports at all', () => {
    expect(gate([500, 500], [0, 0]).verdict).toBe('wait');
  });

  it('honours custom settings', () => {
    const verdict = evaluateGate(
      { loads: 50, errors: 5, clients: 50 },
      { loads: 1000, errors: 10, clients: 1000 },
      { minLoads: 50, minClients: 50, factor: 3, floor: 0.01 },
    );
    expect(verdict.verdict).toBe('halt');
  });
});
