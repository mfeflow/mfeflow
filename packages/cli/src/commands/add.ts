import {
  checkIntegrity,
  findProjectRoot,
  inOrder,
  loadProject,
  MfeflowError,
  resolveFeature,
  type LoadedFeature,
  type MfeflowProject,
  type Plan,
  type PlanBuilder,
} from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, repeated, text, type Globals } from '../args';
import { inCatalogueOrder, loadAny, OPTIONAL_FEATURES } from '../catalog';
import {
  assertAppName,
  nameFrom,
  partsForApp,
  portFor,
  remoteGlue,
  REMOTE_PORT,
  SHELL_PORT,
} from '../glue';
import {
  assertOptionsAreForFeatures,
  mergeOptions,
  parseFeatureOptions,
  type FeatureOptions,
} from '../options';
import { planReport, type AddResult } from '../output';
import { addEnvKey } from './env-key';
import { addTeamRepo } from './team-repo';
import { chooseLocal } from '../local';
import { createBuilder } from '../pipeline';
import { loadPreset } from '../preset';
import type { Runtime } from '../runtime';
import { trustedIn } from '../trust';
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
  scope: {
    type: 'string',
    description: 'add env-key: server (env.ts, .env.example) or runtime (runtime-config files)',
    valueHint: 'server|runtime',
  },
  schema: {
    type: 'string',
    description: 'add env-key: the validator expression, like "z.url()"',
    valueHint: 'expr',
  },
  value: {
    type: 'string',
    description: 'add env-key: the placeholder written to .env.example or the config files',
    valueHint: 'text',
  },
  app: {
    type: 'string',
    description: 'add env-key: exactly this app (default: every app; runtime: every shell)',
    valueHint: 'name',
  },
  group: {
    type: 'string',
    description: 'add env-key: root, every shell or every remote, instead of --app',
    valueHint: 'root|shell|remotes',
  },
  'accept-changed-content': {
    type: 'boolean',
    description:
      'Take a registry feature whose content differs from the hash recorded in mfeflow.json',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

/**
 * What a new app of `kind` gets: the app-level parts of `core` and of every feature already
 * installed. A registry feature is fetched at the version the project recorded, and applied
 * only past the same gate as `add <feature>`; if the registry no longer serves that version
 * nothing is written. The registry must be trusted, and the bytes must match the hash recorded
 * when the feature was added (E406), unless `acceptChanged`: then `next` records the new hash.
 */
async function addAppParts(
  rt: Runtime,
  globals: Globals,
  builder: PlanBuilder,
  project: MfeflowProject,
  next: MfeflowProject,
  kind: 'shell' | 'remotes',
  name: string,
  acceptChanged: boolean,
): Promise<LoadedFeature> {
  const names = ['core', ...Object.keys(project.features).filter((n) => n !== 'core')];
  const { canPrompt } = globals;
  const trusted = await trustedIn(rt, project.registries);
  const untrusted = [
    ...new Set(
      names
        .filter((n) => n.startsWith('@'))
        .map((n) => n.slice(0, n.indexOf('/')))
        .filter((ns) => ns in (project.registries ?? {}) && !trusted.fetch.has(ns)),
    ),
  ];
  if (untrusted.length > 0) {
    throw new MfeflowError(
      'E405',
      `${untrusted.join(', ')} is installed here but not trusted on this machine, so it was not requested`,
    );
  }
  const loadedAll = await Promise.all(
    names.map((feature) =>
      loadAny(feature, {
        roots: rt.roots,
        registries: project.registries,
        fetch: rt.fetch,
        version: project.features[feature]?.version,
        trusted: trusted.privateOk,
      }),
    ),
  );
  let core: LoadedFeature | undefined;
  const fromRegistry: string[] = [];
  const planned: { feature: string; parts: LoadedFeature }[] = [];
  names.forEach((feature, index) => {
    const loaded = loadedAll[index];
    if (loaded === undefined) return;
    if (feature === 'core') core = loaded;
    const recorded = project.features[feature]?.version;
    const parts = partsForApp(loaded, kind, name);
    if (!parts) return;
    if (loaded.trust === 'third-party') {
      if (recorded !== undefined && loaded.manifest.version !== recorded) {
        throw new MfeflowError(
          'E401',
          `${feature} is installed at ${recorded} but the registry now serves ${loaded.manifest.version}`,
          {
            fix: `Nothing was written. Use a registry URL with {version} so ${recorded} can be fetched, or add the app by hand.`,
          },
        );
      }
      fromRegistry.push(feature);
      const entry = next.features[feature];
      const now = loaded.integrity;
      if (entry !== undefined && now !== undefined) {
        if (entry.integrity === undefined) {
          if (!globals.json) {
            rt.io.stdout(`${feature} has no integrity hash in mfeflow.json; recording one now.`);
          }
          next.features[feature] = { ...entry, integrity: now };
        } else if (checkIntegrity(feature, entry.integrity, now, acceptChanged)) {
          next.features[feature] = { ...entry, integrity: now };
        }
      }
    }
    planned.push({ feature, parts });
  });
  assertThirdPartyAllowed(fromRegistry, globals, canPrompt);
  await inOrder(planned, ({ feature, parts }) =>
    resolveFeature({
      feature: parts,
      project: next,
      builder,
      options: project.features[feature]?.options ?? {},
    }),
  );
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
  const chosen = chooseLocal(await loadProject(root), root, globals.cwd, text(args, 'local'));
  const { project } = chosen;
  const name = await nameFrom(rt, globals, given, kind);
  assertAppName(name, project.apps);
  const port = portFor(args, project, kind === 'remote' ? REMOTE_PORT : SHELL_PORT);
  const next: MfeflowProject = {
    ...project,
    apps: { ...project.apps, [name]: { kind, path: `apps/${name}`, port } },
    features: { ...project.features },
  };
  const builder = createBuilder(root, chosen.checkout);
  const core = await addAppParts(
    rt,
    globals,
    builder,
    project,
    next,
    kind === 'remote' ? 'remotes' : 'shell',
    name,
    args['accept-changed-content'] === true,
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

/** A feature from a registry is code nobody here wrote: writing it needs a person's yes, or --yes. */
function assertThirdPartyAllowed(names: readonly string[], globals: Globals, canPrompt: boolean) {
  if (names.length > 0 && !globals.yes && !canPrompt && !globals.dryRun) {
    throw new MfeflowError(
      'E107',
      `${names.join(', ')} comes from a registry; pass --yes to apply it without a terminal to confirm in`,
    );
  }
}

async function addFeatures(
  rt: Runtime,
  globals: Globals,
  local: string | undefined,
  requested: string[],
  options: FeatureOptions,
): Promise<AddResult> {
  const root = await findProjectRoot(globals.cwd);
  const chosen = chooseLocal(await loadProject(root), root, globals.cwd, local);
  const { project } = chosen;
  const { canPrompt } = globals;
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
  const adding = inCatalogueOrder(names.filter((n) => !(n in project.features)));
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

  assertOptionsAreForFeatures(options, adding);
  const trusted = await trustedIn(rt, project.registries);
  const loaded = await Promise.all(
    adding.map((name) =>
      loadAny(name, {
        roots: rt.roots,
        registries: project.registries,
        fetch: rt.fetch,
        trusted: trusted.privateOk,
        checkIndex: true,
      }),
    ),
  );
  const thirdParty = loaded.filter((f) => f.trust === 'third-party').map((f) => f.manifest.name);
  assertThirdPartyAllowed(thirdParty, globals, canPrompt);
  const builder = createBuilder(root, chosen.checkout);
  await inOrder(loaded, async (feature) => {
    const given = await askOptions(rt, feature, options[feature.manifest.name] ?? {}, canPrompt);
    await resolveFeature({ feature, project, builder, options: given, alsoAdding: adding });
  });
  const plan = builder.build();
  const outcome = await writePlan({
    rt,
    globals,
    root,
    plan,
    project,
    afterWrite: async () => {
      if (adding.includes('git-hooks')) await rt.system.gitInit(root);
    },
  });
  return finish(rt, globals, root, 'feature', adding, skipped, outcome);
}

export async function runAdd(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<AddResult> {
  assertKnownFlags(raw, ADD_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const positional = Array.isArray(args._) ? args._.map(String) : [];
  const [first, ...rest] = positional;
  if (first === 'remote' || first === 'shell') return addApp(rt, globals, args, first, rest[0]);
  if (first === 'env-key') return addEnvKey(rt, globals, args, rest[0]);
  if (first === 'team-repo') return addTeamRepo(rt, globals, args, rest[0]);
  const preset = globals.preset
    ? await loadPreset(globals.preset, { cwd: globals.cwd, fetch: rt.fetch })
    : {};
  const options = mergeOptions(preset.options ?? {}, parseFeatureOptions(repeated(raw, 'option')));
  return addFeatures(rt, globals, text(args, 'local'), positional, options);
}
