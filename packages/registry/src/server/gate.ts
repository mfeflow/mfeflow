export interface Counts {
  loads: number;
  errors: number;
}

export interface GateSettings {
  /** Candidate loads needed before the gate judges anything. */
  minLoads: number;
  /** The candidate halts only when its error rate is over the stable rate times this. */
  factor: number;
  /** ...and over the stable rate by at least this much (0.02 is two points), so a quiet stable does not make noise a regression. */
  floor: number;
}

export const DEFAULT_GATE: GateSettings = { minLoads: 200, factor: 2, floor: 0.02 };

export type GateVerdict =
  | { verdict: 'wait'; reason: string }
  | { verdict: 'ok'; candidateRate: number; stableRate: number }
  | { verdict: 'halt'; reason: string; candidateRate: number; stableRate: number };

const rateOf = (c: Counts): number => (c.loads === 0 ? 0 : c.errors / c.loads);
const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

/** Judges a rollout candidate against stable from their load and error counts. Pure. */
export function evaluateGate(
  candidate: Counts,
  stable: Counts,
  settings: GateSettings = DEFAULT_GATE,
): GateVerdict {
  if (candidate.loads < settings.minLoads)
    return {
      verdict: 'wait',
      reason: `${String(candidate.loads)} of ${String(settings.minLoads)} candidate loads so far`,
    };
  const candidateRate = rateOf(candidate);
  const stableRate = rateOf(stable);
  const regressed =
    candidateRate > stableRate * settings.factor && candidateRate - stableRate >= settings.floor;
  if (!regressed) return { verdict: 'ok', candidateRate, stableRate };
  return {
    verdict: 'halt',
    reason: `candidate error rate ${pct(candidateRate)} (${String(candidate.errors)}/${String(candidate.loads)}) is over ${String(settings.factor)}x stable's ${pct(stableRate)} (${String(stable.errors)}/${String(stable.loads)})`,
    candidateRate,
    stableRate,
  };
}
