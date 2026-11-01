// Fails when a feature or template changed but its manifest `version` did not.
// Compares HEAD with the merge-base of HEAD and a base ref: every file under features/<name>/ or
// templates/<name>/ that differs means that folder's feature.json needs a new version, so `upgrade`
// can tell which features moved. A folder that is new or deleted needs no bump.
// Usage: node scripts/check-feature-versions.mjs <base-ref> [repo-dir]   (CI passes origin/<PR base>)
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOTS = new Set(['features', 'templates']);

/** The environment without the GIT_* variables a hook sets, which would point git at the wrong repo. */
export function cleanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv() });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.error}`);
  }
  return result.stdout;
}

function versionAt(cwd, ref, folder) {
  const shown = spawnSync('git', ['show', `${ref}:${folder}/feature.json`], {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(),
  });
  if (shown.status !== 0) return undefined;
  try {
    return JSON.parse(shown.stdout).version;
  } catch {
    return undefined;
  }
}

/** The `features/<name>` and `templates/<name>` folders that have a changed file between two refs. */
export function changedFolders(cwd, from, to) {
  const names = git(cwd, ['diff', '--name-only', '--no-renames', `${from}`, to]).split('\n');
  const folders = new Set();
  for (const file of names) {
    const [root, name, ...rest] = file.split('/');
    if (ROOTS.has(root) && name && rest.length > 0) folders.add(`${root}/${name}`);
  }
  return [...folders].toSorted((a, b) => a.localeCompare(b));
}

/** One message per folder that changed without a version change. */
export function unbumped(cwd, base) {
  const from = git(cwd, ['merge-base', base, 'HEAD']).trim();
  const problems = [];
  for (const folder of changedFolders(cwd, from, 'HEAD')) {
    const before = versionAt(cwd, from, folder);
    const after = versionAt(cwd, 'HEAD', folder);
    if (before === undefined || after === undefined) continue;
    if (before === after) {
      problems.push(`${folder} changed but ${folder}/feature.json is still at version ${after}`);
    }
  }
  return problems;
}

export function main(argv = process.argv.slice(2)) {
  const [base, dir = '.'] = argv;
  if (!base) {
    console.error('usage: node scripts/check-feature-versions.mjs <base-ref> [repo-dir]');
    return 2;
  }
  const problems = unbumped(path.resolve(dir), base);
  for (const problem of problems) console.error(`error: ${problem}`);
  if (problems.length > 0) {
    console.error('Bump "version" in the feature.json of each folder listed above.');
    return 1;
  }
  console.log(`Feature and template versions are in step with ${base}.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
