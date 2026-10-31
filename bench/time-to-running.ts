// Time from `create-mfeflow my-app --yes --local` to a shell and its remotes answering on `pnpm dev`:
// create + `pnpm install` (warm store) + first `pnpm dev`, median of RUNS (5) after one untimed warm-up run.
//   pnpm build                       (once; --local links this checkout)
//   node bench/time-to-running.ts    (BENCH_DIR for where projects go, RUNS, BENCH_FIXTURE)
// Writes bench/results/<date>.json. The fixture is bench/fixture.json: shell + catalog + cart, lint-oxlint, url-factory.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { median, resultName, summarize, type Run } from './stats.ts';

const repo = path.resolve(import.meta.dirname, '..');
const RUNS = Number(process.env.RUNS ?? '5');
const TARGET_MS = 60_000;
const fixture = path.resolve(
  process.env.BENCH_FIXTURE ?? path.join(import.meta.dirname, 'fixture.json'),
);
const win = process.platform === 'win32';

function git(...args: string[]): string {
  const out = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : 'unknown';
}

function mustRun(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: win && command === 'pnpm',
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (exit ${String(result.status)})`);
}

function timed(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function ready(
  url: string,
  check: (body: string) => boolean,
  deadline: number,
): Promise<string> {
  const attempt = async (): Promise<string | undefined> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      const body = await res.text();
      return res.ok && check(body) ? body : undefined;
    } catch {
      return undefined;
    }
  };
  // oxlint-disable-next-line no-await-in-loop -- polling
  for (let body = await attempt(); ; body = await attempt()) {
    if (body !== undefined) return body;
    if (Date.now() >= deadline) throw new Error(`${url} did not answer in time`);
    // oxlint-disable-next-line no-await-in-loop -- polling
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function remotePorts(project: string): number[] {
  const doc: unknown = JSON.parse(fs.readFileSync(path.join(project, 'mfeflow.json'), 'utf8'));
  const apps = isObject(doc) && isObject(doc.apps) ? Object.values(doc.apps) : [];
  return apps.flatMap((app) =>
    isObject(app) && app.kind === 'remote' && typeof app.port === 'number' ? [app.port] : [],
  );
}

/** Where a remote's entry script lives, from its manifest. */
function entryPath(manifest: string): string {
  const doc: unknown = JSON.parse(manifest);
  const meta = isObject(doc) ? doc.metaData : undefined;
  const entry = isObject(meta) ? meta.remoteEntry : undefined;
  if (!isObject(entry) || typeof entry.name !== 'string')
    throw new Error('mf-manifest.json has no remoteEntry');
  return path.posix.join(typeof entry.path === 'string' ? entry.path : '', entry.name);
}

function stopTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (win) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('close', () => {
        resolve();
      });
      return;
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      resolve();
      return;
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // already gone
      }
      resolve();
    }, 3000);
  });
}

/** Starts `pnpm dev` and returns how long until the shell and every remote entry answered. */
async function firstDev(project: string): Promise<number> {
  const remotes = remotePorts(project);
  const start = performance.now();
  const dev = spawn('pnpm', ['dev'], { cwd: project, stdio: 'ignore', detached: !win, shell: win });
  const deadline = Date.now() + 180_000;
  try {
    await ready('http://localhost:4300/', (b) => b.includes('__MFE_REGISTRY__'), deadline);
    for (const port of remotes) {
      const origin = `http://localhost:${String(port)}`;
      // oxlint-disable-next-line no-await-in-loop -- the shell is up first, then each remote in turn
      const manifest = await ready(
        `${origin}/mf-manifest.json`,
        (b) => b.includes('metaData'),
        deadline,
      );
      // oxlint-disable-next-line no-await-in-loop -- as above
      await ready(`${origin}/${entryPath(manifest)}`, (b) => b.length > 0, deadline);
    }
    return performance.now() - start;
  } finally {
    if (dev.pid !== undefined) await stopTree(dev.pid);
  }
}

async function once(base: string, withDev: boolean): Promise<Run | undefined> {
  const work = fs.mkdtempSync(path.join(base, 'mfeflow-bench-'));
  try {
    fs.copyFileSync(fixture, path.join(work, 'preset.json'));
    const createMs = timed(() => {
      mustRun(
        process.execPath,
        [
          path.join(repo, 'packages/create-mfeflow/bin/create-mfeflow.js'),
          'my-app',
          '--yes',
          '--no-install',
          '--local',
          repo,
          '--preset',
          'preset.json',
          '--cwd',
          work,
        ],
        work,
      );
    });
    const project = path.join(work, 'my-app');
    const installMs = timed(() => {
      mustRun('pnpm', ['install'], project);
    });
    if (!withDev) return undefined;
    const devMs = await firstDev(project);
    return { createMs, installMs, devMs, totalMs: createMs + installMs + devMs };
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

const base = process.env.BENCH_DIR ?? os.tmpdir();
fs.mkdirSync(base, { recursive: true });
console.log('warm-up run (not timed): fills the pnpm store');
await once(base, false);
const runs: Run[] = [];
for (let i = 1; i <= RUNS; i++) {
  // oxlint-disable-next-line no-await-in-loop -- runs are sequential on purpose: they share ports and a CPU
  const run = await once(base, true);
  if (run) runs.push(run);
  console.log(`run ${String(i)}/${String(RUNS)}: ${JSON.stringify(run)}`);
}
const medianRun = summarize(runs);
const report = {
  measured: new Date().toISOString(),
  what: 'create-mfeflow my-app --yes --local, pnpm install (warm store), first pnpm dev until the shell and every remote entry answer',
  fixture: JSON.parse(fs.readFileSync(fixture, 'utf8')) as unknown,
  commit: git('rev-parse', '--short', 'HEAD'),
  machine: {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
    node: process.version,
  },
  pnpm: spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: win }).stdout.trim(),
  runs,
  medianMs: medianRun,
  medianTotalOfRuns: Math.round(median(runs.map((r) => r.totalMs))),
  targetMs: TARGET_MS,
  pass: medianRun.totalMs < TARGET_MS,
};
const out = path.join(import.meta.dirname, 'results', `${resultName(new Date())}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `\nmedian: create ${String(medianRun.createMs)} ms + install ${String(medianRun.installMs)} ms + dev ${String(medianRun.devMs)} ms = ${String(medianRun.totalMs)} ms (target < ${String(TARGET_MS)} ms)`,
);
console.log(`wrote ${out}`);
if (!report.pass) process.exitCode = 1;
