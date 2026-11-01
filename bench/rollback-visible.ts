// Time from `mfeflow rollback` exiting to a fresh page load showing the old version, with the registry index
// served at `max-age=60`. The host is a local folder behind the storefront test server: this is the floor
// (no CDN, no network), not what a CDN will do.
//   pnpm build                          (the CLI and the storefront remotes must be built)
//   pnpm --filter @storefront/shell build
//   node bench/rollback-visible.ts      (RUNS default 5, PW_CHANNEL=chrome to use an installed Chrome)
// Writes bench/results/<date>-rollback.json. Without a runnable browser it falls back to HTTP fetches of the
// index and the catalog's remote entry, and the result says so in `method`.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import {
  cleanEnv,
  createRig,
  HEADING_V1,
  HEADING_V2,
  type Rig,
} from '../examples/storefront/e2e/rollback-support.ts';
import {
  indexServes,
  median,
  remoteEntryOf,
  rollbackResultName,
  summarizeRollback,
  type RollbackRun,
} from './stats.ts';

const repo = path.resolve(import.meta.dirname, '..');
const RUNS = Number(process.env.RUNS ?? '5');
const PORT = 4340;
const origin = `http://localhost:${String(PORT)}`;
const host = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-rollback-bench-'));

function git(...args: string[]): string {
  const out = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: cleanEnv() });
  return out.status === 0 ? out.stdout.trim() : 'unknown';
}

function startServer(): ChildProcess {
  return spawn(process.execPath, [path.join(repo, 'examples/storefront/e2e/serve.ts')], {
    cwd: path.join(repo, 'examples/storefront/e2e'),
    env: cleanEnv({
      SHELL_PORT: String(PORT),
      MONOLITH_PORT: String(PORT + 1),
      SERVE_REGISTRY_DIR: host,
      SERVE_INJECT: '0',
    }),
    stdio: 'ignore',
  });
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- polling
      await fetch(`${origin}/`, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error('the test server did not start');
      // oxlint-disable-next-line no-await-in-loop -- polling
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function launch(): Promise<Browser | undefined> {
  try {
    return await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  } catch (error) {
    console.warn(
      `no browser available, measuring over HTTP instead: ${String(error).split('\n')[0]}`,
    );
    return undefined;
  }
}

/** One fresh load (a new context, so no cache) and the heading it shows. */
async function freshHeading(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/catalog`);
    return (await page.getByTestId('catalog-heading').textContent({ timeout: 15_000 })) ?? '';
  } finally {
    await context.close();
  }
}

/** The HTTP stand-in for a fresh load: the index says the version, and that version's remote entry answers. */
async function httpServes(version: string): Promise<boolean> {
  const index: unknown = await (await fetch(`${origin}/registry/index.json`)).json();
  if (!indexServes(index, 'catalog', version)) return false;
  const entry = remoteEntryOf(index, 'catalog');
  return entry !== undefined && (await fetch(entry)).ok;
}

/** Whether a fresh load right now shows `version` of the catalog (1.0.0 or 2.0.0). */
async function shows(browser: Browser | undefined, version: '1.0.0' | '2.0.0'): Promise<boolean> {
  if (browser === undefined) return httpServes(version);
  return (await freshHeading(browser)) === (version === '1.0.0' ? HEADING_V1 : HEADING_V2);
}

function deployAll(rig: Rig): void {
  rig.resetHost();
  for (const done of [
    rig.deploy('cart', '1.0.0'),
    rig.deploy('catalog', '1.0.0', 'v1'),
    rig.deploy('catalog', '2.0.0', 'v2'),
  ]) {
    if (done.code !== 0) throw new Error(`deploy failed:\n${done.stdout}\n${done.stderr}`);
  }
}

async function oneRun(rig: Rig, browser: Browser | undefined): Promise<RollbackRun> {
  deployAll(rig);
  if (!(await shows(browser, '2.0.0'))) throw new Error('v2 is not live before the rollback');
  const started = performance.now();
  const back = rig.rollback('catalog');
  const exited = performance.now();
  if (back.code !== 0) throw new Error(`rollback failed:\n${back.stdout}\n${back.stderr}`);
  let attempts = 0;
  for (;;) {
    attempts += 1;
    // oxlint-disable-next-line no-await-in-loop -- each attempt is a new fresh load, one after another
    const seen = await shows(browser, '1.0.0');
    if (seen)
      return { commandMs: exited - started, visibleMs: performance.now() - exited, attempts };
    if (performance.now() - exited > 120_000) throw new Error('v1 never became visible');
  }
}

const server = startServer();
const rig = createRig(`${origin}/reg`, host);
let browser: Browser | undefined;
try {
  await waitForServer();
  browser = await launch();
  console.log('warm-up run (not timed)');
  await oneRun(rig, browser);
  const runs: RollbackRun[] = [];
  for (let i = 1; i <= RUNS; i++) {
    // oxlint-disable-next-line no-await-in-loop -- runs are sequential on purpose: they share one server and a CPU
    const run = await oneRun(rig, browser);
    runs.push(run);
    console.log(`run ${String(i)}/${String(RUNS)}: ${JSON.stringify(run)}`);
  }
  const summary = summarizeRollback(runs);
  const report = {
    measured: new Date().toISOString(),
    what: 'time from `mfeflow rollback` exiting to a fresh page load (new browser context, no cache) showing the old version',
    host: 'local file host',
    method:
      browser === undefined
        ? 'http: fetch of /registry/index.json and the catalog remote entry (no browser was available)'
        : `browser: ${browser.browserType().name()} ${browser.version()}, new context per load`,
    indexCacheControl: 'public, max-age=60',
    notMeasured:
      'CDN edge caches, real S3 or R2 latency, and a returning visitor holding the index in their HTTP cache (that wait is up to the 60 s max-age)',
    commit: git('rev-parse', 'HEAD'),
    machine: {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpus: os.cpus().length,
      node: process.version,
    },
    runs,
    medianMs: summary,
    medianVisibleOfRuns: Math.round(median(runs.map((r) => r.visibleMs))),
    staticExitCriterion:
      'Phase 05 exit criterion: rollback visible in under 90 s (60 s index cache). Context only: the value above is a local file host and is not compared against it.',
  };
  const out = path.join(import.meta.dirname, 'results', `${rollbackResultName(new Date())}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\nmedian: rollback command ${String(summary.commandMs)} ms, then ${String(summary.visibleMs)} ms until a fresh load shows the old version (local file host, ${report.method.split(':')[0] ?? ''})`,
  );
  console.log(`wrote ${out}`);
} finally {
  await browser?.close();
  server.kill();
  rig.cleanup();
  fs.rmSync(host, { recursive: true, force: true });
}
