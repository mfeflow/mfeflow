import fs from 'node:fs/promises';
import path from 'node:path';
import {
  hasErrno,
  inOrder,
  messageOf,
  MfeflowError,
  resolveFeature,
  type LoadedFeature,
  type MfeflowProject,
} from '@mfeflow/core';
import {
  readGlobals,
  repeated,
  splitList,
  text,
  typed,
  assertKnownFlags,
  GLOBAL_ARGS,
  type Globals,
} from '../args';
import {
  DEFAULT_FEATURES,
  FIRST_PARTY,
  isFirstParty,
  loadAny,
  OPTIONAL_FEATURES,
} from '../catalog';
import { assertAppName, remoteGlue, REMOTE_PORT, SHELL_PORT } from '../glue';
import {
  assertOptionsAreForFeatures,
  mergeOptions,
  parseFeatureOptions,
  type FeatureOptions,
} from '../options';
import { planReport, type InitResult, type PlanReport } from '../output';
import { Cancelled } from '../exit';
import { chooseLocal } from '../local';
import { createBuilder } from '../pipeline';
import { loadPreset, type Preset } from '../preset';
import type { Runtime } from '../runtime';
import {
  chooseToolingPackages,
  DEFAULT_TOOLING_PACKAGES,
  TOOLING_PACKAGES,
} from '../tooling-packages';
import {
  assertFeaturesFit,
  assertToolingFeatures,
  checkOrg,
  notReposWarning,
  mergeReports,
  planRepo,
  prefixReport,
  remotePorts,
  writeRepos,
  PLATFORM_DIR,
  SHELL_DIR,
  type RepoPlan,
  type RepoRequest,
} from '../polyrepo';
import { writePlan } from '../write';
import type { ArgsDef } from 'citty';

export const INIT_ARGS = {
  dir: {
    type: 'positional',
    required: false,
    description: 'Folder to create (default mfeflow-app, or mfeflow-tooling for --kind tooling)',
  },
  kind: {
    type: 'string',
    description:
      'app (default): a shell and remotes; tooling: a repo for shared config and packages, with no apps',
    valueHint: 'app|tooling',
  },
  scope: {
    type: 'string',
    description: 'npm scope for the project packages, like @my-org',
    valueHint: '@scope',
  },
  remotes: {
    type: 'string',
    description:
      'Remotes to create, comma separated (default catalog,cart); none or "" starts with only a shell',
    valueHint: 'a,b',
  },
  packages: {
    type: 'string',
    description:
      'tooling: the packages to make in your scope, comma separated (default tsconfig,oxlint-config; none or "" for none)',
    valueHint: 'a,b',
  },
  features: {
    type: 'string',
    description: `Optional features, comma separated (${OPTIONAL_FEATURES.join(', ')})`,
    valueHint: 'a,b',
  },
  'package-manager': {
    type: 'string',
    description: 'pnpm (the only one in this release)',
    valueHint: 'pm',
  },
  topology: {
    type: 'string',
    description:
      'monorepo (default), or polyrepo: a platform repo, a shell repo and a repo for each remote',
    valueHint: 'name',
  },
  org: {
    type: 'string',
    description:
      'polyrepo: the GitHub owner the CI and Renovate files point at (default: the scope without @)',
    valueHint: 'owner',
  },
  option: {
    type: 'string',
    description: 'A feature option, repeatable: --option feature.key=value',
    valueHint: 'f.k=v',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

const DEFAULT_DIR = 'mfeflow-app';
const DEFAULT_TOOLING_DIR = 'mfeflow-tooling';
/** What a tooling repo offers and starts with. */
const TOOLING_FEATURES: readonly string[] = [
  'lint-oxlint',
  'git-hooks',
  'commit-prompt',
  'release',
];
const TOOLING_DEFAULTS: readonly string[] = ['lint-oxlint', 'git-hooks'];
const DEFAULT_REMOTES = ['catalog', 'cart'];
const SCOPE = /^@[a-z0-9][a-z0-9-._]*$/;
const NO_REMOTES = 'none';
const NO_PACKAGES = 'none';

export type Topology = 'monorepo' | 'polyrepo';
export type Kind = 'app' | 'tooling';

export interface InitOptions {
  kind: Kind;
  topology: Topology;
  org?: string;
  dir: string;
  scope: string;
  remotes: string[];
  features: string[];
  /** The tooling packages to make, with the ones they need; empty outside `--kind tooling`. */
  packages: string[];
  /** What the command says about the package choice. */
  packageNotices: string[];
  featureOptions: FeatureOptions;
}

/** `@` plus the folder name made safe for an npm scope. */
export function scopeFor(dir: string, cwd: string = process.cwd()): string {
  const name = path
    .basename(path.resolve(cwd, dir))
    .toLowerCase()
    .replaceAll(/[^a-z0-9-._]+/g, '-')
    .replaceAll(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  return `@${name === '' ? 'app' : name}`;
}

/** A remotes list from a flag, a preset or a prompt: empty or `none` is a shell with no remotes. */
export function parseRemotes(value: string | readonly string[] | undefined): string[] | undefined {
  const list = splitList(value);
  if (list === undefined || !list.includes(NO_REMOTES)) return list;
  if (list.length > 1) {
    throw new MfeflowError(
      'E107',
      `remotes: "${NO_REMOTES}" means no remotes at all, so it cannot be mixed with names (${list.join(', ')})`,
    );
  }
  return [];
}

/** A packages list from a flag or a preset: empty or `none` is no packages at all. */
export function parsePackages(value: string | readonly string[] | undefined): string[] | undefined {
  const list = splitList(value);
  if (list === undefined || !list.includes(NO_PACKAGES)) return list;
  if (list.length > 1) {
    throw new MfeflowError(
      'E107',
      `packages: "${NO_PACKAGES}" means no packages at all, so it cannot be mixed with names (${list.join(', ')})`,
    );
  }
  return [];
}

export function checkRemotes(remotes: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of remotes) {
    assertAppName(name);
    if (seen.has(name)) throw new MfeflowError('E215', `"${name}" is listed twice`);
    seen.add(name);
  }
}

/** The optional features to install, validated and in catalogue order. */
export function checkFeatures(requested: readonly string[]): string[] {
  const optional = new Set<string>();
  for (const name of requested) {
    if (FIRST_PARTY.some((f) => f.name === name && f.always)) continue;
    if (!isFirstParty(name)) {
      throw new MfeflowError(
        'E201',
        `"${name}" (init takes ${OPTIONAL_FEATURES.join(', ')}; add others later with \`mfeflow add\`)`,
      );
    }
    optional.add(name);
  }
  return OPTIONAL_FEATURES.filter((name) => optional.has(name));
}

function only(flag: string, value: string | undefined, allowed: string): void {
  if (value !== undefined && value !== allowed) {
    throw new MfeflowError(
      'E107',
      `--${flag} ${value}: only ${allowed} is available in this release`,
    );
  }
}

function kindOf(value: string | undefined): Kind {
  if (value === undefined || value === 'app' || value === 'tooling') return value ?? 'app';
  if (value === 'remote') {
    throw new MfeflowError('E107', '--kind remote: not available in this release');
  }
  throw new MfeflowError('E107', `--kind ${value}: use app, remote or tooling`);
}

function topologyOf(value: string | undefined): Topology {
  if (value === undefined || value === 'monorepo' || value === 'polyrepo') {
    return value ?? 'monorepo';
  }
  throw new MfeflowError(
    'E107',
    `--topology ${value}: only monorepo and polyrepo are available in this release`,
  );
}

/** Flags win over the preset, the preset over prompts, prompts over defaults. */
export async function resolveInitOptions(
  rt: Runtime,
  globals: Globals,
  args: Record<string, unknown>,
  raw: readonly string[],
  preset: Preset,
): Promise<InitOptions> {
  only('package-manager', text(args, 'package-manager') ?? preset.packageManager, 'pnpm');
  const kind = kindOf(text(args, 'kind') ?? preset.kind);
  const topology = topologyOf(text(args, 'topology') ?? preset.topology);
  const tooling = kind === 'tooling';
  if (tooling && text(args, 'topology') !== undefined) {
    throw new MfeflowError('E107', '--kind tooling is one repo; --topology does not apply to it');
  }
  if (tooling && (typed(args, 'remotes') !== undefined || preset.remotes !== undefined)) {
    throw new MfeflowError('E107', '--kind tooling has no apps, so it takes no --remotes');
  }
  const { canPrompt } = globals;
  const { prompter } = rt;

  const given = typeof args.dir === 'string' && args.dir !== '' ? args.dir : undefined;
  const fallbackDir = tooling ? DEFAULT_TOOLING_DIR : DEFAULT_DIR;
  const dir =
    given ??
    (canPrompt
      ? await prompter.text({ message: 'Where should the project go?', initialValue: fallbackDir })
      : fallbackDir);

  const scopeFlag = text(args, 'scope') ?? preset.scope;
  const scope =
    scopeFlag ??
    (canPrompt
      ? await prompter.text({
          message: 'npm scope for your packages',
          initialValue: scopeFor(dir, globals.cwd),
          validate: (v) => (SCOPE.test(v) ? undefined : 'Use a scope like @my-org'),
        })
      : scopeFor(dir, globals.cwd));
  if (!SCOPE.test(scope)) {
    throw new MfeflowError('E107', `--scope "${scope}" must look like @my-org`);
  }

  const remotesFlag = parseRemotes(typed(args, 'remotes')) ?? parseRemotes(preset.remotes);
  const remotes = tooling
    ? []
    : (remotesFlag ??
      (canPrompt
        ? (parseRemotes(
            await prompter.text({
              message: 'Remotes, comma separated (empty for none)',
              initialValue: DEFAULT_REMOTES.join(','),
            }),
          ) ?? [])
        : DEFAULT_REMOTES));
  checkRemotes(remotes);

  const featuresFlag = splitList(text(args, 'features')) ?? preset.features;
  const choices = tooling ? TOOLING_FEATURES : OPTIONAL_FEATURES;
  const defaults = tooling ? TOOLING_DEFAULTS : topology === 'polyrepo' ? [] : DEFAULT_FEATURES;
  const features = checkFeatures(
    featuresFlag ??
      (canPrompt
        ? await prompter.multiselect({
            message: 'Features',
            choices: choices.map((name) => ({ value: name, label: name })),
            initialValues: defaults,
          })
        : defaults),
  );
  if (topology === 'polyrepo') assertFeaturesFit(features);
  if (tooling) await assertToolingFeatures(rt, features);

  const packagesFlag = parsePackages(typed(args, 'packages')) ?? parsePackages(preset.packages);
  if (!tooling && packagesFlag !== undefined) {
    throw new MfeflowError('E107', '--packages is for --kind tooling');
  }
  const packageChoice = tooling
    ? chooseToolingPackages(
        packagesFlag ??
          (canPrompt
            ? await prompter.multiselect({
                message: 'Packages to make in your scope',
                choices: TOOLING_PACKAGES.map((entry) => ({
                  value: entry.name,
                  label: entry.name,
                })),
                initialValues: DEFAULT_TOOLING_PACKAGES,
              })
            : DEFAULT_TOOLING_PACKAGES),
      )
    : { packages: [], notices: [] };

  const featureOptions = mergeOptions(
    preset.options ?? {},
    parseFeatureOptions(repeated(raw, 'option')),
  );
  const org = checkOrg(text(args, 'org'));
  if (org !== undefined && topology !== 'polyrepo' && !tooling) {
    throw new MfeflowError('E107', '--org is for --topology polyrepo or --kind tooling');
  }
  return {
    kind,
    topology,
    ...(org === undefined ? {} : { org }),
    dir,
    scope,
    remotes,
    features,
    packages: packageChoice.packages,
    packageNotices: packageChoice.notices,
    featureOptions,
  };
}

export async function assertEmpty(
  root: string,
  readdir: (dir: string) => Promise<string[]> = fs.readdir,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    if (hasErrno(error, 'ENOENT')) return;
    if (hasErrno(error, 'ENOTDIR')) {
      throw new MfeflowError('E108', `${root} is not a folder, or part of its path is a file`, {
        cause: error,
      });
    }
    throw new MfeflowError('E106', `could not look inside ${root} (${messageOf(error)})`, {
      cause: error,
    });
  }
  if (entries.length > 0) {
    const shown = entries.slice(0, 3).join(', ');
    throw new MfeflowError(
      'E108',
      `${root} already has ${shown}${entries.length > 3 ? ', …' : ''}`,
    );
  }
}

export function skeleton(options: InitOptions): MfeflowProject {
  const apps: MfeflowProject['apps'] = {
    shell: { kind: 'shell', path: 'apps/shell', port: SHELL_PORT },
  };
  options.remotes.forEach((name, index) => {
    apps[name] = { kind: 'remote', path: `apps/${name}`, port: REMOTE_PORT + index };
  });
  return {
    version: 1,
    topology: 'monorepo',
    packageManager: 'pnpm',
    scope: options.scope,
    apps,
    features: {},
  };
}

export async function runInit(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<InitResult> {
  assertKnownFlags(raw, INIT_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const preset = globals.preset
    ? await loadPreset(globals.preset, { cwd: globals.cwd, fetch: rt.fetch })
    : {};
  const options = await resolveInitOptions(rt, globals, args, raw, preset);
  const root = path.resolve(globals.cwd, options.dir);
  await assertEmpty(root);
  if (options.kind === 'tooling') return runToolingInit(rt, globals, options, root);
  if (options.topology === 'polyrepo') return runPolyrepoInit(rt, globals, options, root);

  const chosen = chooseLocal(skeleton(options), root, globals.cwd, globals.local);
  const { project } = chosen;
  const builder = createBuilder(root, chosen.checkout);
  const names = ['core', 'tsconfig', ...options.features];
  assertOptionsAreForFeatures(options.featureOptions, names);
  const loaded: LoadedFeature[] = await Promise.all(
    names.map((name) => loadAny(name, { roots: rt.roots })),
  );
  await inOrder(loaded, (feature) =>
    resolveFeature({
      feature,
      project,
      builder,
      options: options.featureOptions[feature.manifest.name] ?? {},
      alsoAdding: names,
    }),
  );
  const core = loaded[0];
  await inOrder(options.remotes, async (remote) => {
    const port = project.apps[remote]?.port;
    if (core === undefined || port === undefined) return;
    await resolveFeature({
      feature: await remoteGlue({
        roots: rt.roots,
        version: core.manifest.version,
        remote: { name: remote, port },
        registry: true,
        shells: ['shell'],
      }),
      project,
      builder,
      alsoAdding: names,
    });
  });
  const plan = builder.build();

  const outcome = await writePlan({
    rt,
    globals,
    root,
    plan,
    project,
    afterWrite: async () => {
      if (options.features.includes('git-hooks')) await rt.system.gitInit(root);
    },
  });

  const next = [
    ...(path.resolve(globals.cwd) === root ? [] : [`cd ${options.dir}`]),
    ...(outcome.installed || outcome.dryRun ? [] : ['pnpm install']),
    'pnpm dev',
  ];
  const result: InitResult = {
    ok: true,
    command: 'init',
    dryRun: outcome.dryRun,
    root,
    scope: options.scope,
    apps: Object.entries(project.apps).map(([name, app]) => ({
      name,
      kind: app.kind,
      path: app.path,
      port: app.port ?? null,
    })),
    plan: planReport(outcome.shown),
    written: outcome.written,
    installed: outcome.installed,
    next,
    ...(outcome.diff === undefined ? {} : { diff: outcome.diff }),
  };
  if (!globals.json) printInit(rt, result);
  return result;
}

/** A repo of shared tooling: the polyrepo platform repo, made on its own with `topology: monorepo`. */
async function runToolingInit(
  rt: Runtime,
  globals: Globals,
  options: InitOptions,
  root: string,
): Promise<InitResult> {
  const request: RepoRequest = {
    kind: 'platform',
    standalone: true,
    dir: path.basename(root),
    root,
    scope: options.scope,
    ...(options.org === undefined ? {} : { org: options.org }),
    features: options.features,
    packages: options.packages,
    featureOptions: options.featureOptions,
    local: globals.local,
    cwd: globals.cwd,
  };
  const repo = await planRepo(rt, request);
  repo.plan.warnings.push(...options.packageNotices);
  const { writes, notRepos } = await writeRepos(rt, globals, root, [repo], false);
  const outcome = writes[0]?.outcome;
  if (outcome === undefined) throw new MfeflowError('E106', `nothing was written to ${root}`);
  const result: InitResult = {
    ok: true,
    command: 'init',
    dryRun: outcome.dryRun,
    root,
    scope: options.scope,
    apps: [],
    plan: withWarnings(planReport(outcome.shown), notReposWarning(notRepos)),
    written: outcome.written,
    installed: outcome.installed,
    next: [
      ...(path.resolve(globals.cwd) === root ? [] : [`cd ${options.dir}`]),
      ...(outcome.installed || outcome.dryRun ? [] : ['pnpm install']),
      'pnpm build',
    ],
    ...(outcome.diff === undefined ? {} : { diff: outcome.diff }),
  };
  if (!globals.json) printInit(rt, result);
  return result;
}

/** A polyrepo: a platform repo, a shell repo and one repo per remote, side by side in `org`. */
async function runPolyrepoInit(
  rt: Runtime,
  globals: Globals,
  options: InitOptions,
  org: string,
): Promise<InitResult> {
  const remotes = remotePorts(options.remotes);
  if (options.remotes.includes(PLATFORM_DIR)) {
    throw new MfeflowError('E215', `"${PLATFORM_DIR}" is a reserved name in a polyrepo`);
  }
  const base = {
    scope: options.scope,
    ...(options.org === undefined ? {} : { org: options.org }),
    features: options.features,
    featureOptions: options.featureOptions,
    local: globals.local,
    cwd: globals.cwd,
  };
  const requests: RepoRequest[] = [
    { ...base, kind: 'platform', dir: PLATFORM_DIR, root: path.join(org, PLATFORM_DIR) },
    {
      ...base,
      kind: 'shell',
      dir: SHELL_DIR,
      root: path.join(org, SHELL_DIR),
      shellRemotes: remotes,
    },
    ...remotes.map((remote): RepoRequest => ({
      scope: base.scope,
      org: options.org,
      features: base.features,
      featureOptions: base.featureOptions,
      local: base.local,
      cwd: base.cwd,
      kind: 'remote',
      dir: remote.name,
      root: path.join(org, remote.name),
      remote,
    })),
  ];
  const plans: RepoPlan[] = await Promise.all(requests.map((request) => planRepo(rt, request)));
  if (globals.canPrompt) {
    rt.io.stdout(`${options.dir}/\n${requests.map((r) => `  ${r.dir}/`).join('\n')}`);
    const ok = await rt.prompter.confirm({
      message: `Create these ${String(requests.length)} repos?`,
    });
    if (!ok) throw new Cancelled();
  }
  const { writes: written, notRepos } = await writeRepos(rt, globals, org, plans);
  const dryRun = written.every((w) => w.outcome.dryRun);
  const installed = !dryRun && written.every((w) => w.outcome.installed);
  const dirs = requests.map((r) => r.dir);
  const result: InitResult = {
    ok: true,
    command: 'init',
    dryRun,
    root: org,
    scope: options.scope,
    apps: written.flatMap(({ repo }) =>
      Object.entries(repo.project.apps).map(([name, app]) => ({
        name,
        kind: app.kind,
        path: `${repo.request.dir}/${app.path}`,
        port: app.port ?? null,
      })),
    ),
    plan: withWarnings(
      mergeReports(
        written.map(({ repo, outcome }) =>
          prefixReport(planReport(outcome.shown), repo.request.dir),
        ),
      ),
      notReposWarning(notRepos),
    ),
    written: written.flatMap(({ repo, outcome }) =>
      outcome.written.map((file) => `${repo.request.dir}/${file}`),
    ),
    installed,
    repos: written.map(({ repo, outcome }) => ({
      name: repo.request.dir,
      repo: repo.request.kind,
      root: repo.request.root,
      written: outcome.written,
      installed: outcome.installed,
    })),
    next: [
      ...(path.resolve(globals.cwd) === org ? [] : [`cd ${options.dir}`]),
      ...(installed || dryRun ? [] : dirs.map((dir) => `pnpm -C ${dir} install`)),
      `pnpm -C ${PLATFORM_DIR} build`,
      `pnpm -C ${SHELL_DIR} dev`,
      ...options.remotes.map((remote) => `pnpm -C ${remote} dev   # in its own terminal`),
    ],
    ...(dryRun ? { diff: written.map((w) => w.outcome.diff ?? '').join('\n') } : {}),
  };
  if (!globals.json) printInit(rt, result, options.org ?? options.scope.slice(1));
  return result;
}

function withWarnings(plan: PlanReport, warnings: readonly string[]): PlanReport {
  return { ...plan, warnings: [...plan.warnings, ...warnings] };
}

function printInit(rt: Runtime, result: InitResult, org?: string): void {
  if (result.dryRun) {
    rt.io.stdout('\nDry run: nothing was written.');
    return;
  }
  if (result.repos !== undefined) {
    const names = result.repos.map((repo) => repo.name);
    const problem = result.plan.warnings.find((w) => w.includes('not a git repo'));
    rt.io.stdout(
      `\nCreated ${result.root} with ${String(names.length)} repos (${names.join(', ')})${problem === undefined ? ', each with its own git repo' : ''}.`,
    );
    if (problem !== undefined) rt.io.stdout(`Warning: ${problem}`);
    rt.io.stdout(`CI calls ${org ?? ''}/platform's reusable workflow; check the owner.`);
    rt.io.stdout(`Next:\n${result.next.map((line) => `  ${line}`).join('\n')}`);
    return;
  }
  const remotes = result.apps.filter((a) => a.kind === 'remote').map((a) => a.name);
  if (result.apps.length === 0) {
    rt.io.stdout(`\nCreated ${result.root}, a repo for shared tooling with no apps.`);
    rt.io.stdout(`Next:\n${result.next.map((line) => `  ${line}`).join('\n')}`);
    return;
  }
  if (remotes.length === 0) {
    rt.io.stdout(`\nCreated ${result.root} with only a shell.`);
    rt.io.stdout(`Next:\n${result.next.map((line) => `  ${line}`).join('\n')}`);
    rt.io.stdout('Add a remote later with `mfeflow add remote <name>`.');
    return;
  }
  rt.io.stdout(
    `\nCreated ${result.root} with a shell and ${String(remotes.length)} remote${remotes.length === 1 ? '' : 's'} (${remotes.join(', ')}).`,
  );
  rt.io.stdout(`Next:\n${result.next.map((line) => `  ${line}`).join('\n')}`);
}
