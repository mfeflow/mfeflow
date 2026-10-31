// Phase 01 gate 4, re-measured on the real packages: LCP and transferred JS of
// the storefront shell vs the same pages built as one app, with and without the
// inline registry + preload hints. Lighthouse mobile preset, median of RUNS.
//   pnpm --filter @storefront/e2e perf          (after pnpm build)
/* oxlint-disable no-await-in-loop -- runs are sequential on purpose: parallel Lighthouse runs would distort each other */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import lighthouse from 'lighthouse';
import { chromium } from '@playwright/test';

const here = import.meta.dirname;
const RUNS = Number(process.env.RUNS ?? '10');
const PORT = 9341;
const PAGE = process.env.PAGE ?? '/catalog';

function median(xs: number[]): number {
  const s = xs.toSorted((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
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

async function withServer<T>(inline: boolean, fn: () => Promise<T>): Promise<T> {
  const server = spawn(process.execPath, ['serve.ts'], {
    cwd: here,
    env: { ...process.env, SERVE_INLINE: inline ? '1' : '0' },
    stdio: 'ignore',
  });
  try {
    await waitFor('http://localhost:4302/');
    return await fn();
  } finally {
    server.kill();
  }
}

interface Sample {
  lcpMs: number;
  jsKb: number;
}

function numberAt(obj: unknown, ...keys: string[]): number {
  let cur: unknown = obj;
  for (const k of keys)
    cur = typeof cur === 'object' && cur !== null ? Reflect.get(cur, k) : undefined;
  return typeof cur === 'number' ? cur : Number.NaN;
}

function scriptBytes(lhr: unknown): number {
  const items: unknown = [lhr, 'audits', 'network-requests', 'details', 'items']
    .slice(1)
    .reduce<unknown>(
      (cur, k) => (typeof cur === 'object' && cur !== null ? Reflect.get(cur, k) : undefined),
      lhr,
    );
  if (!Array.isArray(items)) return Number.NaN;
  let total = 0;
  for (const item of items as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    if (Reflect.get(item, 'resourceType') === 'Script') {
      const size: unknown = Reflect.get(item, 'transferSize');
      if (typeof size === 'number') total += size;
    }
  }
  return total;
}

async function measure(url: string): Promise<Sample> {
  const lcp: number[] = [];
  const js: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const result = await lighthouse(url, {
      port: PORT,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
    });
    if (!result) throw new Error(`lighthouse returned nothing for ${url}`);
    lcp.push(numberAt(result.lhr, 'audits', 'largest-contentful-paint', 'numericValue'));
    js.push(scriptBytes(result.lhr));
  }
  return { lcpMs: Math.round(median(lcp)), jsKb: Math.round(median(js) / 1024) };
}

const browser = await chromium.launch({
  ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  args: [`--remote-debugging-port=${String(PORT)}`],
});
const out: Record<
  string,
  { monolith: Sample; shell: Sample; lcpDeltaMs: number; jsDeltaPct: number }
> = {};
try {
  for (const inline of [false, true]) {
    const label = inline ? 'inline registry + preload' : 'baseline';
    out[label] = await withServer(inline, async () => {
      const monolith = await measure(`http://localhost:4302${PAGE}`);
      const shell = await measure(`http://localhost:4300${PAGE}`);
      return {
        monolith,
        shell,
        lcpDeltaMs: shell.lcpMs - monolith.lcpMs,
        jsDeltaPct: Math.round(((shell.jsKb - monolith.jsKb) / monolith.jsKb) * 100),
      };
    });
  }
} finally {
  await browser.close();
}

const report = {
  page: PAGE,
  runs: RUNS,
  target: { lcpDeltaMs: 300, jsDeltaPct: 40 },
  results: out,
};
fs.writeFileSync(path.join(here, 'perf-results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
