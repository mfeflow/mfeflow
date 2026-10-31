import fs from 'node:fs/promises';
import path from 'node:path';
import {
  applyPlan,
  isMfeflowError,
  messageOf,
  MfeflowError,
  renderDiff,
  summarize,
  type MfeflowProject,
  type Plan,
} from '@mfeflow/core';
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

/** The folders `mkdir -p root` will create, deepest first. Empty when `root` already exists. */
async function missingFolders(root: string): Promise<string[]> {
  const missing: string[] = [];
  let dir = root;
  // oxlint-disable-next-line no-await-in-loop -- a parent is only looked at once its child is missing
  while (!(await exists(dir))) {
    missing.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return missing;
}

/**
 * Takes back what this run created: `root` with everything an install put in it, then
 * the parent folders it made, each only while empty. Folders that were there before are
 * never in `missing`, so they are never touched, whatever form their path takes.
 */
async function removeCreated(missing: readonly string[]): Promise<string | undefined> {
  const [root, ...parents] = missing;
  if (root === undefined) return undefined;
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch (error) {
    return messageOf(error);
  }
  for (const dir of parents) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- each folder can only go once its child has
      await fs.rmdir(dir);
    } catch {
      break;
    }
  }
  return undefined;
}

/** E213 for a project folder that was just created, so the message does not point into a folder that is gone. */
function installFailed(error: MfeflowError, root: string, stuck: string | undefined): MfeflowError {
  const reason = messageOf(error.cause ?? error);
  if (stuck !== undefined) {
    return new MfeflowError('E213', `${reason}; could not remove ${root} (${stuck})`, {
      cause: error.cause,
      fix: `Delete ${root} by hand, check your network and package manager, then run the command again.`,
    });
  }
  return new MfeflowError('E213', `${reason}; removed the new folder ${root}`, {
    cause: error.cause,
    fix: 'Nothing was left behind. Check your network and package manager, then run the command again.',
  });
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
  const missing = await missingFolders(root);
  await fs.mkdir(root, { recursive: true });
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
    const stuck = await removeCreated(missing);
    if (missing.length > 0 && isMfeflowError(error) && error.code === 'MFEFLOW_E213') {
      throw installFailed(error, root, stuck);
    }
    throw error;
  }
  if (!installing) await request.afterWrite?.();
  return { dryRun: false, shown, written: result.written, installed: installing };
}
