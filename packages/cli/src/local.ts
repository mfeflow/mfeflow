import fs from 'node:fs';
import path from 'node:path';
import { MfeflowError, type MfeflowProject } from '@mfeflow/core';

/** Range first-party features declare for `@mfeflow/*` packages; the CLI swaps in the real one. */
export const PLACEHOLDER_RANGE = 'latest';

const PREFIX = '@mfeflow/';

function posix(file: string): string {
  return file.split(path.sep).join('/');
}

interface LocalPackage {
  dir: string;
  built: boolean;
}

function readName(dir: string): { name: string; built: boolean } | undefined {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return undefined;
  const pkg: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof pkg !== 'object' || pkg === null || !('name' in pkg) || typeof pkg.name !== 'string') {
    return undefined;
  }
  const needsBuild = JSON.stringify('exports' in pkg ? pkg.exports : '').includes('./dist/');
  return { name: pkg.name, built: !needsBuild || fs.existsSync(path.join(dir, 'dist')) };
}

/** The `@mfeflow/*` packages of a checkout, by name. */
export function scanCheckout(checkout: string): Map<string, LocalPackage> {
  const packages = path.join(checkout, 'packages');
  if (!fs.existsSync(packages)) {
    throw new MfeflowError('E110', `${checkout} has no packages/ folder`);
  }
  const found = new Map<string, LocalPackage>();
  for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packages, entry.name);
    const info = readName(dir);
    if (info?.name.startsWith(PREFIX)) found.set(info.name, { dir, built: info.built });
  }
  return found;
}

/**
 * Turns the placeholder range of an `@mfeflow/*` dependency into the range the
 * project should install: `link:<checkout>/packages/<name>` with `--local`, else `^<version>`.
 */
export function createRangeRewriter(
  version: string,
  local?: string,
): (name: string, range: string) => string | undefined {
  const packages = local === undefined ? undefined : scanCheckout(path.resolve(local));
  if (packages) {
    const unbuilt = [...packages].filter(([, p]) => !p.built).map(([name]) => name);
    if (unbuilt.length > 0) {
      throw new MfeflowError(
        'E110',
        `${unbuilt.join(', ')} ${unbuilt.length > 1 ? 'have' : 'has'} no dist/ yet`,
      );
    }
  }
  return (name, range) => {
    if (!name.startsWith(PREFIX) || range !== PLACEHOLDER_RANGE) return undefined;
    if (!packages) return `^${version}`;
    const found = packages.get(name);
    if (!found) throw new MfeflowError('E110', `${name} is not in ${local ?? ''}/packages`);
    return `link:${posix(found.dir)}`;
  };
}

/** `--local none`: stop linking and go back to the published packages. */
export const LOCAL_NONE = 'none';

/**
 * The checkout a command links `@mfeflow/*` from, and the project recording it. An explicit
 * `flag` (a path, or `none`) changes the project's mode; without one the project's own mode
 * stays, so a project is never half linked and half published.
 */
export function chooseLocal(
  project: MfeflowProject,
  root: string,
  cwd: string,
  flag: string | undefined,
): { checkout: string | undefined; project: MfeflowProject } {
  const { local: recorded, ...rest } = project;
  if (flag === LOCAL_NONE) return { checkout: undefined, project: rest };
  if (flag === undefined) {
    return {
      checkout: recorded === undefined ? undefined : path.resolve(root, ...recorded.split('/')),
      project,
    };
  }
  const checkout = path.resolve(cwd, flag);
  const relative = path.relative(root, checkout);
  if (relative === '' || path.isAbsolute(relative)) {
    throw new MfeflowError('E107', `--local ${flag} cannot be recorded relative to ${root}`);
  }
  return { checkout, project: { ...rest, local: posix(relative) } };
}
