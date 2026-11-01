// How fast the registry server moves people: time from sending `rollback` (and `kill`) until a fresh read of the
// index shows it, and until the static fallback index on disk shows it. Everything runs on this machine: the server,
// its SQLite file, a small artifact server and a local folder as the fallback host. It is a floor, not a CDN number.
//   pnpm build                              (the registry package must be built)
//   node bench/registry-server.ts           (RUNS default 20)
// Writes bench/results/<date>-server.json.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { artifactPrefix } from '@mfeflow/registry/static';
import {
  configFromEnv,
  createToken,
  sqliteSupport,
  startRegistryServer,
} from '@mfeflow/registry/server';
import { median, percentile, resultName } from './stats.ts';

const RUNS = Number(process.env.RUNS ?? '20');
const repo = path.resolve(import.meta.dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-server-bench-'));
const fallbackDir = path.join(work, 'fallback');

if (!sqliteSupport(process.versions.node).ok) {
  console.error(sqliteSupport(process.versions.node).message);
  process.exit(1);
}

const manifest = (name: string): string =>
  JSON.stringify({
    name,
    metaData: {
      name,
      globalName: name,
      publicPath: 'auto',
      remoteEntry: { name: 'remoteEntry.js', path: '', type: 'global' },
    },
    exposes: [{ path: './App', assets: { js: { sync: ['static/js/App.js'] }, css: { sync: [] } } }],
    shared: [{ name: 'react', version: '19.0.0', singleton: true, requiredVersion: '^19.0.0' }],
  });

const files = new Map<string, string>();
function seed(name: string, version: string): void {
  const prefix = artifactPrefix(name, version);
  files.set(`/artifacts/${prefix}/mf-manifest.json`, manifest(name));
  files.set(`/artifacts/${prefix}/remoteEntry.js`, `// ${name}@${version}`);
  files.set(`/artifacts/${prefix}/static/js/App.js`, `// ${name}@${version} app`);
}

const artifactServer = http.createServer((req, res) => {
  const body = files.get(req.url ?? '');
  res.writeHead(body === undefined ? 404 : 200).end(body);
});
await new Promise<void>((resolve) => artifactServer.listen(0, '127.0.0.1', resolve));
const address = artifactServer.address();
if (address === null || typeof address === 'string')
  throw new Error('the artifact server has no port');
const base = `http://127.0.0.1:${String(address.port)}/artifacts`;

const config = configFromEnv({
  MFEFLOW_REGISTRY_PORT: '0',
  MFEFLOW_REGISTRY_DB: path.join(work, 'registry.db'),
  MFEFLOW_REGISTRY_ARTIFACT_BASE_URL: base,
  MFEFLOW_REGISTRY_FALLBACK_HOST: `file:${fallbackDir}`,
});
const server = await startRegistryServer({ config, log: () => undefined });
const { token } = await createToken(server.storage, {
  env: '*',
  remote: '*',
  actions: ['read', 'deploy', 'promote', 'rollback', 'kill'],
});

async function post(route: string, body: unknown): Promise<void> {
  const res = await fetch(`${server.url}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${route} ${String(res.status)}: ${await res.text()}`);
}

/** The version of `cart` an index (as parsed JSON) lists, if it lists one. */
function cartVersion(index: unknown): string | undefined {
  const remotes: unknown =
    typeof index === 'object' && index !== null ? Reflect.get(index, 'remotes') : [];
  if (!Array.isArray(remotes)) return undefined;
  for (const r of remotes as unknown[]) {
    if (typeof r !== 'object' || r === null || Reflect.get(r, 'name') !== 'cart') continue;
    const version: unknown = Reflect.get(r, 'version');
    return typeof version === 'string' ? version : undefined;
  }
  return undefined;
}

async function served(env: string): Promise<string | undefined> {
  const res = await fetch(`${server.url}/v1/index/${env}`);
  return res.ok ? cartVersion(await res.json()) : undefined;
}

function fallbackServes(env: string): string | undefined {
  try {
    return cartVersion(
      JSON.parse(fs.readFileSync(path.join(fallbackDir, 'envs', env, 'index.json'), 'utf8')),
    );
  } catch {
    return undefined;
  }
}

/** Polls `read` back to back until it returns `want`; the time since `since`. */
async function until(
  since: number,
  read: () => Promise<string | undefined> | string | undefined,
  want: string | undefined,
): Promise<number> {
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- each read is a fresh request, one after another
    if ((await read()) === want) return performance.now() - since;
    if (performance.now() - since > 30_000) throw new Error(`never showed ${String(want)}`);
    // oxlint-disable-next-line no-await-in-loop -- yield so the server and the file writer run
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const deployBody = (env: string, version: string) => ({
  env,
  remote: 'cart',
  version,
  owner: 'bench',
  routes: ['/cart'],
  manifestUrl: `${base}/${artifactPrefix('cart', version)}/mf-manifest.json`,
});

const stat = (values: number[]) => ({
  medianMs: Math.round(median(values)),
  p95Ms: Math.round(percentile(values, 95)),
  maxMs: Math.round(Math.max(...values)),
});

interface Run {
  rollbackVisibleMs: number;
  rollbackFallbackMs: number;
  killVisibleMs: number;
  killFallbackMs: number;
}

async function oneRun(n: number): Promise<Run> {
  const env = `bench-${String(n)}`;
  await post('/v1/deploy', deployBody(env, '1.0.0'));
  await post('/v1/deploy', deployBody(env, '2.0.0'));
  await until(performance.now(), () => fallbackServes(env), '2.0.0');

  const t0 = performance.now();
  await post('/v1/rollback', { env, remote: 'cart' });
  const rollbackVisibleMs = await until(t0, () => served(env), '1.0.0');
  const rollbackFallbackMs = await until(t0, () => fallbackServes(env), '1.0.0');

  const t1 = performance.now();
  await post('/v1/kill', { env, remote: 'cart', reason: 'bench' });
  const killVisibleMs = await until(t1, () => served(env), undefined);
  const killFallbackMs = await until(t1, () => fallbackServes(env), undefined);
  return { rollbackVisibleMs, rollbackFallbackMs, killVisibleMs, killFallbackMs };
}

try {
  for (const v of ['1.0.0', '2.0.0']) seed('cart', v);
  console.log('warm-up run (not timed)');
  await oneRun(0);
  const runs: Run[] = [];
  for (let i = 1; i <= RUNS; i++) {
    // oxlint-disable-next-line no-await-in-loop -- runs are sequential on purpose: they share one server and a CPU
    runs.push(await oneRun(i));
  }
  const col = (pick: (r: Run) => number): number[] => runs.map(pick);
  const summary = {
    rollbackVisible: stat(col((r) => r.rollbackVisibleMs)),
    rollbackFallback: stat(col((r) => r.rollbackFallbackMs)),
    killVisible: stat(col((r) => r.killVisibleMs)),
    killFallback: stat(col((r) => r.killFallbackMs)),
  };
  let commit = 'unknown';
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
    );
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      env,
      encoding: 'utf8',
    }).trim();
  } catch {
    // not a git checkout
  }
  const report = {
    measured: new Date().toISOString(),
    what: 'time from sending the request until a fresh GET /v1/index/<env> shows it (visible), and until envs/<env>/index.json in the fallback folder shows it (fallback)',
    runsTimed: RUNS,
    setup:
      'registry server, SQLite file, artifact server and fallback folder all on this machine, over 127.0.0.1',
    notMeasured:
      'network distance, a CDN or real S3 as the fallback host, a returning browser holding the index for its 5 s max-age (add up to 5 s), and load',
    commit,
    machine: {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpus: os.cpus().length,
      node: process.version,
    },
    summary,
    runs,
  };
  const out = path.join(import.meta.dirname, 'results', `${resultName(new Date())}-server.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\nmedian over ${String(RUNS)} runs (local, no network):\n  rollback visible in the index: ${String(summary.rollbackVisible.medianMs)} ms (max ${String(summary.rollbackVisible.maxMs)} ms)\n  rollback in the fallback file: ${String(summary.rollbackFallback.medianMs)} ms (max ${String(summary.rollbackFallback.maxMs)} ms)\n  kill visible in the index:     ${String(summary.killVisible.medianMs)} ms (max ${String(summary.killVisible.maxMs)} ms)\n  kill in the fallback file:     ${String(summary.killFallback.medianMs)} ms (max ${String(summary.killFallback.maxMs)} ms)`,
  );
  console.log(`wrote ${out}`);
  if (summary.rollbackVisible.maxMs >= 10_000) process.exitCode = 1;
} finally {
  await server.close();
  artifactServer.close();
  fs.rmSync(work, { recursive: true, force: true });
}
