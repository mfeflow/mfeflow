export interface Run {
  /** `create-mfeflow my-app --yes --local`, without the install. */
  createMs: number;
  /** `pnpm install` against a warm store. */
  installMs: number;
  /** `pnpm dev` until the shell and every remote entry answer. */
  devMs: number;
  totalMs: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of nothing');
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function summarize(runs: readonly Run[]): Run {
  const of = (pick: (run: Run) => number): number => Math.round(median(runs.map(pick)));
  return {
    createMs: of((r) => r.createMs),
    installMs: of((r) => r.installMs),
    devMs: of((r) => r.devMs),
    totalMs: of((r) => r.totalMs),
  };
}

/** `2026-10-31` for a date, or `2026-10-31T09-15-00` when `withTime`, so reruns on one day do not overwrite. */
export function resultName(date: Date, withTime = false): string {
  const iso = date.toISOString();
  return withTime ? iso.slice(0, 19).replaceAll(':', '-') : iso.slice(0, 10);
}
