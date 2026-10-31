import path from 'node:path';
import { isSafeRelativePath } from '@mfeflow/contracts';
import { MfeflowError } from './errors.js';

/** Absolute path of a project-relative POSIX path, refusing anything that could leave `root`. */
export function resolveInRoot(root: string, relative: string): string {
  if (!isSafeRelativePath(relative)) {
    throw new MfeflowError('E105', `"${relative}"`);
  }
  const absolute = path.resolve(root, ...relative.split('/'));
  const inside = path.relative(root, absolute);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new MfeflowError('E105', `"${relative}"`);
  }
  return absolute;
}

/** Joins project-relative POSIX segments, skipping empty ones. */
export function joinPosix(...parts: string[]): string {
  return path.posix.join(...parts.filter((p) => p !== ''));
}
