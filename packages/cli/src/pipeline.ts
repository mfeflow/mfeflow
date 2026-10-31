import fs from 'node:fs/promises';
import path from 'node:path';
import {
  hasErrno,
  PlanBuilder,
  recordPlan,
  serializeProject,
  type MfeflowProject,
  type Plan,
} from '@mfeflow/core';
import { createRangeRewriter } from './local';
import { readPackageJson } from './version';

/** Reads a project file by its `/`-separated path; undefined when it does not exist. */
export function projectReader(root: string): (file: string) => Promise<string | undefined> {
  return async (file) => {
    try {
      return await fs.readFile(path.join(root, ...file.split('/')), 'utf8');
    } catch (error) {
      if (hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR')) return undefined;
      throw error;
    }
  };
}

/** A plan builder that reads `root`, keeps dependency versions in the catalog and resolves `@mfeflow/*` ranges. */
export function createBuilder(root: string, local: string | undefined, cwd: string): PlanBuilder {
  return new PlanBuilder(projectReader(root), {
    catalog: true,
    rewriteRange: createRangeRewriter(
      readPackageJson().version,
      local === undefined ? undefined : path.resolve(cwd, local),
    ),
  });
}

/** `plan` with the `mfeflow.json` change added, for the summary and the diff. */
export function withProjectChange(plan: Plan, project: MfeflowProject): Plan {
  const before = plan.projectBefore ?? null;
  const after = serializeProject(recordPlan(project, plan));
  if (before === after) return plan;
  return {
    ...plan,
    changes: [
      ...plan.changes,
      {
        path: 'mfeflow.json',
        action: before === null ? 'create' : 'patch',
        before,
        after,
        track: false,
        trust: 'first-party',
      },
    ],
  };
}
