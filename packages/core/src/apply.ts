import path from 'node:path';
import { hasErrno, MfeflowError, messageOf } from './errors.js';
import { readIfExists, realFs, tempSibling, type FsOps } from './fs.js';
import { hashContent } from './hash.js';
import { resolveInRoot } from './paths.js';
import { inOrder } from './sequence.js';
import { PROJECT_FILE, recordPlan, serializeProject, type MfeflowProject } from './project.js';
import type { FileChange, Plan } from './plan.js';

export interface InstallContext {
  root: string;
  plan: Plan;
}

/** Runs the package manager. Injected so tests and `--no-install` never touch the network. */
export type InstallStep = (context: InstallContext) => Promise<void>;

export interface ApplyOptions {
  root: string;
  /** The project as it is now. When given, `mfeflow.json` is updated in the same transaction. */
  project?: MfeflowProject;
  install?: InstallStep;
  fs?: FsOps;
  /** Check the plan against the files and stop before writing anything. */
  dryRun?: boolean;
}

export interface ApplyResult {
  written: string[];
  project: MfeflowProject | undefined;
}

interface Journal {
  file: string;
  original: string | null;
}

/**
 * Writes a plan to disk, all or nothing. Every target is checked against what
 * the plan was made from, new content is staged next to its target and
 * renamed into place, and on any failure (including the install step) the
 * originals are put back.
 */
export async function applyPlan(plan: Plan, options: ApplyOptions): Promise<ApplyResult> {
  const ops = options.fs ?? realFs;
  const { changes, project } = withProjectFile(plan, options);
  const targets = changes.map((change) => ({
    change,
    file: resolveInRoot(options.root, change.path),
  }));

  const realRoot = await ops.realpath(options.root);
  await inOrder(targets, ({ change, file }) => assertContained(ops, realRoot, file, change.path));

  const current = await verifyUnchanged(targets, ops);
  if (options.dryRun) return { written: [], project };

  const journal: Journal[] = [];
  const staged = new Map<string, string>();
  const createdDirs: string[] = [];
  let failure: { code: 'E212' | 'E213'; cause: unknown } | undefined;
  try {
    await inOrder(targets, async ({ change, file }) => {
      if (change.after === null) return;
      const dir = await ops.mkdir(path.dirname(file));
      if (dir) createdDirs.push(dir);
      await assertContained(ops, realRoot, path.dirname(file), change.path);
      const temp = tempSibling(file);
      staged.set(file, temp);
      await ops.writeFile(temp, change.after);
    });
    await inOrder(targets, async ({ file }) => {
      const temp = staged.get(file);
      if (temp === undefined) await ops.rm(file);
      else await ops.rename(temp, file);
      journal.push({ file, original: current.get(file) ?? null });
    });
  } catch (cause) {
    failure = { code: 'E212', cause };
  }
  if (!failure && options.install) {
    try {
      await options.install({ root: options.root, plan });
    } catch (cause) {
      failure = { code: 'E213', cause };
    }
  }
  if (failure) {
    const stuck = await rollback(ops, journal, [...staged.values()], createdDirs);
    const restore = stuck.length > 0 ? `; could not restore ${stuck.join(', ')}` : '';
    throw new MfeflowError(failure.code, `${messageOf(failure.cause)}${restore}`, {
      cause: failure.cause,
    });
  }
  return { written: changes.map((c) => c.path), project };
}

function withProjectFile(plan: Plan, options: ApplyOptions) {
  if (!options.project) return { changes: plan.changes, project: undefined };
  const next = recordPlan(options.project, plan);
  if (plan.projectBefore === undefined) {
    throw new MfeflowError('E211', `${PROJECT_FILE} (the plan did not record it; plan again)`);
  }
  const before = plan.projectBefore;
  const after = serializeProject(next);
  if (before === after) return { changes: plan.changes, project: next };
  const change: FileChange = {
    path: PROJECT_FILE,
    action: before === null ? 'create' : 'patch',
    before,
    after,
    track: false,
  };
  return { changes: [...plan.changes, change], project: next };
}

async function verifyUnchanged(
  targets: { change: FileChange; file: string }[],
  ops: FsOps,
): Promise<Map<string, string>> {
  const reads = await Promise.all(
    targets.map(async ({ change, file }) => ({ change, file, now: await readIfExists(ops, file) })),
  );
  const current = new Map<string, string>();
  const stale: string[] = [];
  for (const { change, file, now } of reads) {
    if (now !== undefined) current.set(file, now);
    const expected = change.before;
    const matches =
      expected === null
        ? now === undefined
        : now !== undefined && hashContent(now) === hashContent(expected);
    if (!matches) stale.push(change.path);
  }
  if (stale.length > 0) throw new MfeflowError('E211', stale.join(', '));
  return current;
}

async function rollback(
  ops: FsOps,
  journal: Journal[],
  staged: string[],
  createdDirs: string[],
): Promise<string[]> {
  const stuck: string[] = [];
  await inOrder(journal.toReversed(), async (entry) => {
    try {
      if (entry.original === null) await ops.rm(entry.file);
      else await restoreFile(ops, entry.file, entry.original);
    } catch {
      stuck.push(entry.file);
    }
  });
  await inOrder(staged, (temp) => ops.rm(temp).catch(() => undefined));
  await inOrder(createdDirs, (dir) => ops.rm(dir, { recursive: true }).catch(() => undefined));
  return stuck;
}

/** Puts `content` back by staging it beside `file` and renaming over it, so a link planted there is replaced, not written through. */
async function restoreFile(ops: FsOps, file: string, content: string): Promise<void> {
  const temp = tempSibling(file);
  try {
    await ops.writeFile(temp, content);
    await ops.rename(temp, file);
  } catch (error) {
    await ops.rm(temp).catch(() => undefined);
    throw error;
  }
}

/**
 * Requires the deepest part of `target` that exists to resolve, symlinks
 * included, to somewhere inside the project. A symlink in a cloned repo
 * could otherwise send a write (or a `mkdir -p`) outside it.
 */
async function assertContained(
  ops: FsOps,
  realRoot: string,
  target: string,
  shown: string,
): Promise<void> {
  const real = await deepestRealpath(ops, target);
  const inside = path.relative(realRoot, real);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new MfeflowError('E105', `"${shown}" resolves through a symlink to ${real}`);
  }
}

async function deepestRealpath(ops: FsOps, target: string): Promise<string> {
  try {
    return await ops.realpath(target);
  } catch (error) {
    const parent = path.dirname(target);
    if ((hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR')) && parent !== target) {
      return deepestRealpath(ops, parent);
    }
    throw new MfeflowError('E106', `${target}: ${messageOf(error)}`, { cause: error });
  }
}
