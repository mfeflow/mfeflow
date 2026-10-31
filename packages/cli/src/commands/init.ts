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
import { mergeOptions, parseFeatureOptions, type FeatureOptions } from '../options';
import { planReport, type InitResult } from '../output';
import { chooseLocal } from '../local';
import { createBuilder } from '../pipeline';
import { loadPreset, type Preset } from '../preset';
import type { Runtime } from '../runtime';
import { writePlan } from '../write';
import type { ArgsDef } from 'citty';

export const INIT_ARGS = {
  dir: {
    type: 'positional',
    required: false,
    description: 'Folder to create (default mfeflow-app)',
  },
  scope: {
    type: 'string',
    description: 'npm scope for the project packages, like @my-org',
    valueHint: '@scope',
  },
  remotes: {
    type: 'string',
    description: 'Remotes to create, comma separated (default catalog,cart)',
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
    description: 'monorepo (the only one in this release)',
    valueHint: 'name',
  },
  option: {
    type: 'string',
    description: 'A feature option, repeatable: --option feature.key=value',
    valueHint: 'f.k=v',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

const DEFAULT_DIR = 'mfeflow-app';
const DEFAULT_REMOTES = ['catalog', 'cart'];
const SCOPE = /^@[a-z0-9][a-z0-9-._]*$/;

export interface InitOptions {
  dir: string;
  scope: string;
  remotes: string[];
  features: string[];
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

/** Flags win over the preset, the preset over prompts, prompts over defaults. */
export async function resolveInitOptions(
  rt: Runtime,
  globals: Globals,
  args: Record<string, unknown>,
  raw: readonly string[],
  preset: Preset,
): Promise<InitOptions> {
  const flag = (key: string): string | undefined => {
    const value = args[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };
  only('package-manager', flag('package-manager') ?? preset.packageManager, 'pnpm');
  only('topology', flag('topology') ?? preset.topology, 'monorepo');
  const canPrompt = rt.io.interactive && !globals.yes && !globals.json;
  const { prompter } = rt;

  const given = typeof args.dir === 'string' && args.dir !== '' ? args.dir : undefined;
  const dir =
    given ??
    (canPrompt
      ? await prompter.text({ message: 'Where should the project go?', initialValue: DEFAULT_DIR })
      : DEFAULT_DIR);

  const scopeFlag = flag('scope') ?? preset.scope;
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

  const remotesFlag = splitList(flag('remotes')) ?? preset.remotes;
  const remotes =
    remotesFlag ??
    (canPrompt
      ? (splitList(
          await prompter.text({
            message: 'Remotes, comma separated',
            initialValue: DEFAULT_REMOTES.join(','),
          }),
        ) ?? [])
      : DEFAULT_REMOTES);
  checkRemotes(remotes);

  const featuresFlag = splitList(flag('features')) ?? preset.features;
  const features = checkFeatures(
    featuresFlag ??
      (canPrompt
        ? await prompter.multiselect({
            message: 'Features',
            choices: OPTIONAL_FEATURES.map((name) => ({ value: name, label: name })),
            initialValues: DEFAULT_FEATURES,
          })
        : DEFAULT_FEATURES),
  );

  const featureOptions = mergeOptions(
    preset.options ?? {},
    parseFeatureOptions(repeated(raw, 'option')),
  );
  return { dir, scope, remotes, features, featureOptions };
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
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const preset = globals.preset
    ? await loadPreset(globals.preset, { cwd: globals.cwd, fetch: rt.fetch })
    : {};
  const options = await resolveInitOptions(rt, globals, args, raw, preset);
  const root = path.resolve(globals.cwd, options.dir);
  await assertEmpty(root);

  const chosen = chooseLocal(skeleton(options), root, globals.cwd, globals.local);
  const { project } = chosen;
  const builder = createBuilder(root, chosen.checkout);
  const names = ['core', 'tsconfig', ...options.features];
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

function printInit(rt: Runtime, result: InitResult): void {
  if (result.dryRun) {
    rt.io.stdout('\nDry run: nothing was written.');
    return;
  }
  const remotes = result.apps.filter((a) => a.kind === 'remote').map((a) => a.name);
  rt.io.stdout(
    `\nCreated ${result.root} with a shell and ${String(remotes.length)} remote${remotes.length === 1 ? '' : 's'} (${remotes.join(', ')}).`,
  );
  rt.io.stdout(`Next:\n${result.next.map((line) => `  ${line}`).join('\n')}`);
}
