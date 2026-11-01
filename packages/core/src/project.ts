import path from 'node:path';
import {
  isMfeflowProject,
  SCHEMA_URLS,
  validateMfeflowProject,
  type Issue,
  type MfeflowProject,
} from '@mfeflow/contracts';
import { MfeflowError, messageOf } from './errors';
import { readIfExists, realFs, writeFileAtomic, type FsOps } from './fs';
import { hashContent } from './hash';
import { resolveInRoot } from './paths';
import type { Plan } from './plan';

export const PROJECT_FILE = 'mfeflow.json';

export type { MfeflowProject };

function describeIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.path || '(root)'} ${i.message}`).join('; ');
}

/** Parses and validates the text of an `mfeflow.json`. */
export function parseProject(text: string): MfeflowProject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new MfeflowError('E103', messageOf(error), { cause: error });
  }
  if (!isMfeflowProject(value))
    throw new MfeflowError('E104', describeIssues(validateMfeflowProject(value)));
  return value;
}

/** Stable text for `mfeflow.json`: schema first, hashes sorted, trailing newline. */
export function serializeProject(project: MfeflowProject): string {
  const issues = validateMfeflowProject(project);
  if (issues.length > 0) throw new MfeflowError('E104', describeIssues(issues));
  const { $schema, ...rest } = project;
  const files = rest.files && Object.fromEntries(Object.entries(rest.files).toSorted(byKey));
  const kept = rest.kept && Object.fromEntries(Object.entries(rest.kept).toSorted(byKey));
  const ordered = {
    $schema: $schema ?? SCHEMA_URLS.project,
    ...rest,
    ...(files ? { files } : {}),
    ...(kept ? { kept } : {}),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function byKey(a: [string, unknown], b: [string, unknown]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

export async function loadProject(root: string, ops: FsOps = realFs): Promise<MfeflowProject> {
  const text = await readIfExists(ops, resolveInRoot(root, PROJECT_FILE));
  if (text === undefined) throw new MfeflowError('E102', `looked in ${root}`);
  return parseProject(text);
}

export async function saveProject(
  root: string,
  project: MfeflowProject,
  ops: FsOps = realFs,
): Promise<void> {
  await writeFileAtomic(ops, resolveInRoot(root, PROJECT_FILE), serializeProject(project));
}

/** The nearest folder at or above `start` that holds an `mfeflow.json`. */
export async function findProjectRoot(start: string, ops: FsOps = realFs): Promise<string> {
  const search = async (dir: string): Promise<string> => {
    if ((await readIfExists(ops, path.join(dir, PROJECT_FILE))) !== undefined) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new MfeflowError('E102', `looked in ${start} and its parents`);
    return search(parent);
  };
  return search(path.resolve(start));
}

/** `project` after `plan` is applied: features recorded, copied-file hashes updated. */
export function recordPlan(project: MfeflowProject, plan: Plan): MfeflowProject {
  const files = { ...project.files };
  for (const change of plan.changes) {
    const recorded = files[change.path];
    if (change.action === 'delete') delete files[change.path];
    else if (change.after !== null && change.track) files[change.path] = hashContent(change.after);
    else if (change.after !== null && recorded === hashContent(change.before ?? ''))
      files[change.path] = hashContent(change.after);
  }
  const features = { ...project.features };
  for (const f of plan.features) {
    features[f.name] = {
      version: f.version,
      ...(f.options ? { options: f.options } : {}),
      ...(f.integrity === undefined ? {} : { integrity: f.integrity }),
    };
  }
  const next: MfeflowProject = { ...project, features };
  if (Object.keys(files).length > 0) next.files = files;
  else delete next.files;
  return next;
}

export interface DivergedFile {
  path: string;
  state: 'modified' | 'missing';
}

/** Copied files whose content no longer matches the hash recorded when they were written. */
export async function findDiverged(
  root: string,
  project: MfeflowProject,
  ops: FsOps = realFs,
): Promise<DivergedFile[]> {
  const checked = await Promise.all(
    Object.entries(project.files ?? {}).map(
      async ([file, hash]): Promise<DivergedFile | undefined> => {
        const content = await readIfExists(ops, resolveInRoot(root, file));
        if (content === undefined) return { path: file, state: 'missing' };
        return hashContent(content) === hash ? undefined : { path: file, state: 'modified' };
      },
    ),
  );
  return checked.filter((entry) => entry !== undefined);
}
