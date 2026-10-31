// Generates a project with this checkout (`mfeflow init --local`), installs and builds it, boots
// `pnpm dev` and fetches the shell and both remotes. Needs `pnpm build` to have run in this repo.
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

const alive = (pid) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};

// turbo forks one dev server per app; the process group takes them all down.
async function stop(child) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      return;
    }
    const deadline = Date.now() + 5000;
    while (alive(child.pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!alive(child.pid)) return;
  }
}

let dev;
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
  dev = spawn('pnpm', ['dev'], { cwd: project, stdio: 'inherit', detached: true });

  const html = await waitFor(SHELL, (body) => body.includes('__MFE_REGISTRY__'), 'shell');
  for (const [name, origin] of Object.entries(REMOTES)) {
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
  console.log('ok  shell: the registry lists catalog and cart');
  console.log('\nsmoke passed');
} finally {
  if (dev) await stop(dev);
  if (!process.env.SMOKE_DIR) {
    try {
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (error) {
      console.warn(`could not remove ${work}: ${error.message}`);
    }
  }
}
