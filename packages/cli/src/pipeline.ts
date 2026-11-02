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
import { gt } from 'semver';
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

/**
 * A plan builder that reads `root`, keeps dependency versions in the catalog and resolves `@mfeflow/*` ranges.
 * `links` maps a package name to the `link:` path it is installed from instead of a registry range.
 */
export function createBuilder(
  root: string,
  checkout: string | undefined,
  links: Readonly<Record<string, string>> = {},
): PlanBuilder {
  const own = createRangeRewriter(readPackageJson().version, checkout);
  return new PlanBuilder(projectReader(root), {
    catalog: true,
    rewriteRange: (name, range) => links[name] ?? own(name, range),
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

/**
 * `project` with `cli` set to the running version, but only when the plan already changes
 * something and only upward: an older CLI never lowers it, and a run with nothing to do
 * leaves `mfeflow.json` alone.
 */
export function stampCli(project: MfeflowProject, plan: Plan): MfeflowProject {
  if (withProjectChange(plan, project).changes.length === 0) return project;
  return raiseCli(project);
}

/** `project` with `cli` raised to the running version; never lowered. */
export function raiseCli(project: MfeflowProject): MfeflowProject {
  const running = readPackageJson().version;
  if (project.cli !== undefined && !gt(running, project.cli)) return project;
  return { ...project, cli: running };
}
