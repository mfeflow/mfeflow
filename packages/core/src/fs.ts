import fs from 'node:fs/promises';
import path from 'node:path';
import { hasErrno, MfeflowError, messageOf } from './errors.js';

/** The file system calls the engine makes, so tests can make one of them fail. */
export interface FsOps {
  readFile(file: string): Promise<string>;
  writeFile(file: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** The path with every symlink resolved. Rejects with ENOENT when it does not exist. */
  realpath(file: string): Promise<string>;
  rm(file: string, options?: { recursive?: boolean }): Promise<void>;
  /** Returns the first directory it had to create, if any. */
  mkdir(dir: string): Promise<string | undefined>;
  /** Whether `file` is itself a symlink. False when it does not exist. */
  isSymlink(file: string): Promise<boolean>;
  /** Names of the sub-folders of `dir`. */
  listDirs(dir: string): Promise<string[]>;
}

export const realFs: FsOps = {
  readFile: (file) => fs.readFile(file, 'utf8'),
  writeFile: (file, content) => fs.writeFile(file, content, 'utf8'),
  rename: (from, to) => fs.rename(from, to),
  realpath: (file) => fs.realpath(file),
  rm: (file, options) => fs.rm(file, { force: true, ...options }),
  mkdir: (dir) => fs.mkdir(dir, { recursive: true }),
  isSymlink: async (file) => {
    try {
      return (await fs.lstat(file)).isSymbolicLink();
    } catch (error) {
      if (hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR')) return false;
      throw new MfeflowError('E106', `${file}: ${messageOf(error)}`, { cause: error });
    }
  },
  listDirs: async (dir) =>
    (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
};

/** File content, or undefined when the file does not exist. */
export async function readIfExists(ops: FsOps, file: string): Promise<string | undefined> {
  try {
    return await ops.readFile(file);
  } catch (error) {
    if (hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR')) return undefined;
    throw new MfeflowError('E106', `${file}: ${messageOf(error)}`, { cause: error });
  }
}

let counter = 0;

/** A sibling path for staging writes; same directory so the rename never crosses file systems. */
export function tempSibling(file: string): string {
  counter += 1;
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.mfeflow-${String(process.pid)}-${String(counter)}.tmp`,
  );
}

/** Writes through a temp file and a rename, so readers never see half a file. */
export async function writeFileAtomic(ops: FsOps, file: string, content: string): Promise<void> {
  const temp = tempSibling(file);
  try {
    await ops.mkdir(path.dirname(file));
    await ops.writeFile(temp, content);
    await ops.rename(temp, file);
  } catch (error) {
    await ops.rm(temp).catch(() => undefined);
    throw new MfeflowError('E106', `${file}: ${messageOf(error)}`, { cause: error });
  }
}
