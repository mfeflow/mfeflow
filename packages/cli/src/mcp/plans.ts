import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hasErrno } from '@mfeflow/core';

export const PLAN_TTL_MS = 10 * 60 * 1000;

/** Characters of diff in one answer; the rest is read with `mfeflow_plan_diff`. */
export const DIFF_PAGE = 12_000;

export const pageCount = (diff: string): number => Math.max(1, Math.ceil(diff.length / DIFF_PAGE));

/** Page `page` (from 1) of `diff`; pages joined in order give the diff back exactly. */
export const pageOf = (diff: string, page: number): string =>
  diff.slice((page - 1) * DIFF_PAGE, page * DIFF_PAGE);

export interface StoredPlan {
  id: string;
  /** `local` plans write files in the project; `registry` plans move what an environment serves. */
  scope: 'local' | 'registry';
  cwd: string;
  /** The command that applies the plan, as the CLI would be given it. */
  argv: string[];
  expiresAt: number;
  /** The whole diff of a local plan, read back page by page. */
  diff?: string;
  /** A dry run to repeat at apply: the plan is refused if it no longer gives this fingerprint. */
  verify?: { argv: string[]; fingerprint: string };
  /** Absolute path to what stood there when the plan was made: real path and sha256, or the absence. */
  hashes: Record<string, string>;
}

/** A refusal the agent can read: the plan is gone, too old, for another folder or out of date. */
export class PlanRefused extends Error {}

async function nearestRealPath(folder: string): Promise<string> {
  try {
    return await fs.realpath(folder);
  } catch (error) {
    const parent = path.dirname(folder);
    if (parent === folder || !(hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR')))
      throw error;
    return nearestRealPath(parent);
  }
}

/**
 * What stands at `file`: the real path (symlinks resolved) and the sha256 of its content. A file
 * that is not there is recorded too, with the real path of the nearest folder that is, so a
 * retargeted symlink or a file that appears is a change.
 */
export async function hashFile(file: string): Promise<string> {
  try {
    const real = await fs.realpath(file);
    const stat = await fs.stat(real);
    if (stat.isDirectory()) return `${real}\0dir`;
    const sum = createHash('sha256')
      .update(await fs.readFile(real))
      .digest('hex');
    return `${real}\0${sum}`;
  } catch (error) {
    if (!(hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR'))) throw error;
  }
  try {
    return `dangling\0${await fs.readlink(file)}`;
  } catch {
    return `absent\0${await nearestRealPath(path.dirname(file))}`;
  }
}

/** Hashes of every file the plan names, resolved against `root`. */
export async function hashTargets(
  root: string,
  relative: readonly string[],
): Promise<Record<string, string>> {
  const files = [...new Set(relative.map((rel) => path.resolve(root, rel)))];
  const entries = await Promise.all(
    files.map(async (file): Promise<[string, string]> => [file, await hashFile(file)]),
  );
  return Object.fromEntries(entries);
}

export class PlanStore {
  private readonly plans = new Map<string, StoredPlan>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = PLAN_TTL_MS,
  ) {}

  add(plan: Omit<StoredPlan, 'id' | 'expiresAt'>): StoredPlan {
    this.sweep();
    const stored = { ...plan, id: randomUUID(), expiresAt: this.now() + this.ttlMs };
    this.plans.set(stored.id, stored);
    return stored;
  }

  private find(id: string, scope: StoredPlan['scope'], cwd: string): StoredPlan {
    const plan = this.plans.get(id);
    if (plan?.scope !== scope) {
      throw new PlanRefused(`no ${scope} plan with id ${id}; it may have expired or been applied`);
    }
    if (plan.cwd !== cwd) throw new PlanRefused(`the plan was made for ${plan.cwd}, not ${cwd}`);
    if (this.now() > plan.expiresAt) {
      this.plans.delete(id);
      throw new PlanRefused('the plan expired; make a new one with mfeflow_plan');
    }
    return plan;
  }

  /** The plan, left in place: for reading its diff. */
  peek(id: string, scope: StoredPlan['scope'], cwd: string): StoredPlan {
    return this.find(id, scope, cwd);
  }

  /**
   * Returns the plan if it can still be applied here, and forgets it: a plan applies once. A call
   * from the wrong folder or scope leaves the plan alone; once those match it is removed before
   * anything is awaited.
   */
  async take(id: string, scope: StoredPlan['scope'], cwd: string): Promise<StoredPlan> {
    const plan = this.find(id, scope, cwd);
    this.plans.delete(id);
    const now = await Promise.all(
      Object.entries(plan.hashes).map(
        async ([file, before]) => [file, (await hashFile(file)) !== before] as const,
      ),
    );
    const changed = now.find(([, differs]) => differs);
    if (changed) {
      throw new PlanRefused(`${changed[0]} changed after the plan was made; make a new plan`);
    }
    return plan;
  }

  private sweep(): void {
    for (const [id, plan] of this.plans) if (this.now() > plan.expiresAt) this.plans.delete(id);
  }
}
