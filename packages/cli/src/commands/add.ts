import {
  findProjectRoot,
  inOrder,
  loadProject,
  MfeflowError,
  resolveFeature,
  resolveOptions,
  type LoadedFeature,
  type MfeflowProject,
  type Plan,
  type PlanBuilder,
} from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, repeated, type Globals } from '../args';
import { loadAny, OPTIONAL_FEATURES } from '../catalog';
import { assertAppName, freePort, partsForApp, remoteGlue, REMOTE_PORT, SHELL_PORT } from '../glue';
import { mergeOptions, parseFeatureOptions, type FeatureOptions } from '../options';
import { planReport, type AddResult } from '../output';
import { createBuilder } from '../pipeline';
import { loadPreset } from '../preset';
import type { Runtime } from '../runtime';
import { writePlan } from '../write';

export const ADD_ARGS = {
  port: {
    type: 'string',
    description: 'Dev server port for a new app (default: the next free one)',
    valueHint: 'n',
  },
  option: {
    type: 'string',
    description: 'A feature option, repeatable: --option feature.key=value',
    valueHint: 'f.k=v',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

function portFor(args: Record<string, unknown>, project: MfeflowProject, start: number): number {
  const given = args.port;
  if (typeof given !== 'string' || given === '') return freePort(project, start);
  const port = Number(given);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MfeflowError('E107', `--port "${given}" must be a whole number from 1 to 65535`);
  }
  const owner = Object.entries(project.apps).find(([, app]) => app.port === port);
  if (owner) throw new MfeflowError('E107', `--port ${given} is already used by ${owner[0]}`);
  return port;
}

async function nameFrom(
  rt: Runtime,
  globals: Globals,
  given: string | undefined,
  what: string,
): Promise<string> {
  if (given !== undefined) return given;
  if (rt.io.interactive && !globals.yes && !globals.json) {
    return rt.prompter.text({ message: `Name of the new ${what}` });
  }
  throw new MfeflowError('E107', `add ${what} needs a name: mfeflow add ${what} <name>`);
}

/** What a new app of `kind` gets: the app-level parts of `core` and of every feature already installed. */
async function addAppParts(
  rt: Runtime,
  builder: PlanBuilder,
  project: MfeflowProject,
  next: MfeflowProject,
  kind: 'shell' | 'remotes',
  name: string,
): Promise<LoadedFeature> {
  const names = ['core', ...Object.keys(project.features).filter((n) => n !== 'core')];
  let core: LoadedFeature | undefined;
  await inOrder(names, async (feature) => {
    const loaded = await loadAny(feature, {
      roots: rt.roots,
      registries: project.registries,
      fetch: rt.fetch,
    });
    if (feature === 'core') core = loaded;
    const parts = partsForApp(loaded, kind, name);
    if (!parts) return;
    await resolveFeature({
      feature: parts,
      project: next,
      builder,
      options: project.features[feature]?.options ?? {},
    });
  });
  if (core === undefined) throw new MfeflowError('E201', 'core');
  return core;
}

async function addApp(
  rt: Runtime,
  globals: Globals,
  args: Record<string, unknown>,
  kind: 'remote' | 'shell',
  given: string | undefined,
): Promise<AddResult> {
  const root = await findProjectRoot(globals.cwd);
  const project = await loadProject(root);
  const name = await nameFrom(rt, globals, given, kind);
  assertAppName(name, project.apps);
  const port = portFor(args, project, kind === 'remote' ? REMOTE_PORT : SHELL_PORT);
  const next: MfeflowProject = {
    ...project,
    apps: { ...project.apps, [name]: { kind, path: `apps/${name}`, port } },
  };
  const builder = createBuilder(root, globals.local, globals.cwd);
  const core = await addAppParts(
    rt,
    builder,
    project,
    next,
    kind === 'remote' ? 'remotes' : 'shell',
    name,
  );
  const version = core.manifest.version;
  if (kind === 'remote') {
    await resolveFeature({
      feature: await remoteGlue({
        roots: rt.roots,
        version,
        remote: { name, port },
        registry: true,
        shells: ['shell'],
      }),
      project: next,
      builder,
    });
  } else {
    await inOrder(Object.entries(project.apps), async ([remote, app]) => {
      if (app.kind !== 'remote' || app.port === undefined) return;
      await resolveFeature({
        feature: await remoteGlue({
          roots: rt.roots,
          version,
          remote: { name: remote, port: app.port },
          registry: false,
          shells: [name],
        }),
        project: next,
        builder,
      });
    });
  }
  // Adding an app does not change which features are installed, or at what version.
  const plan: Plan = { ...builder.build(), features: [] };
  const outcome = await writePlan({ rt, globals, root, plan, project: next });
  return finish(rt, globals, root, kind, [name], [], outcome);
}

function finish(
  rt: Runtime,
  globals: Globals,
  root: string,
  kind: AddResult['kind'],
  added: string[],
  skipped: string[],
  outcome: Awaited<ReturnType<typeof writePlan>>,
): AddResult {
  const result: AddResult = {
    ok: true,
    command: 'add',
    kind,
    dryRun: outcome.dryRun,
    root,
    added,
    skipped,
    plan: planReport(outcome.shown),
    written: outcome.written,
    installed: outcome.installed,
    ...(outcome.diff === undefined ? {} : { diff: outcome.diff }),
  };
  if (!globals.json) {
    if (outcome.dryRun) rt.io.stdout('\nDry run: nothing was written.');
    else rt.io.stdout(`\nAdded ${added.join(', ')}${kind === 'feature' ? '' : ` (${kind})`}.`);
  }
  return result;
}

/** Fills in the feature's prompts that no flag or preset answered, when a person is there to ask. */
async function askOptions(
  rt: Runtime,
  feature: LoadedFeature,
  given: Record<string, unknown>,
  canPrompt: boolean,
): Promise<Record<string, unknown>> {
  const answers = { ...given };
  if (!canPrompt) return answers;
  await inOrder(feature.manifest.prompts ?? [], async (prompt) => {
    if (prompt.name in answers) return;
    const message = prompt.message ?? prompt.name;
    const initial = typeof prompt.default === 'string' ? { initialValue: prompt.default } : {};
    if (prompt.type === 'boolean') {
      answers[prompt.name] = await rt.prompter.confirm({
        message,
        initialValue: prompt.default === true,
      });
    } else if (prompt.type === 'select') {
      answers[prompt.name] = await rt.prompter.select({
        message,
        choices: (prompt.choices ?? []).map((c) => ({ value: c, label: c })),
        ...initial,
      });
    } else {
      answers[prompt.name] = await rt.prompter.text({ message, ...initial });
    }
  });
  return answers;
}

async function addFeatures(
  rt: Runtime,
  globals: Globals,
  requested: string[],
  options: FeatureOptions,
): Promise<AddResult> {
  const root = await findProjectRoot(globals.cwd);
  const project = await loadProject(root);
  const canPrompt = rt.io.interactive && !globals.yes && !globals.json;
  let names = [...new Set(requested)];
  if (names.length === 0 && canPrompt) {
    const choices = OPTIONAL_FEATURES.filter((n) => !(n in project.features));
    names = await rt.prompter.multiselect({
      message: 'Add which features?',
      choices: choices.map((value) => ({ value, label: value })),
      initialValues: [],
    });
  }
  if (names.length === 0) {
    throw new MfeflowError(
      'E107',
      'add needs a feature: mfeflow add <feature...>, or `mfeflow features` to list them',
    );
  }
  const skipped = names.filter((n) => n in project.features);
  const adding = names.filter((n) => !(n in project.features));
  if (adding.length === 0) {
    if (!globals.json) rt.io.stdout(`${skipped.join(', ')} already added; nothing to do.`);
    return {
      ok: true,
      command: 'add',
      kind: 'feature',
      dryRun: globals.dryRun,
      root,
      added: [],
      skipped,
      plan: planReport({
        version: 1,
        features: [],
        changes: [],
        dependencies: [],
        scripts: [],
        env: [],
        warnings: [],
      }),
      written: [],
      installed: false,
      ...(globals.dryRun ? { diff: '' } : {}),
    };
  }

  const loaded = await Promise.all(
    adding.map((name) =>
      loadAny(name, { roots: rt.roots, registries: project.registries, fetch: rt.fetch }),
    ),
  );
  const thirdParty = loaded.filter((f) => f.trust === 'third-party').map((f) => f.manifest.name);
  if (thirdParty.length > 0 && !globals.yes && !canPrompt) {
    throw new MfeflowError(
      'E107',
      `${thirdParty.join(', ')} comes from a registry; pass --yes to apply it without a terminal to confirm in`,
    );
  }
  const builder = createBuilder(root, globals.local, globals.cwd);
  await inOrder(loaded, async (feature) => {
    const given = await askOptions(rt, feature, options[feature.manifest.name] ?? {}, canPrompt);
    resolveOptions(feature.manifest, given);
    await resolveFeature({ feature, project, builder, options: given, alsoAdding: adding });
  });
  const plan = builder.build();
  const outcome = await writePlan({ rt, globals, root, plan, project });
  return finish(rt, globals, root, 'feature', adding, skipped, outcome);
}

export async function runAdd(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<AddResult> {
  assertKnownFlags(raw, ADD_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const positional = Array.isArray(args._) ? args._.map(String) : [];
  const [first, ...rest] = positional;
  if (first === 'remote' || first === 'shell') return addApp(rt, globals, args, first, rest[0]);
  const preset = globals.preset
    ? await loadPreset(globals.preset, { cwd: globals.cwd, fetch: rt.fetch })
    : {};
  const options = mergeOptions(preset.options ?? {}, parseFeatureOptions(repeated(raw, 'option')));
  return addFeatures(rt, globals, positional, options);
}
