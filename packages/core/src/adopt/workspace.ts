import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { messageOf } from '../errors';
import type { ReadFile } from '../plan';

/** Folders never searched for apps: dependencies, build output, caches, VCS. */
export const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'output',
  'coverage',
  'doc_build',
  'storybook-static',
]);

const MAX_DEPTH = 8;
/** Folders visited while expanding globs, across all patterns. */
const MAX_VISITED = 5000;

const skipped = (name: string): boolean =>
  name.startsWith('.') || SKIPPED_DIRS.has(name) || name.startsWith('dist-');

export interface WorkspaceProblem {
  file: string;
  reason: string;
}

function toRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\?]/g, String.raw`\$&`).replaceAll('*', '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/** A whole-path glob (`apps/**`, `packages/*-legacy`) as a regular expression. */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('/')
    .map((segment) => (segment === '**' ? '\0' : toRegExp(segment).source.slice(1, -1)))
    .join('/')
    .replaceAll('\0/', '(?:[^/]+/)*')
    .replaceAll('/\0', '(?:/[^/]+)*')
    .replaceAll('\0', '.*');
  return new RegExp(`^${body}$`);
}

/** `./apps/*\/` → `apps/*`; undefined for patterns that leave the folder. */
function normalize(pattern: string): string | undefined {
  const clean = pattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean === '' || clean.startsWith('/') || clean.split('/').includes('..')) return undefined;
  return clean;
}

/** Runs `fn` on each item one after the other, so a big folder tree never opens thousands of files at once. */
export function eachInSequence<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  return items.reduce((done, item) => done.then(() => fn(item)), Promise.resolve());
}

interface Walk {
  root: string;
  listDirs: (dir: string) => Promise<string[]>;
  problems: WorkspaceProblem[];
  visited: number;
  seen: Set<string>;
  found: Set<string>;
}

/** `a/**\/**\/b` means `a/**\/b`. */
const collapse = (segments: string[]): string[] =>
  segments.filter((segment, i) => !(segment === '**' && segments[i - 1] === '**'));

async function childrenOf(walk: Walk, at: string[]): Promise<string[]> {
  walk.visited += 1;
  if (walk.visited > MAX_VISITED) return [];
  try {
    return (await walk.listDirs(path.join(walk.root, ...at)))
      .filter((name) => !skipped(name))
      .toSorted((a, b) => a.localeCompare(b));
  } catch (error) {
    walk.problems.push({
      file: at.join('/') || '.',
      reason: `could not be listed (${messageOf(error)})`,
    });
    return [];
  }
}

async function expand(walk: Walk, segments: string[], at: string[] = []): Promise<void> {
  const state = `${at.join('/')}|${segments.join('/')}`;
  if (walk.seen.has(state)) return;
  walk.seen.add(state);
  if (segments.length === 0) {
    walk.found.add(at.join('/'));
    return;
  }
  if (at.length > MAX_DEPTH) return;
  const [segment = '', ...rest] = segments;
  if (!segment.includes('*')) {
    if (!skipped(segment)) await expand(walk, rest, [...at, segment]);
    return;
  }
  const children = await childrenOf(walk, at);
  if (segment === '**') {
    await expand(walk, rest, at);
    await eachInSequence(children, (child) => expand(walk, segments, [...at, child]));
    return;
  }
  const match = toRegExp(segment);
  await eachInSequence(
    children.filter((c) => match.test(c)),
    (child) => expand(walk, rest, [...at, child]),
  );
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;
}

async function safeRead(
  read: ReadFile,
  file: string,
  problems: WorkspaceProblem[],
): Promise<string | undefined> {
  try {
    return await read(file);
  } catch (error) {
    problems.push({
      file: path.basename(file),
      reason: `could not be read (${messageOf(error)})`,
    });
    return undefined;
  }
}

async function workspacePatterns(
  root: string,
  read: ReadFile,
  problems: WorkspaceProblem[],
): Promise<string[]> {
  const patterns: string[] = [];
  const yamlText = await safeRead(read, path.join(root, 'pnpm-workspace.yaml'), problems);
  if (yamlText !== undefined) {
    try {
      const doc: unknown = parseYaml(yamlText);
      const list =
        typeof doc === 'object' && doc !== null && 'packages' in doc
          ? stringList(doc.packages)
          : [];
      if (list) patterns.push(...list);
      else problems.push({ file: 'pnpm-workspace.yaml', reason: 'packages is not a list' });
    } catch {
      problems.push({ file: 'pnpm-workspace.yaml', reason: 'could not be parsed' });
    }
  }
  const pkgText = await safeRead(read, path.join(root, 'package.json'), problems);
  if (pkgText !== undefined) {
    try {
      const pkg: unknown = JSON.parse(pkgText);
      const workspaces =
        typeof pkg === 'object' && pkg !== null && 'workspaces' in pkg ? pkg.workspaces : undefined;
      const list =
        workspaces === undefined
          ? []
          : (stringList(workspaces) ??
            (typeof workspaces === 'object' && workspaces !== null && 'packages' in workspaces
              ? stringList(workspaces.packages)
              : undefined));
      if (list) patterns.push(...list);
      else problems.push({ file: 'package.json', reason: 'workspaces is not a list' });
    } catch {
      problems.push({ file: 'package.json', reason: 'could not be parsed' });
    }
  }
  return patterns;
}

/**
 * The folders that may hold an app, relative to `root` with `/` separators,
 * sorted: the root itself plus every workspace package with a package.json.
 */
export async function findAppDirs(
  root: string,
  read: ReadFile,
  listDirs: (dir: string) => Promise<string[]>,
  problems: WorkspaceProblem[] = [],
): Promise<string[]> {
  const patterns = await workspacePatterns(root, read, problems);
  const include = patterns.filter((p) => !p.startsWith('!')).map(normalize);
  const exclude = patterns
    .filter((p) => p.startsWith('!'))
    .map((p) => normalize(p.slice(1)))
    .filter((p): p is string => p !== undefined)
    .map(globToRegExp);
  const walk: Walk = { root, listDirs, problems, visited: 0, seen: new Set(), found: new Set() };
  await eachInSequence(include, async (pattern) => {
    if (pattern !== undefined) await expand(walk, collapse(pattern.split('/')));
  });
  if (walk.visited > MAX_VISITED) {
    problems.push({
      file: '.',
      reason: `has more than ${String(MAX_VISITED)} folders to search, so the workspace globs were cut short`,
    });
  }
  const candidates = [...walk.found].filter(
    (dir) => dir !== '' && !exclude.some((re) => re.test(dir)),
  );
  const withPackage: (string | undefined)[] = [];
  await eachInSequence(candidates, async (dir) => {
    const file = path.join(root, ...dir.split('/'), 'package.json');
    withPackage.push((await safeRead(read, file, problems)) === undefined ? undefined : dir);
  });
  const dirs = withPackage.filter((d): d is string => d !== undefined);
  return ['.', ...dirs.toSorted((a, b) => a.localeCompare(b))];
}
