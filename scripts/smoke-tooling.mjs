// Generates a tooling repo with this checkout (`mfeflow init --kind tooling --local`): four packages
// in the team's scope and the lint and git hook features. Then does what a team would: installs it
// (which installs the repo's own git hooks), builds, typechecks, lints and checks the format.
// Needs `pnpm build` to have run in this repo, and the network (it installs from npm).
// Usage: node scripts/smoke-tooling.mjs   (SMOKE_DIR=/some/folder keeps the repo there)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const work = process.env.SMOKE_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-tooling-'));
fs.mkdirSync(work, { recursive: true });
const root = path.join(work, 'tools');
const cli = path.join(repo, 'packages/cli/bin/mfeflow.js');
const PACKAGES = ['tsconfig', 'oxlint-config', 'analytics', 'http'];

/** The environment without the GIT_* variables a git hook sets, so git works on the folder it is run in. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

function step(title, command, args, cwd) {
  console.log(`\n==> ${title}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`${title} failed (exit ${String(result.status)})`);
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

try {
  step(
    'generate',
    process.execPath,
    [
      cli,
      'init',
      'tools',
      '--kind',
      'tooling',
      '--scope',
      '@acme',
      '--packages',
      PACKAGES.join(','),
      '--features',
      'lint-oxlint,git-hooks',
      '--yes',
      '--no-install',
      '--local',
      repo,
      '--cwd',
      work,
    ],
    work,
  );

  // Installing runs lefthook, which writes into the nearest .git: it must be the repo's own.
  if (capture('git', ['rev-parse', '--show-toplevel'], root) !== fs.realpathSync(root))
    throw new Error('the tooling repo is not a git repo of its own');
  console.log('ok  the tooling repo has its own git repo');

  for (const name of PACKAGES) {
    if (!fs.existsSync(path.join(root, 'packages', name, 'package.json')))
      throw new Error(`packages/${name} was not made`);
  }
  if (fs.existsSync(path.join(root, 'apps')) && fs.readdirSync(path.join(root, 'apps')).length > 0)
    throw new Error('a tooling repo should have no apps');
  console.log(`ok  packages made: ${PACKAGES.join(', ')}; no apps`);

  step('install', 'pnpm', ['install'], root);
  if (!fs.existsSync(path.join(root, '.git/hooks/commit-msg')))
    throw new Error('install did not write the commit-msg hook into the repo');
  console.log('ok  the git hooks are installed in the tooling repo');

  step('build', 'pnpm', ['build'], root);
  for (const name of ['analytics', 'http']) {
    if (!fs.existsSync(path.join(root, 'packages', name, 'dist/index.js')))
      throw new Error(`packages/${name} has no dist after build`);
  }
  console.log('ok  the wrapper packages built');

  step('typecheck', 'pnpm', ['typecheck'], root);
  step('lint', 'pnpm', ['lint'], root);
  step('format check', 'pnpm', ['format:check'], root);
  step('mfeflow validate', 'pnpm', ['mfeflow', 'validate'], root);
  console.log('\ntooling smoke passed');
} finally {
  if (!process.env.SMOKE_DIR) {
    try {
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (error) {
      console.warn(`could not remove ${work}: ${error.message}`);
    }
  }
}
