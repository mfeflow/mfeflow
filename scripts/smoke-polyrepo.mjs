// Generates a polyrepo with this checkout (`mfeflow init --topology polyrepo --local`), then does
// what a team would: installs and builds each repo on its own (platform first, the others link to
// its dist), runs `mfeflow validate` and `mfeflow doctor` in every repo, boots the shell with
// `mfeflow dev` next to one remote's `pnpm dev`, adds a team repo while it runs and waits for the
// shell to list it, then sends Ctrl+C and checks every dev server is gone.
// Needs `pnpm build` to have run in this repo, and the network (it installs from npm).
// Usage: node scripts/smoke-polyrepo.mjs   (SMOKE_DIR=/some/folder keeps the repos there)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const work = process.env.SMOKE_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-polyrepo-'));
const org = path.join(work, 'acme');
const cli = path.join(repo, 'packages/cli/bin/mfeflow.js');
const SHELL = 'http://localhost:4300';
const SCOPE = '@acme';

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

async function waitFor(url, check, what) {
  const deadline = Date.now() + 120_000;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      const body = await res.text();
      if (res.ok && check(body)) return body;
      last = `HTTP ${String(res.status)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${what}: ${url} never became ready (${last})`);
}

async function portClosed(port) {
  try {
    await fetch(`http://localhost:${String(port)}/`);
    return false;
  } catch {
    return true;
  }
}

const children = [];

function stop(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}
/** Each in its own process group, so stopping it also stops the dev servers its package manager started. */
function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: true });
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  children.push({ child, exited });
  return { child, exited };
}

try {
  step(
    'generate',
    process.execPath,
    [
      cli,
      'init',
      'acme',
      '--topology',
      'polyrepo',
      '--scope',
      SCOPE,
      '--remotes',
      'catalog,cart',
      '--yes',
      '--no-install',
      '--local',
      repo,
      '--cwd',
      work,
    ],
    work,
  );

  for (const dir of ['platform', 'shell', 'catalog', 'cart']) {
    const root = path.join(org, dir);
    if (capture('git', ['rev-parse', '--show-toplevel'], root) !== fs.realpathSync(root))
      throw new Error(`${dir} is not a git repo of its own`);
  }
  console.log('ok  every repo has its own git repo');

  // The platform repo first: the others link to its dist.
  for (const dir of ['platform', 'shell', 'catalog', 'cart']) {
    const root = path.join(org, dir);
    step(`${dir}: install`, 'pnpm', ['install'], root);
    step(`${dir}: build`, 'pnpm', ['build'], root);
  }
  for (const [dir, app] of [
    ['shell', 'shell'],
    ['catalog', 'catalog'],
    ['cart', 'cart'],
  ]) {
    for (const pkg of ['contracts', 'tokens']) {
      const linked = path.join(org, dir, 'apps', app, 'node_modules', SCOPE, pkg, 'dist/index.js');
      if (!fs.existsSync(linked)) throw new Error(`${dir} does not see the built platform ${pkg}`);
    }
  }
  console.log('ok  shell, catalog and cart link the built platform packages');

  for (const dir of ['platform', 'shell', 'catalog', 'cart']) {
    const root = path.join(org, dir);
    step(`${dir}: mfeflow validate`, 'pnpm', ['mfeflow', 'validate'], root);
    step(`${dir}: mfeflow doctor`, 'pnpm', ['mfeflow', 'doctor'], root);
  }

  console.log('\n==> dev');
  const shellDev = start(process.execPath, [cli, 'dev'], path.join(org, 'shell'));
  start('pnpm', ['dev'], path.join(org, 'catalog'));
  const html = await waitFor(SHELL, (body) => body.includes('__MFE_REGISTRY__'), 'shell');
  for (const [name, port] of [
    ['catalog', 4311],
    ['cart', 4312],
  ]) {
    if (!html.includes(`http://localhost:${String(port)}/mf-manifest.json`))
      throw new Error(`the shell does not list ${name}`);
  }
  await waitFor('http://localhost:4311/mf-manifest.json', (b) => b.includes('metaData'), 'catalog');
  console.log('ok  the shell lists catalog and cart from its dev config, catalog is serving');

  step(
    'add team-repo while dev runs',
    process.execPath,
    [cli, 'add', 'team-repo', 'checkout', '--yes', '--no-install', '--local', repo],
    path.join(org, 'shell'),
  );
  await waitFor(
    SHELL,
    (body) => body.includes('http://localhost:4313/mf-manifest.json'),
    'shell with checkout (no restart of mfeflow dev)',
  );
  if (capture('git', ['rev-parse', '--show-toplevel'], path.join(org, 'checkout')) === '')
    throw new Error('checkout is not a git repo');
  console.log('ok  the shell lists checkout, mfeflow dev was not restarted');

  console.log('\n==> Ctrl+C');
  stop(shellDev.child, 'SIGINT');
  const { code } = await Promise.race([
    shellDev.exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('mfeflow dev did not stop')), 30_000),
    ),
  ]);
  if (code !== 130) throw new Error(`mfeflow dev exited with ${String(code)}, expected 130`);
  console.log('ok  Ctrl+C stopped mfeflow dev');
  console.log('\npolyrepo smoke passed');
} finally {
  for (const { child, exited } of children) {
    stop(child, 'SIGINT');
    // oxlint-disable-next-line no-await-in-loop -- stop them one at a time
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    stop(child, 'SIGKILL');
  }
  for (const port of [4300, 4311]) {
    // oxlint-disable-next-line no-await-in-loop -- a handful of ports
    if (!(await portClosed(port))) console.warn(`port ${String(port)} is still open`);
  }
  if (!process.env.SMOKE_DIR) {
    try {
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (error) {
      console.warn(`could not remove ${work}: ${error.message}`);
    }
  }
}
