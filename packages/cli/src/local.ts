import fs from 'node:fs';
import path from 'node:path';
import { MfeflowError, type MfeflowProject } from '@mfeflow/core';

/** Range first-party features declare for `@mfeflow/*` packages; the CLI swaps in the real one. */
export const PLACEHOLDER_RANGE = 'latest';

const PREFIX = '@mfeflow/';
const CLI = 'mfeflow';

/** The packages mfeflow publishes: everything under `@mfeflow/`, and the CLI itself. */
const isOwn = (name: string) => name === CLI || name.startsWith(PREFIX);

function posix(file: string): string {
  return file.split(path.sep).join('/');
}

/** `file` with symlinks resolved; a path that does not exist yet resolves through its nearest existing parent. */
function realpathLoose(file: string): string {
  try {
    return fs.realpathSync.native(file);
  } catch {
    const parent = path.dirname(file);
    return parent === file ? file : path.join(realpathLoose(parent), path.basename(file));
  }
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

/** The `@mfeflow/*` packages of a checkout, and the `mfeflow` CLI, by name. */
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
    if (info && isOwn(info.name)) found.set(info.name, { dir, built: info.built });
  }
  return found;
}

/**
 * Turns the placeholder range of an `@mfeflow/*` (or `mfeflow`) dependency into the range the
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
    if (!isOwn(name) || range !== PLACEHOLDER_RANGE) return undefined;
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
 * stays, so a project is never half linked and half published. Both sides are compared by real
 * path, so a root and a checkout reached through different symlinks (`/var` -> `/private/var`)
 * still get the right relative path.
 */
export function chooseLocal(
  project: MfeflowProject,
  root: string,
  cwd: string,
  flag: string | undefined,
): { checkout: string | undefined; project: MfeflowProject } {
  const { local: recorded, ...rest } = project;
  const realRoot = realpathLoose(root);
  if (flag === LOCAL_NONE) return { checkout: undefined, project: rest };
  if (flag === undefined) {
    return {
      checkout: recorded === undefined ? undefined : path.resolve(realRoot, recorded),
      project,
    };
  }
  const checkout = realpathLoose(path.resolve(cwd, flag));
  const relative = path.relative(realRoot, checkout);
  if (relative === '') {
    throw new MfeflowError('E107', `--local ${flag} is the project itself`);
  }
  // On Windows a checkout on another drive has no relative path: record it absolute.
  const local = posix(path.isAbsolute(relative) ? checkout : relative);
  return { checkout, project: { ...rest, local } };
}
