import path from 'node:path';
import { hasErrno, MfeflowError, messageOf } from './errors';
import { readIfExists, realFs, symlinkedPrefix, tempSibling, type FsOps } from './fs';
import { assertWritable } from './features/write-policy';
import { hashContent } from './hash';
import { resolveInRoot } from './paths';
import { inOrder } from './sequence';
import { PROJECT_FILE, recordPlan, serializeProject, type MfeflowProject } from './project';
import type { FileChange, Plan } from './plan';

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
  /** Refuse any write through a symlink, first-party included. Third-party changes always are. */
  refuseSymlinks?: boolean;
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
  await inOrder(targets, async ({ change, file }) => {
    await assertContained(ops, realRoot, file, change.path);
    await assertTrustedRoute(ops, options.root, change, options.refuseSymlinks === true);
  });

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
      await assertTrustedRoute(ops, options.root, change, options.refuseSymlinks === true);
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
  let snapshot: Snapshot | undefined;
  if (!failure && options.install) {
    snapshot = await snapshotInstallFiles(ops, options.root, changes);
    try {
      await options.install({ root: options.root, plan });
    } catch (cause) {
      failure = { code: 'E213', cause };
    }
  }
  if (failure) {
    const fromInstall = snapshot ? await restoreSnapshot(ops, options.root, snapshot) : undefined;
    const stuck = await rollback(ops, journal, [...staged.values()], createdDirs);
    const written = journal.length;
    const notes: string[] = [];
    if (failure.code === 'E213') {
      notes.push(`restored the ${String(written)} files the plan wrote`);
      const changed = fromInstall?.restored ?? [];
      notes.push(
        changed.length > 0
          ? `restored what the install changed: ${changed.join(', ')}`
          : 'the install changed no tracked file',
      );
      notes.push(
        `node_modules was not rolled back; run ${options.project?.packageManager ?? 'your package manager'} install to match the restored files`,
      );
    }
    const unrestored = [...stuck, ...(fromInstall?.stuck ?? [])];
    if (unrestored.length > 0) notes.push(`could not restore ${unrestored.join(', ')}`);
    const detail = [messageOf(failure.cause), ...notes].join('; ');
    throw new MfeflowError(failure.code, detail, { cause: failure.cause });
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
    trust: 'first-party',
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

/**
 * A third-party change may only land where its path says it does. Every
 * existing part of the path, from the project root down, must be a real
 * folder or file: a symlink already in the repo (`src/hooks -> ../.husky`)
 * would otherwise carry a path the allowlist accepted into one it forbids.
 * With no link on the way, the resolved path is the written one, so the
 * path rules checked when the plan was made still describe the real target.
 * First-party changes are only held to {@link assertContained}.
 */
async function assertTrustedRoute(
  ops: FsOps,
  root: string,
  change: FileChange,
  refuseAll: boolean,
): Promise<void> {
  const thirdParty = change.trust === 'third-party';
  if (!thirdParty && !refuseAll) return;
  if (thirdParty) assertWritable(change.path);
  const hit = await symlinkedPrefix(ops, root, change.path);
  if (hit && !thirdParty) {
    throw new MfeflowError(
      'E105',
      `"${change.path}" goes through a symlink at "${hit}", which is never written through`,
    );
  }
  if (hit) {
    throw new MfeflowError(
      'E203',
      `"${change.path}" goes through a symlink at "${hit}", which third-party features may not write through`,
    );
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

/** Lockfiles the package managers write. Binary ones (bun.lockb) are not text and are left alone. */
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock'];

/** Project-relative path to content (null: the file did not exist). */
type Snapshot = Map<string, string | null>;

/**
 * What an install may rewrite: the root package.json, workspace file and
 * lockfiles, plus every package.json the plan wrote and the lockfiles beside it
 * (for projects whose apps are installed on their own).
 */
async function snapshotInstallFiles(
  ops: FsOps,
  root: string,
  changes: FileChange[],
): Promise<Snapshot> {
  const files = new Set(['package.json', 'pnpm-workspace.yaml', ...LOCKFILES]);
  for (const { path: changed } of changes) {
    if (path.posix.basename(changed) !== 'package.json') continue;
    files.add(changed);
    for (const lock of LOCKFILES) files.add(path.posix.join(path.posix.dirname(changed), lock));
  }
  const snapshot: Snapshot = new Map();
  await inOrder([...files], async (file) => {
    snapshot.set(file, (await readIfExists(ops, resolveInRoot(root, file))) ?? null);
  });
  return snapshot;
}

/** Puts back every snapshotted file the install changed, and reports which. */
async function restoreSnapshot(
  ops: FsOps,
  root: string,
  snapshot: Snapshot,
): Promise<{ restored: string[]; stuck: string[] }> {
  const restored: string[] = [];
  const stuck: string[] = [];
  await inOrder(
    [...snapshot].toSorted(([a], [b]) => (a < b ? -1 : 1)),
    async ([file, content]) => {
      const absolute = resolveInRoot(root, file);
      try {
        const now = (await readIfExists(ops, absolute)) ?? null;
        if (now === content) return;
        if (content === null) await ops.rm(absolute);
        else await restoreFile(ops, absolute, content);
        restored.push(file);
      } catch {
        stuck.push(file);
      }
    },
  );
  return { restored, stuck };
}
