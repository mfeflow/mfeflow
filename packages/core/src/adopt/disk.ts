import fs from 'node:fs/promises';
import path from 'node:path';
import { hasErrno } from '../errors';
import type { ReadFile } from '../plan';

/** Largest file the detector will read. A config this big is not a config. */
export const MAX_FILE_BYTES = 1_000_000;

/** A path the detector refused to read, and why. `file` is relative to the scanned folder. */
export interface Refusal {
  file: string;
  reason: string;
}

/** Whether `target` is `root` or something under it. Compares whole segments, so `..x` is inside. */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

const inNodeModules = (root: string, target: string): boolean =>
  path.relative(root, target).split(path.sep).includes('node_modules');

const isMissing = (error: unknown): boolean =>
  hasErrno(error, 'ENOENT') || hasErrno(error, 'ENOTDIR');

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'unknown error';
}

/**
 * Reads from the disk without leaving `root`: every path is resolved through
 * symlinks first and must still be inside the (resolved) root and outside
 * node_modules. Anything refused or unreadable is recorded in `refused`
 * instead of throwing.
 */
export function guardedDisk(
  root: string,
  refused: Refusal[],
): { read: ReadFile; listDirs: (dir: string) => Promise<string[]> } {
  const shown = (file: string): string =>
    path.relative(root, file).split(path.sep).join('/') || '.';
  const refuse = (file: string, reason: string): void => {
    if (!refused.some((r) => r.file === shown(file) && r.reason === reason)) {
      refused.push({ file: shown(file), reason });
    }
  };
  let realRoot: Promise<string> | undefined;
  const rootReal = (): Promise<string> => (realRoot ??= fs.realpath(root));

  /** The real path of `file` when it may be read, or undefined (recorded when refused). */
  async function allowed(file: string): Promise<string | undefined> {
    if (inNodeModules(root, file)) {
      refuse(file, 'is inside node_modules, which is never read');
      return undefined;
    }
    try {
      const [realFile, base] = await Promise.all([fs.realpath(file), rootReal()]);
      if (!isInside(base, realFile)) {
        refuse(file, 'is (or goes through) a link that leads outside the project');
        return undefined;
      }
      if (inNodeModules(base, realFile)) {
        refuse(file, 'is (or goes through) a link into node_modules');
        return undefined;
      }
      return realFile;
    } catch (error) {
      if (!isMissing(error)) refuse(file, `could not be read (${codeOf(error)})`);
      return undefined;
    }
  }

  return {
    read: async (file) => {
      const real = await allowed(file);
      if (real === undefined) return undefined;
      try {
        const { size } = await fs.stat(real);
        if (size > MAX_FILE_BYTES) {
          refuse(
            file,
            `is larger than ${String(MAX_FILE_BYTES / 1_000_000)} MB, so it is not read`,
          );
          return undefined;
        }
        return await fs.readFile(real, 'utf8');
      } catch (error) {
        if (!isMissing(error)) refuse(file, `could not be read (${codeOf(error)})`);
        return undefined;
      }
    },
    listDirs: async (dir) => {
      const real = await allowed(dir);
      if (real === undefined) return [];
      try {
        return (await fs.readdir(real, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch (error) {
        if (!isMissing(error)) refuse(dir, `could not be read (${codeOf(error)})`);
        return [];
      }
    },
  };
}
