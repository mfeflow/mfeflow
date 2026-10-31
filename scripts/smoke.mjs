// Generates a project with this checkout (`mfeflow init --local`), installs and builds it, boots
// `mfeflow dev`, fetches the shell, its runtime config and both remotes, adds a third remote while it runs and waits for the
// shell to list it (no restart), then sends Ctrl+C and checks every dev server is gone.
// Needs `pnpm build` to have run in this repo.
// Usage: node scripts/smoke.mjs   (SMOKE_DIR=/some/folder keeps the project there)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const work = process.env.SMOKE_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-smoke-'));
const project = path.join(work, 'smoke-app');
const SHELL = 'http://localhost:4300';
const REMOTES = { catalog: 'http://localhost:4311', cart: 'http://localhost:4312' };

function step(title, command, args, cwd) {
  console.log(`\n==> ${title}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`${title} failed (exit ${String(result.status)})`);
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

const cli = path.join(repo, 'packages/cli/bin/mfeflow.js');

async function portClosed(port) {
  try {
    await fetch(`http://localhost:${String(port)}/`);
    return false;
  } catch {
    return true;
  }
}

async function checkRemote(html, name, origin) {
  if (!html.includes(`${origin}/mf-manifest.json`))
    throw new Error(`the shell does not list ${name}`);
  const manifest = JSON.parse(
    await waitFor(`${origin}/mf-manifest.json`, (body) => body.includes('metaData'), name),
  );
  const { name: file, path: dir } = manifest.metaData.remoteEntry;
  const entry = await waitFor(
    `${origin}/${path.posix.join(dir, file)}`,
    (b) => b.length > 0,
    `${name} entry`,
  );
  console.log(`ok  ${name}: ${manifest.metaData.name} entry ${String(entry.length)} bytes`);
}

let dev;
let devExit;
try {
  step(
    'generate',
    process.execPath,
    [
      path.join(repo, 'packages/cli/bin/mfeflow.js'),
      'init',
      'smoke-app',
      '--yes',
      '--no-install',
      '--local',
      repo,
      '--cwd',
      work,
    ],
    work,
  );
  step('install', 'pnpm', ['install'], project);
  step('build', 'pnpm', ['build'], project);

  console.log('\n==> dev');
  dev = spawn(process.execPath, [cli, 'dev'], { cwd: project, stdio: 'inherit' });
  devExit = new Promise((resolve) => dev.once('exit', (code, signal) => resolve({ code, signal })));

  const html = await waitFor(SHELL, (body) => body.includes('__MFE_REGISTRY__'), 'shell');
  for (const [name, origin] of Object.entries(REMOTES)) await checkRemote(html, name, origin);
  console.log('ok  shell: the registry lists catalog and cart');
  const runtimeConfig = JSON.parse(
    await waitFor(
      `${SHELL}/config/runtime-config.json`,
      (body) => body.includes('environment'),
      'runtime config',
    ),
  );
  if (runtimeConfig.environment !== 'dev')
    throw new Error(
      `the dev server served the ${runtimeConfig.environment} runtime config, not dev`,
    );
  console.log('ok  shell: /config/runtime-config.json is the dev file');

  step(
    'add remote while dev runs',
    process.execPath,
    [cli, 'add', 'remote', 'checkout', '--yes', '--local', repo],
    project,
  );
  const checkout = 'http://localhost:4313';
  const next = await waitFor(
    SHELL,
    (body) => body.includes(`${checkout}/mf-manifest.json`),
    'shell with checkout (no restart of mfeflow dev)',
  );
  await checkRemote(next, 'checkout', checkout);
  console.log('ok  shell: the registry now lists checkout, mfeflow dev was not restarted');

  console.log('\n==> Ctrl+C');
  dev.kill('SIGINT');
  const { code } = await Promise.race([
    devExit,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('mfeflow dev did not stop')), 30_000),
    ),
  ]);
  if (code !== 130) throw new Error(`mfeflow dev exited with ${String(code)}, expected 130`);
  dev = undefined;
  for (const port of [4300, 4311, 4312, 4313]) {
    if (!(await portClosed(port)))
      throw new Error(`port ${String(port)} is still open after Ctrl+C`);
  }
  console.log('ok  Ctrl+C stopped the shell and every remote');
  console.log('\nsmoke passed');
} finally {
  if (dev) {
    dev.kill('SIGINT');
    await Promise.race([devExit, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    dev.kill('SIGKILL');
  }
  if (!process.env.SMOKE_DIR) {
    try {
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (error) {
      console.warn(`could not remove ${work}: ${error.message}`);
    }
  }
}
