import { COST_MODEL, round1, type CostModel } from './cost-model';

const KB = 1024;

/** The expose a remote's route loads first: `./App`, else the first one. */
export function primaryExpose(names: readonly string[]): string | undefined {
  return names.includes('./App') ? './App' : names[0];
}

export interface RemoteInitialVerdict {
  /** Gzip KB that were judged, one decimal: the entry plus the primary expose, or the entry alone without an app file budget. */
  kb: number;
  /** Gzip KB of the entry plus the primary expose, whichever was judged. */
  totalKb: number;
  limitKb: number;
  pass: boolean;
  /** Where the limit came from: the remote's `mfeflow.app.json` budget or the cost model. */
  source: 'mfeflow.app.json' | 'cost-model';
}

/**
 * Judges the JS a remote loads first. With a `mfeflow.app.json` `budgets.initialJsKb` the entry plus the
 * primary expose must fit it; without one the entry alone must fit the cost model's `remoteKb`.
 */
export function judgeRemoteInitial(
  bytes: { entryBytes: number; exposeBytes: number },
  budgetKb: number | undefined,
  model: CostModel = COST_MODEL,
): RemoteInitialVerdict {
  const totalKb = round1((bytes.entryBytes + bytes.exposeBytes) / KB);
  if (budgetKb !== undefined)
    return {
      kb: totalKb,
      totalKb,
      limitKb: budgetKb,
      pass: totalKb <= budgetKb,
      source: 'mfeflow.app.json',
    };
  const kb = round1(bytes.entryBytes / KB);
  return { kb, totalKb, limitKb: model.remoteKb, pass: kb <= model.remoteKb, source: 'cost-model' };
}
