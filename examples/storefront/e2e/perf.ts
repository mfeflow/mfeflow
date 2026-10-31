// Phase 02 performance criterion on the real packages: LCP and transferred JS of
// the storefront shell vs the same pages built as one app (the monolith), on the
// shell's main remote route, judged by the cost model (@mfeflow/contracts): LCP at most
// +300 ms, the shell adds at most 32 KB, each remote on the route at most 10 KB. Both apps are served by the same server code (gzip,
// immutable caching), the shell's remotes under its own origin at /mfe/<name>/.
// Lighthouse mobile preset with simulated throttling, median of RUNS.
//   pnpm --filter @storefront/e2e perf          (after pnpm build)
// Environment: RUNS (10), PAGE (/catalog), OUT (perf-results.json), LABEL,
// SERVE_ENCODING=br, SERVE_INJECT=0, SERVE_HINTS=0, SERVE_MANIFEST_ONLY=1 (passed through to serve.ts).
// PERF_GATE=1 exits 1 when the route is over the cost model (what CI sets).
/* oxlint-disable no-await-in-loop -- runs are sequential on purpose: parallel Lighthouse runs would distort each other */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import lighthouse from 'lighthouse';
import { COST_MODEL, judgeCost, splitScripts } from '@mfeflow/contracts';
import { chromium } from '@playwright/test';

const here = import.meta.dirname;
const RUNS = Number(process.env.RUNS ?? '10');
const PORT = 9341;
const SHELL_PORT = 4300;
const MONOLITH_PORT = 4302;
const PAGE = process.env.PAGE ?? '/catalog';
const OUT = process.env.OUT ?? 'perf-results.json';

function median(xs: number[]): number {
  const s = xs.toSorted((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => {
      resolve(false);
    });
    probe.listen(port, () => {
      probe.close(() => {
        resolve(true);
      });
    });
  });
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${url}`);
}

interface Request {
  path: string;
  type: string;
  bytes: number;
  startMs: number;
}

interface Run {
  lcpMs: number;
  jsBytes: number;
  requests: Request[];
}

interface Sample {
  lcpMs: number;
  jsBytes: number;
  jsKb: number;
  jsFiles: number;
  /** The run whose LCP is closest to the median. */
  requests: Request[];
}

function numberAt(obj: unknown, ...keys: string[]): number {
  let cur: unknown = obj;
  for (const k of keys)
    cur = typeof cur === 'object' && cur !== null ? Reflect.get(cur, k) : undefined;
  return typeof cur === 'number' ? cur : Number.NaN;
}

function requestsOf(lhr: unknown): Request[] {
  const items: unknown = ['audits', 'network-requests', 'details', 'items'].reduce<unknown>(
    (cur, k) => (typeof cur === 'object' && cur !== null ? Reflect.get(cur, k) : undefined),
    lhr,
  );
  if (!Array.isArray(items)) return [];
  const out: Request[] = [];
  for (const item of items as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const url: unknown = Reflect.get(item, 'url');
    const type: unknown = Reflect.get(item, 'resourceType');
    if (typeof url !== 'string' || typeof type !== 'string') continue;
    out.push({
      path: new URL(url).pathname,
      type,
      bytes: numberAt(item, 'transferSize'),
      startMs: Math.round(numberAt(item, 'networkRequestTime')),
    });
  }
  return out;
}

async function measure(url: string): Promise<Sample> {
  const runs: Run[] = [];
  for (let i = 0; i < RUNS; i++) {
    const result = await lighthouse(url, {
      port: PORT,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
    });
    if (!result) throw new Error(`lighthouse returned nothing for ${url}`);
    const requests = requestsOf(result.lhr);
    runs.push({
      lcpMs: numberAt(result.lhr, 'audits', 'largest-contentful-paint', 'numericValue'),
      jsBytes: requests.filter((r) => r.type === 'Script').reduce((sum, r) => sum + r.bytes, 0),
      requests,
    });
  }
  const lcpMs = median(runs.map((r) => r.lcpMs));
  const jsBytes = median(runs.map((r) => r.jsBytes));
  const nearest = runs.toSorted((a, b) => Math.abs(a.lcpMs - lcpMs) - Math.abs(b.lcpMs - lcpMs))[0];
  const requests = (nearest?.requests ?? []).toSorted((a, b) => a.startMs - b.startMs);
  const t0 = requests[0]?.startMs ?? 0;
  return {
    lcpMs: Math.round(lcpMs),
    jsBytes: Math.round(jsBytes),
    jsKb: Math.round((jsBytes / 1024) * 10) / 10,
    jsFiles: requests.filter((r) => r.type === 'Script').length,
    requests: requests.map((r) => ({
      path: r.path,
      type: r.type,
      bytes: r.bytes,
      startMs: r.startMs - t0,
    })),
  };
}

for (const port of [SHELL_PORT, MONOLITH_PORT, PORT]) {
  if (!(await portIsFree(port))) {
    throw new Error(`port ${String(port)} is in use; a stale server would answer the measurement`);
  }
}

const server = spawn(process.execPath, ['serve.ts'], {
  cwd: here,
  env: process.env,
  stdio: 'ignore',
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let report;
try {
  browser = await chromium.launch({
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    args: [`--remote-debugging-port=${String(PORT)}`],
  });
  await waitFor(`http://localhost:${String(MONOLITH_PORT)}/`);
  await waitFor(`http://localhost:${String(SHELL_PORT)}/registry/index.json`);
  const monolith = await measure(`http://localhost:${String(MONOLITH_PORT)}${PAGE}`);
  const shell = await measure(`http://localhost:${String(SHELL_PORT)}${PAGE}`);
  const lcpDeltaMs = shell.lcpMs - monolith.lcpMs;
  const jsDeltaKb = Math.round(((shell.jsBytes - monolith.jsBytes) / 1024) * 10) / 10;
  const { shellBytes, remoteBytes } = splitScripts(shell.requests);
  const verdict = judgeCost({
    shellBytes,
    monolithBytes: monolith.jsBytes,
    remoteBytes,
    lcpDeltaMs,
  });
  report = {
    label: process.env.LABEL ?? 'final',
    page: PAGE,
    runs: RUNS,
    target: COST_MODEL,
    monolith,
    shell,
    lcpDeltaMs,
    jsDeltaKb,
    verdict,
    pass: verdict.pass,
  };
} finally {
  await browser?.close();
  server.kill();
}

fs.writeFileSync(path.resolve(here, OUT), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      ...report,
      monolith: { ...report.monolith, requests: undefined },
      shell: { ...report.shell, requests: undefined },
    },
    null,
    2,
  ),
);
if (process.env.PERF_GATE === '1' && !report.pass) {
  console.error(`over the cost model on ${PAGE}: ${JSON.stringify(report.verdict)}`);
  process.exitCode = 1;
}
