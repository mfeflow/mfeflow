import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hasErrno } from '@mfeflow/core';

export const PLAN_TTL_MS = 10 * 60 * 1000;

export interface StoredPlan {
  id: string;
  /** `local` plans write files in the project; `registry` plans move what an environment serves. */
  scope: 'local' | 'registry';
  cwd: string;
  /** The command that applies the plan, as the CLI would be given it. */
  argv: string[];
  expiresAt: number;
  /** Absolute path to sha256 of the file when the plan was made; null when it did not exist. */
  hashes: Record<string, string | null>;
}

/** A refusal the agent can read: the plan is gone, too old, for another folder or out of date. */
export class PlanRefused extends Error {}

export async function hashFile(file: string): Promise<string | null> {
  try {
    return createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
  } catch (error) {
    if (hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR')) return null;
    throw error;
  }
}

/** Hashes of every file the plan names, resolved against `root`. */
export async function hashTargets(
  root: string,
  relative: readonly string[],
): Promise<Record<string, string | null>> {
  const files = [...new Set(relative.map((rel) => path.resolve(root, rel)))];
  const entries = await Promise.all(
    files.map(async (file): Promise<[string, string | null]> => [file, await hashFile(file)]),
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

  /** Returns the plan if it can still be applied here, and forgets it: a plan applies once. */
  async take(id: string, scope: StoredPlan['scope'], cwd: string): Promise<StoredPlan> {
    const plan = this.plans.get(id);
    if (plan?.scope !== scope) {
      throw new PlanRefused(`no ${scope} plan with id ${id}; it may have expired or been applied`);
    }
    this.plans.delete(id);
    if (this.now() > plan.expiresAt) {
      throw new PlanRefused('the plan expired; make a new one with mfeflow_plan');
    }
    if (plan.cwd !== cwd) {
      throw new PlanRefused(`the plan was made for ${plan.cwd}, not ${cwd}`);
    }
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
