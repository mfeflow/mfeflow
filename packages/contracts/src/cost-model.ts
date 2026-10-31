/** What federating costs on one route, against the same pages built as one app. */
export interface CostModel {
  /** Largest contentful paint the shell may add, in milliseconds. */
  lcpDeltaMs: number;
  /** JS the shell adds over the one-app build, in KB (1 KB = 1024 bytes). */
  shellKb: number;
  /** JS each remote on the route adds, in KB. */
  remoteKb: number;
}

export const COST_MODEL: CostModel = { lcpDeltaMs: 300, shellKb: 32, remoteKb: 10 };

const KB = 1024;

export interface CostSample {
  /** Bytes of script the shell page loads from its own files (not `/mfe/<name>/`). */
  shellBytes: number;
  /** Bytes of script the one-app build loads on the same route. */
  monolithBytes: number;
  /** Bytes of script each remote on the route loads. */
  remoteBytes: Record<string, number>;
  lcpDeltaMs: number;
}

export interface CostLine {
  budget: number;
  actual: number;
  pass: boolean;
}

export interface CostVerdict {
  pass: boolean;
  lcp: CostLine;
  shell: CostLine;
  remotes: (CostLine & { name: string })[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

const line = (actual: number, budget: number): CostLine => ({
  budget,
  actual,
  pass: actual <= budget,
});

/** Judges one measured route against the cost model. Sizes come back in KB, one decimal. */
export function judgeCost(sample: CostSample, model: CostModel = COST_MODEL): CostVerdict {
  const lcp = line(Math.round(sample.lcpDeltaMs), model.lcpDeltaMs);
  const shell = line(round1((sample.shellBytes - sample.monolithBytes) / KB), model.shellKb);
  const remotes = Object.entries(sample.remoteBytes)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, bytes]) => Object.assign(line(round1(bytes / KB), model.remoteKb), { name }));
  return {
    pass: lcp.pass && shell.pass && remotes.every((r) => r.pass),
    lcp,
    shell,
    remotes,
  };
}

const REMOTE_PATH = /^\/mfe\/([^/]+)\//;

/**
 * Splits the scripts a shell page loaded into the shell's own and each remote's, by where
 * they were served from: remotes live under `/mfe/<name>/` on the shell's origin.
 */
export function splitScripts(requests: readonly { path: string; type: string; bytes: number }[]): {
  shellBytes: number;
  remoteBytes: Record<string, number>;
} {
  let shellBytes = 0;
  const remoteBytes: Record<string, number> = {};
  for (const request of requests) {
    if (request.type !== 'Script') continue;
    const remote = REMOTE_PATH.exec(request.path)?.[1];
    if (remote === undefined) shellBytes += request.bytes;
    else remoteBytes[remote] = (remoteBytes[remote] ?? 0) + request.bytes;
  }
  return { shellBytes, remoteBytes };
}
