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

/** One rollback measurement. */
export interface RollbackRun {
  /** How long `mfeflow rollback` itself took. Not part of the visible time. */
  commandMs: number;
  /** From the command exiting to a fresh load showing the old version. */
  visibleMs: number;
  /** Fresh loads it took (1 unless the first still showed the new version). */
  attempts: number;
}

export function summarizeRollback(runs: readonly RollbackRun[]): RollbackRun {
  const of = (pick: (run: RollbackRun) => number): number => Math.round(median(runs.map(pick)));
  return {
    commandMs: of((r) => r.commandMs),
    visibleMs: of((r) => r.visibleMs),
    attempts: of((r) => r.attempts),
  };
}

/** `2026-10-31-rollback`, so the rollback result sits next to the time-to-running one of the same day. */
export function rollbackResultName(date: Date, withTime = false): string {
  return `${resultName(date, withTime)}-rollback`;
}

/** Whether a registry index (as parsed JSON) has `remote` at `version`. The HTTP fallback's "is the old version live". */
export function indexServes(index: unknown, remote: string, version: string): boolean {
  if (typeof index !== 'object' || index === null) return false;
  const remotes: unknown = Reflect.get(index, 'remotes');
  if (!Array.isArray(remotes)) return false;
  return remotes.some(
    (r: unknown) =>
      typeof r === 'object' &&
      r !== null &&
      Reflect.get(r, 'name') === remote &&
      Reflect.get(r, 'version') === version,
  );
}

/** The `remoteEntry` URL an index lists for `remote`, if it lists one. */
export function remoteEntryOf(index: unknown, remote: string): string | undefined {
  if (typeof index !== 'object' || index === null) return undefined;
  const remotes: unknown = Reflect.get(index, 'remotes');
  if (!Array.isArray(remotes)) return undefined;
  for (const r of remotes as unknown[]) {
    if (typeof r !== 'object' || r === null || Reflect.get(r, 'name') !== remote) continue;
    const entry: unknown = Reflect.get(r, 'remoteEntry');
    return typeof entry === 'string' ? entry : undefined;
  }
  return undefined;
}
