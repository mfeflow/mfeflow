import fs from 'node:fs/promises';
import path from 'node:path';
import { applyPlan, renderDiff, summarize, type MfeflowProject, type Plan } from '@mfeflow/core';
import { Cancelled } from './exit';
import type { Globals } from './args';
import { withProjectChange } from './pipeline';
import type { Runtime } from './runtime';

export interface WriteRequest {
  rt: Runtime;
  globals: Globals;
  root: string;
  plan: Plan;
  /** The project as it will be after the plan, saved to `mfeflow.json` in the same transaction. */
  project: MfeflowProject;
  /** Runs once the files are written, before the install (`git init` for hooks that need a repo). */
  afterWrite?: () => Promise<void>;
}

export interface WriteOutcome {
  dryRun: boolean;
  /** The plan including the `mfeflow.json` change. */
  shown: Plan;
  written: string[];
  installed: boolean;
  diff?: string;
}

/** Removes the folders `mkdir -p` made, from the deepest up to `first`, when they are empty. */
async function removeCreated(root: string, first: string | undefined): Promise<void> {
  if (first === undefined) return;
  let dir = root;
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- each folder can only go once its child has
      await fs.rmdir(dir);
    } catch {
      return;
    }
    if (dir === first) return;
    dir = path.dirname(dir);
  }
}

async function exists(dir: string): Promise<boolean> {
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shows the plan and, unless this is a dry run, writes it: all or nothing, with
 * the install inside the transaction. Backing out at the prompt writes nothing.
 */
export async function writePlan(request: WriteRequest): Promise<WriteOutcome> {
  const { rt, globals, root, plan, project } = request;
  const shown = withProjectChange(plan, project);
  if (!globals.json) {
    rt.io.stdout(summarize(shown));
    if (globals.dryRun || globals.verbose) rt.io.stdout(`\n${renderDiff(shown)}`);
  }
  if (globals.dryRun) {
    // A folder that does not exist yet cannot clash with anything; do not create it to find out.
    if (await exists(root)) await applyPlan(plan, { root, project, dryRun: true });
    return { dryRun: true, shown, written: [], installed: false, diff: renderDiff(shown) };
  }
  const canPrompt = rt.io.interactive && !globals.yes && !globals.json;
  if (canPrompt && !(await rt.prompter.confirm({ message: 'Write these changes?' }))) {
    throw new Cancelled();
  }
  const installing = globals.install && plan.dependencies.length > 0;
  const created = await fs.mkdir(root, { recursive: true });
  let result;
  try {
    result = await applyPlan(plan, {
      root,
      project,
      ...(installing
        ? {
            install: async () => {
              await request.afterWrite?.();
              await rt.system.install(root, project.packageManager, globals.verbose);
            },
          }
        : {}),
    });
  } catch (error) {
    await removeCreated(root, created);
    throw error;
  }
  if (!installing) await request.afterWrite?.();
  return { dryRun: false, shown, written: result.written, installed: installing };
}
