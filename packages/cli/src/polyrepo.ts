import fs from 'node:fs/promises';
import path from 'node:path';
import {
  inOrder,
  MfeflowError,
  renderTemplate,
  resolveFeature,
  type LoadedFeature,
  type MfeflowProject,
  type Plan,
} from '@mfeflow/core';
import type { FeatureFile } from '@mfeflow/contracts';
import type { Globals } from './args';
import { DEV_CONFIG_IN_APP, devConfigText, type RemoteSpec } from './devremotes';
import { loadAny, POLYREPO_FEATURE } from './catalog';
import { REMOTE_PORT, remoteGlue, SHELL_PORT } from './glue';
import { assertOptionsAreForFeatures, type FeatureOptions } from './options';
import { chooseLocal } from './local';
import type { PlanReport } from './output';
import { createBuilder } from './pipeline';
import type { Runtime } from './runtime';
import { writePlan, type WriteOutcome } from './write';

export const PLATFORM_DIR = 'platform';
export const SHELL_DIR = 'shell';

export type RepoKind = 'platform' | 'shell' | 'remote';

/** Features that write a file the polyrepo template already owns. */
const CLASHES: Readonly<Record<string, string>> = {
  'ci-github': 'every repo already calls the reusable workflow in the platform repo',
  'env-t3': 'it writes the runtime-config files the shell lists its dev remotes in',
};

export function assertFeaturesFit(features: readonly string[]): void {
  for (const name of features) {
    const why = CLASHES[name];
    if (why !== undefined) {
      throw new MfeflowError('E107', `--features ${name}: not in a polyrepo yet, ${why}`);
    }
  }
}

export interface RepoRequest {
  kind: RepoKind;
  /** The folder inside the org folder. */
  dir: string;
  root: string;
  scope: string;
  /** The GitHub owner the CI and Renovate files point at; the scope without `@` when empty. */
  org?: string | undefined;
  /** The remote this repo holds (kind remote only). */
  remote?: RemoteSpec;
  /** The remotes the shell routes to and lists in its dev config (kind shell only). */
  shellRemotes?: readonly RemoteSpec[];
  features: readonly string[];
  featureOptions: FeatureOptions;
  local: string | undefined;
  cwd: string;
}

/** Where the shell and each remote install `<scope>/*` from until the platform packages are published. */
export function platformLinks(scope: string): Record<string, string> {
  return Object.fromEntries(
    ['contracts', 'tokens'].map((name) => [
      `${scope}/${name}`,
      `link:../../../${PLATFORM_DIR}/packages/${name}`,
    ]),
  );
}

export function remotePorts(names: readonly string[]): RemoteSpec[] {
  return names.map((name, index) => ({ name, port: REMOTE_PORT + index }));
}

export function repoProject(kind: RepoKind, scope: string, remote?: RemoteSpec): MfeflowProject {
  const apps: MfeflowProject['apps'] = {};
  if (kind === 'shell') apps.shell = { kind: 'shell', path: 'apps/shell', port: SHELL_PORT };
  if (kind === 'remote' && remote) {
    apps[remote.name] = { kind: 'remote', path: `apps/${remote.name}`, port: remote.port };
  }
  return {
    version: 1,
    repo: kind,
    topology: 'polyrepo',
    packageManager: 'pnpm',
    scope,
    apps,
    features: {},
  };
}

function dropFiles(files: FeatureFile[], drop: (file: FeatureFile) => boolean): FeatureFile[] {
  return files.filter((file) => !drop(file));
}

const isRoot = (file: FeatureFile): boolean => (file.target ?? 'root') === 'root';

const ROOT_FILES_OF_PLATFORM = new Set(['.gitignore', '.nvmrc', 'pnpm-workspace.yaml']);

/**
 * `core` for one repo of a polyrepo: the same files and dependencies, minus what belongs to the
 * monorepo as a whole. The root package.json is named after the repo, the README and AGENTS.md come
 * from the polyrepo template, and a platform repo keeps only the workspace files.
 */
export async function polyrepoCore(
  core: LoadedFeature,
  request: Pick<RepoRequest, 'kind' | 'scope' | 'remote'>,
): Promise<LoadedFeature> {
  const { kind, scope } = request;
  const manifest = { ...core.manifest };
  const packageText = (await core.readAsset?.('files/root/package.json.eta')) ?? '{}';
  const parsed: unknown = JSON.parse(renderTemplate(packageText, { scope }, 'core:package.json'));
  const label = kind === 'remote' ? (request.remote?.name ?? 'remote') : kind;
  const pkg = {
    ...(typeof parsed === 'object' && parsed !== null ? parsed : {}),
    name: `${scope.slice(1)}-${label}`,
  };
  let files = (manifest.files ?? []).map((file): FeatureFile => {
    if (isRoot(file) && file.to === 'package.json') {
      return { to: 'package.json', target: 'root', content: `${JSON.stringify(pkg, null, 2)}\n` };
    }
    return file;
  });
  files = dropFiles(files, (file) => isRoot(file) && ['README.md', 'AGENTS.md'].includes(file.to));
  if (kind === 'platform') {
    files = files.filter(
      (file) => isRoot(file) && (file.to === 'package.json' || ROOT_FILES_OF_PLATFORM.has(file.to)),
    );
  }
  if (kind !== 'shell') files = dropFiles(files, (file) => file.to.startsWith('registry/'));
  const keep = kind !== 'platform';
  return {
    ...core,
    manifest: {
      ...manifest,
      files,
      dependencies: keep ? (manifest.dependencies ?? []) : [],
      scripts: keep ? (manifest.scripts ?? []) : [],
    },
  };
}

function devConfigFeature(core: LoadedFeature, remotes: readonly RemoteSpec[]): LoadedFeature {
  return {
    trust: 'first-party',
    manifest: {
      name: 'core',
      version: core.manifest.version,
      files: [{ to: DEV_CONFIG_IN_APP, target: 'shell', content: devConfigText(remotes) }],
    },
  };
}

export interface RepoPlan {
  request: RepoRequest;
  project: MfeflowProject;
  plan: Plan;
}

/** What one repo of the polyrepo would get; nothing is written. */
export async function planRepo(rt: Runtime, request: RepoRequest): Promise<RepoPlan> {
  const { kind, scope, root } = request;
  const chosen = chooseLocal(
    repoProject(kind, scope, request.remote),
    root,
    request.cwd,
    request.local,
  );
  const { project } = chosen;
  const builder = createBuilder(root, chosen.checkout, platformLinks(scope));
  const withApps = kind !== 'platform';
  const names = [
    'core',
    ...(withApps ? ['tsconfig'] : []),
    POLYREPO_FEATURE,
    ...(withApps ? request.features : []),
  ];
  assertOptionsAreForFeatures(request.featureOptions, names);
  const loaded = await Promise.all(names.map((name) => loadAny(name, { roots: rt.roots })));
  const [first, ...others] = loaded;
  if (first === undefined) throw new MfeflowError('E201', 'core');
  const core = await polyrepoCore(first, request);
  const polyrepoOptions = {
    repo: kind,
    ...(request.remote ? { name: request.remote.name } : {}),
    ...(request.org ? { org: request.org } : {}),
  };
  await inOrder([core, ...others], (feature) =>
    resolveFeature({
      feature,
      project,
      builder,
      options:
        feature.manifest.name === POLYREPO_FEATURE
          ? polyrepoOptions
          : (request.featureOptions[feature.manifest.name] ?? {}),
      alsoAdding: names,
    }),
  );
  if (kind === 'shell') {
    const remotes = request.shellRemotes ?? [];
    await resolveFeature({ feature: devConfigFeature(core, remotes), project, builder });
    await inOrder(remotes, async (remote) => {
      await resolveFeature({
        feature: await remoteGlue({
          roots: rt.roots,
          version: core.manifest.version,
          remote,
          registry: true,
          registryEnvs: ['staging', 'prod'],
          shells: ['shell'],
        }),
        project,
        builder,
        alsoAdding: names,
      });
    });
  }
  return { request, project, plan: builder.build() };
}

/** `report` with every path under `dir/`, so reports of several repos can share one list. */
export function prefixReport(report: PlanReport, dir: string): PlanReport {
  const at = (file: string): string => `${dir}/${file}`;
  return {
    features: report.features,
    changes: report.changes.map((c) => ({ ...c, path: at(c.path) })),
    dependencies: report.dependencies.map((d) => ({ ...d, file: at(d.file) })),
    scripts: report.scripts.map((s) => ({ ...s, file: at(s.file) })),
    warnings: report.warnings.map((w) => `${dir}: ${w}`),
  };
}

export function mergeReports(reports: readonly PlanReport[]): PlanReport {
  const features = new Map<string, string>();
  for (const report of reports) for (const f of report.features) features.set(f.name, f.version);
  return {
    features: [...features].map(([name, version]) => ({ name, version })),
    changes: reports.flatMap((r) => r.changes),
    dependencies: reports.flatMap((r) => r.dependencies),
    scripts: reports.flatMap((r) => r.scripts),
    warnings: reports.flatMap((r) => r.warnings),
  };
}

export interface RepoWrite {
  repo: RepoPlan;
  outcome: WriteOutcome;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch {
    return false;
  }
}

/** The folders of `dir`'s path that do not exist yet, outermost first. */
export async function missingParents(dir: string): Promise<string[]> {
  const missing: string[] = [];
  let current = dir;
  // oxlint-disable-next-line no-await-in-loop -- walks up one folder at a time
  while (!(await exists(current))) {
    missing.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return missing;
}

/** The warning for repos `git init` did not make, or nothing when all of them are. */
export function notReposWarning(dirs: readonly string[]): string[] {
  if (dirs.length === 0) return [];
  return [
    `${dirs.join(', ')} ${dirs.length === 1 ? 'is' : 'are'} not a git repo (git is missing or failed); run git init there`,
  ];
}

export interface RepoWrites {
  writes: RepoWrite[];
  /** Folders where `git init` did not run. */
  notRepos: string[];
}

/**
 * Writes the repos one after another, each in its own transaction with its own `git init`. If one
 * fails, the repos this run already wrote are removed again, and so are the folders above them that
 * this run made (while empty), so nothing half-built is left behind.
 */
export async function writeRepos(
  rt: Runtime,
  globals: Globals,
  org: string,
  repos: readonly RepoPlan[],
): Promise<RepoWrites> {
  const made: string[] = [];
  const created = await missingParents(org);
  const writes: RepoWrite[] = [];
  const notRepos: string[] = [];
  try {
    await inOrder(repos, async (repo) => {
      const { request, project, plan } = repo;
      if (!globals.json) rt.io.stdout(`\n${request.dir}/`);
      const outcome = await writePlan({
        rt,
        globals: { ...globals, canPrompt: false },
        root: request.root,
        plan,
        project,
        afterWrite: async () => {
          if (!(await rt.system.initRepo(request.root))) notRepos.push(request.dir);
        },
      });
      if (!outcome.dryRun) made.push(request.root);
      writes.push({ repo, outcome });
    });
  } catch (error) {
    await Promise.all(made.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    for (const dir of created.toReversed()) {
      // oxlint-disable-next-line no-await-in-loop -- innermost first, each only while empty
      await fs.rmdir(dir).catch(() => undefined);
    }
    throw error;
  }
  return { writes, notRepos };
}

const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The GitHub owner from `--org`, checked; undefined when not given. */
export function checkOrg(org: string | undefined): string | undefined {
  if (org === undefined || org === '') return undefined;
  if (!GITHUB_OWNER.test(org)) {
    throw new MfeflowError('E107', `--org "${org}" must be a GitHub user or organization name`);
  }
  return org;
}
