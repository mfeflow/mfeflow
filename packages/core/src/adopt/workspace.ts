import path from 'node:path';
import { parse as parseYaml } from 'yaml';
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

async function expand(
  root: string,
  segments: string[],
  listDirs: (dir: string) => Promise<string[]>,
  at: string[] = [],
): Promise<string[]> {
  if (segments.length === 0) return [at.join('/')];
  if (at.length > MAX_DEPTH) return [];
  const [segment = '', ...rest] = segments;
  if (!segment.includes('*')) {
    return skipped(segment) ? [] : expand(root, rest, listDirs, [...at, segment]);
  }
  const children = (await listDirs(path.join(root, ...at)))
    .filter((name) => !skipped(name))
    .toSorted((a, b) => a.localeCompare(b));
  if (segment === '**') {
    const nested = await Promise.all(
      children.map((child) => expand(root, segments, listDirs, [...at, child])),
    );
    return [...(await expand(root, rest, listDirs, at)), ...nested.flat()];
  }
  const match = toRegExp(segment);
  const nested = await Promise.all(
    children
      .filter((child) => match.test(child))
      .map((child) => expand(root, rest, listDirs, [...at, child])),
  );
  return nested.flat();
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;
}

async function workspacePatterns(
  root: string,
  read: ReadFile,
  problems: WorkspaceProblem[],
): Promise<string[]> {
  const patterns: string[] = [];
  const yamlText = await read(path.join(root, 'pnpm-workspace.yaml'));
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
  const pkgText = await read(path.join(root, 'package.json'));
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
  const found = await Promise.all(
    include
      .filter((p): p is string => p !== undefined)
      .map((p) => expand(root, p.split('/'), listDirs)),
  );
  const candidates = [...new Set(found.flat())].filter(
    (dir) => dir !== '' && !exclude.some((re) => re.test(dir)),
  );
  const withPackage = await Promise.all(
    candidates.map(async (dir) =>
      (await read(path.join(root, ...dir.split('/'), 'package.json'))) === undefined
        ? undefined
        : dir,
    ),
  );
  const dirs = withPackage.filter((d): d is string => d !== undefined);
  return ['.', ...dirs.toSorted((a, b) => a.localeCompare(b))];
}
