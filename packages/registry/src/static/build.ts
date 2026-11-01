import zlib from 'node:zlib';
import {
  assetsFromManifest,
  COST_MODEL,
  judgeRemoteInitial,
  primaryExpose,
  registryRemoteIssues,
  remoteDistFiles,
  routesOverlap,
  validateRegistryEntry,
  validateRegistryIndex,
  type CostModel,
  type MfeManifest,
  type RegistryIndex,
  type RegistryIndexRemote,
} from '@mfeflow/contracts';
import { compatProblems } from './compat';
import { versionKey } from './host';

export const GATE_CODES = ['schema', 'route-overlap', 'compat', 'budget', 'rollout'] as const;
export type GateCode = (typeof GATE_CODES)[number];

export interface GateFailure {
  code: GateCode;
  message: string;
  remote: string;
  version: string;
  route?: string;
}

export const HISTORY_LIMIT = 10;

export interface DeployInput {
  /** The remote's `mfe.json`: name, owner, routes, budgets, platform. */
  remote: MfeManifest;
  version: string;
  /** The remote's built `mf-manifest.json`. */
  manifest: unknown;
  /** The build output, path inside the build folder → bytes. Sizes are measured from it. */
  files: Readonly<Record<string, Uint8Array>>;
  env: string;
  /** Where artifacts are served from, without a trailing slash (`https://cdn.example.com`). */
  baseUrl: string;
  /** The index now served for `env`. */
  currentIndex?: RegistryIndex;
  /** The target shell's deployed `mf-manifest.json`. */
  shellManifest?: unknown;
  /** Package versions to compare against when the shell manifest does not list a package. */
  workspaceVersions?: Record<string, string> | undefined;
  /** A rollout was requested. Static hosts cannot split traffic, so this always fails the deploy. */
  rollout?: unknown;
  costModel?: CostModel;
  historyLimit?: number;
  generatedAt?: string | undefined;
}

export interface BuildResult {
  index: RegistryIndex;
  failures: GateFailure[];
}

/** Where a version's files live, relative to the host root. */
export const artifactPrefix = (name: string, version: string): string =>
  `${name}/${versionKey(version)}`;

export const indexKey = (env: string): string => `envs/${env}/index.json`;

const gzipLength = (bytes: Uint8Array): number => zlib.gzipSync(bytes, { level: 6 }).length;

function measure(
  input: DeployInput,
): { entryBytes: number; exposeBytes: number } | { problem: string } {
  const dist = remoteDistFiles(input.manifest);
  if (dist === undefined) return { problem: 'mf-manifest.json has no usable remote entry' };
  const sizeOf = (paths: readonly string[]): number | string => {
    let total = 0;
    for (const file of paths) {
      const bytes = input.files[file];
      if (bytes === undefined) return file;
      total += gzipLength(bytes);
    }
    return total;
  };
  const entryBytes = sizeOf([dist.entry]);
  if (typeof entryBytes === 'string')
    return { problem: `${entryBytes} is not in the build output` };
  const expose = primaryExpose(Object.keys(dist.exposes));
  const exposeBytes = expose === undefined ? 0 : sizeOf(dist.exposes[expose] ?? []);
  if (typeof exposeBytes === 'string')
    return { problem: `${exposeBytes} is not in the build output` };
  return { entryBytes, exposeBytes };
}

function nextRemote(
  input: DeployInput,
  previous: RegistryIndexRemote | undefined,
): RegistryIndexRemote {
  const base = `${input.baseUrl}/${artifactPrefix(input.remote.name, input.version)}`;
  const entry = `${base}/mf-manifest.json`;
  let assets;
  try {
    assets = assetsFromManifest(input.manifest, entry);
  } catch {
    assets = undefined;
  }
  const limit = input.historyLimit ?? HISTORY_LIMIT;
  const served = previous?.version;
  const replacing = served !== undefined && served !== input.version;
  const older = replacing ? [served, ...(previous?.history ?? [])] : (previous?.history ?? []);
  const history = [...new Set(older)].filter((v) => v !== input.version).slice(0, limit);
  const before = replacing ? served : previous?.previous;
  return {
    name: input.remote.name,
    entry,
    ...(assets?.remoteEntry === undefined ? {} : { remoteEntry: assets.remoteEntry }),
    ...(assets?.type === undefined ? {} : { type: assets.type }),
    ...(assets?.entryGlobalName === undefined ? {} : { entryGlobalName: assets.entryGlobalName }),
    ...(assets === undefined || Object.keys(assets.exposes).length === 0
      ? {}
      : { exposes: assets.exposes }),
    version: input.version,
    routes: input.remote.routes,
    owner: input.remote.owner,
    ...(before === undefined ? {} : { previous: before }),
    ...(history.length === 0 ? {} : { history }),
  };
}

const OVERLAP_ISSUE = /overlaps route/;

interface Gate {
  code: GateCode;
  message: string;
  route?: string;
}

const gate = (code: GateCode, message: string, route?: string): Gate => ({
  code,
  message,
  ...(route === undefined ? {} : { route }),
});

function manifestName(manifest: unknown): string | undefined {
  if (typeof manifest !== 'object' || manifest === null || !('name' in manifest)) return undefined;
  return typeof manifest.name === 'string' ? manifest.name : undefined;
}

function schemaGate(input: DeployInput, remote: RegistryIndexRemote, index: RegistryIndex): Gate[] {
  const messages = new Set<string>([
    ...validateRegistryEntry({ version: input.version, manifestUrl: remote.entry }).map(
      (i) => `${i.path} ${i.message}`,
    ),
    ...registryRemoteIssues(remote).map((i) => `${i.path} ${i.message}`),
    ...validateRegistryIndex(index)
      .filter((i) => !OVERLAP_ISSUE.test(i.message))
      .map((i) => `index ${i.path} ${i.message}`),
  ]);
  const named = manifestName(input.manifest);
  if (named !== undefined && named !== input.remote.name)
    messages.add(`mf-manifest.json is for "${named}" but mfe.json names "${input.remote.name}"`);
  return [...messages].map((message) => gate('schema', message));
}

function overlapGate(input: DeployInput, others: readonly RegistryIndexRemote[]): Gate[] {
  const out: Gate[] = [];
  for (const route of input.remote.routes)
    for (const other of others)
      for (const taken of other.routes ?? []) {
        if (!routesOverlap(route, taken)) continue;
        const who = other.version === undefined ? other.name : `${other.name}@${other.version}`;
        out.push(
          gate('route-overlap', `route "${route}" overlaps route "${taken}" of ${who}`, route),
        );
      }
  return out;
}

function compatGate(input: DeployInput): Gate[] {
  return compatProblems({
    remoteManifest: input.manifest,
    platform: input.remote.platform,
    shellManifest: input.shellManifest,
    workspaceVersions: input.workspaceVersions,
  }).map((p) =>
    gate('compat', `needs ${p.name} ${p.range} (${p.source}) but the shell provides ${p.provided}`),
  );
}

function budgetGate(input: DeployInput): Gate[] {
  const size = measure(input);
  if ('problem' in size) return [gate('budget', `cannot measure initial JS: ${size.problem}`)];
  const verdict = judgeRemoteInitial(
    size,
    input.remote.budgets?.initialJsKb,
    input.costModel ?? COST_MODEL,
  );
  if (verdict.pass) return [];
  const limit =
    verdict.source === 'mfe.json' ? 'mfe.json budgets.initialJsKb' : 'the cost model remoteKb';
  return [
    gate(
      'budget',
      `loads ${String(verdict.kb)} KB of JS first; ${limit} is ${String(verdict.limitKb)}`,
    ),
  ];
}

function rolloutGate(input: DeployInput): Gate[] {
  return input.rollout === undefined
    ? []
    : [
        gate(
          'rollout',
          'a rollout needs the registry server; a static host cannot split traffic by percent',
        ),
      ];
}

function indexWith(input: DeployInput, remote: RegistryIndexRemote): RegistryIndex {
  const current = input.currentIndex ?? { remotes: [] };
  const generatedAt = input.generatedAt ?? current.generatedAt;
  const replaced = current.remotes.some((r) => r.name === remote.name);
  return {
    ...(current.shell === undefined ? {} : { shell: current.shell }),
    env: input.env,
    ...(generatedAt === undefined ? {} : { generatedAt }),
    remotes: replaced
      ? current.remotes.map((r) => (r.name === remote.name ? remote : r))
      : [...current.remotes, remote],
  };
}

/**
 * The next registry index for `input.env` with this remote at this version, and every gate it fails.
 * Pure: reads nothing and writes nothing. The index is returned even when gates fail; do not publish it then.
 */
export function buildIndex(input: DeployInput): BuildResult {
  const { name } = input.remote;
  const current = input.currentIndex?.remotes ?? [];
  const remote = nextRemote(
    input,
    current.find((r) => r.name === name),
  );
  const index = indexWith(input, remote);
  const gates = [
    ...schemaGate(input, remote, index),
    ...overlapGate(
      input,
      current.filter((r) => r.name !== name),
    ),
    ...compatGate(input),
    ...budgetGate(input),
    ...rolloutGate(input),
  ];
  const failures: GateFailure[] = [];
  for (const g of gates) {
    failures.push({
      code: g.code,
      message: `${name}@${input.version}: ${g.message}`,
      remote: name,
      version: input.version,
      ...(g.route === undefined ? {} : { route: g.route }),
    });
  }
  return { index, failures };
}
