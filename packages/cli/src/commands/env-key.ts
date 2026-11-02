import path from 'node:path';
import { ENV_KEY_NAME, type AddEnvKeyOp, type TransformOp } from '@mfeflow/contracts';
import {
  findProjectRoot,
  loadProject,
  MfeflowError,
  recordEnvKey,
  resolveFeature,
  runtimeConfigFiles,
  type MfeflowProject,
} from '@mfeflow/core';
import { text, type Globals } from '../args';
import { chooseLocal } from '../local';
import { planReport, type AddResult } from '../output';
import { createBuilder } from '../pipeline';
import type { Runtime } from '../runtime';
import { writePlan } from '../write';

const GROUPS = ['root', 'shell', 'remotes'] as const;
type Group = (typeof GROUPS)[number];

function groupOf(value: string | undefined): Group | undefined {
  if (value === undefined) return undefined;
  const group = GROUPS.find((g) => g === value);
  if (group === undefined) {
    throw new MfeflowError('E107', '--group must be root, shell or remotes');
  }
  return group;
}

/** `app:<name>` names one app exactly, so an app called `shell` is not the group of shells. */
const exactApp = (name: string) => `app:${name}`;

/** Where a server key goes: `--app` names one app, `--group` root, the shells or the remotes; by default every app. */
function serverTargets(
  project: MfeflowProject,
  app: string | undefined,
  group: Group | undefined,
): string[] {
  if (app !== undefined) {
    if (!(app in project.apps)) {
      throw new MfeflowError(
        'E107',
        `--app ${app} is not an app (${Object.keys(project.apps).join(', ')})`,
      );
    }
    return [exactApp(app)];
  }
  const kinds = new Set(Object.values(project.apps).map((a) => a.kind));
  if (group === undefined) {
    const targets = [
      ...(kinds.has('shell') ? ['shell'] : []),
      ...(kinds.has('remote') ? ['remotes'] : []),
    ];
    if (targets.length === 0)
      throw new MfeflowError('E107', 'the project has no app to add a key to');
    return targets;
  }
  if (group === 'shell' && !kinds.has('shell')) {
    throw new MfeflowError('E107', 'the project has no shell to add a key to');
  }
  if (group === 'remotes' && !kinds.has('remote')) {
    throw new MfeflowError('E107', 'the project has no remotes to add a key to');
  }
  return [group];
}

/** Runtime config belongs to a shell, which serves /config/runtime-config.json. */
function runtimeTargets(
  project: MfeflowProject,
  app: string | undefined,
  group: Group | undefined,
): Array<{ target: string; path: string }> {
  const shells = Object.entries(project.apps)
    .filter(([, a]) => a.kind === 'shell')
    .map(([name, a]) => ({ name, path: a.path }));
  if (app !== undefined) {
    const shell = shells.find((s) => s.name === app);
    if (shell === undefined) {
      throw new MfeflowError(
        'E107',
        `--app ${app} is not a shell; runtime config lives in a shell (${shells.map((s) => s.name).join(', ')})`,
      );
    }
    return [{ target: exactApp(app), path: shell.path }];
  }
  if (group !== undefined && group !== 'shell') {
    throw new MfeflowError('E107', `--group ${group} has no runtime config; it lives in a shell`);
  }
  return shells.map((s) => ({ target: exactApp(s.name), path: s.path }));
}

async function configFilesOf(root: string, dir: string): Promise<string[]> {
  const folder = path.join(root, ...dir.split('/'), 'public', 'config');
  return (await runtimeConfigFiles(folder)).map((name) => `public/config/${name}`);
}

interface OpInput {
  target: string;
  key: string;
  scope: 'server' | 'runtime';
  schema: string;
  value: string | undefined;
  configFiles: string[];
}

function envKeyOp(input: OpInput): TransformOp {
  const { target, key, scope, schema, value, configFiles } = input;
  const op: AddEnvKeyOp = {
    op: 'add-env-key',
    file: scope === 'server' ? 'env.ts' : 'src/config/schema.ts',
    target,
    key,
    scope,
    schema,
  };
  if (value !== undefined) op.value = value;
  if (scope === 'runtime') op.configFiles = configFiles;
  return op;
}

export async function addEnvKey(
  rt: Runtime,
  globals: Globals,
  args: Record<string, unknown>,
  key: string | undefined,
): Promise<AddResult> {
  const scope = text(args, 'scope');
  const schema = text(args, 'schema');
  if (key === undefined || !ENV_KEY_NAME.test(key)) {
    throw new MfeflowError(
      'E107',
      'add env-key needs a key like API_ORIGIN: mfeflow add env-key <KEY>',
    );
  }
  if (scope !== 'server' && scope !== 'runtime') {
    throw new MfeflowError('E107', '--scope must be server or runtime');
  }
  if (schema === undefined) {
    throw new MfeflowError('E107', '--schema is required, for example --schema "z.url()"');
  }
  const root = await findProjectRoot(globals.cwd);
  const chosen = chooseLocal(await loadProject(root), root, globals.cwd, text(args, 'local'));
  const { project } = chosen;
  const installed = project.features['env-t3'];
  if (installed === undefined) {
    throw new MfeflowError('E206', 'add env-key needs env-t3; run `mfeflow add env-t3` first');
  }
  const value = text(args, 'value');
  const app = text(args, 'app');
  const group = groupOf(text(args, 'group'));
  if (app !== undefined && group !== undefined) {
    throw new MfeflowError('E107', '--app and --group cannot be used together');
  }
  const targets =
    scope === 'server'
      ? serverTargets(project, app, group).map((target) => ({ target, path: '' }))
      : runtimeTargets(project, app, group);
  const transforms = await Promise.all(
    targets.map(async ({ target, path: dir }) =>
      envKeyOp({
        target,
        key,
        scope,
        schema,
        value,
        configFiles: scope === 'runtime' ? await configFilesOf(root, dir) : [],
      }),
    ),
  );
  const builder = createBuilder(root, chosen.checkout);
  await resolveFeature({
    feature: {
      manifest: { name: 'env-t3', version: installed.version, transforms },
      trust: 'first-party',
    },
    project,
    builder,
  });
  const plan = { ...builder.build(), features: [] };
  const recorded = recordEnvKey(
    project,
    plan.changes.map((change) => change.path),
    key,
  );
  const outcome = await writePlan({
    rt,
    globals: { ...globals, install: false },
    root,
    plan,
    project: recorded,
  });
  const result: AddResult = {
    ok: true,
    command: 'add',
    kind: 'env-key',
    dryRun: outcome.dryRun,
    root,
    added: plan.changes.length === 0 ? [] : [key],
    skipped: plan.changes.length === 0 ? [key] : [],
    plan: planReport(outcome.shown),
    written: outcome.written,
    installed: false,
    ...(outcome.diff === undefined ? {} : { diff: outcome.diff }),
  };
  if (!globals.json) {
    if (outcome.dryRun) rt.io.stdout('\nDry run: nothing was written.');
    else
      rt.io.stdout(
        plan.changes.length === 0
          ? `${key} is already in the ${scope} schema; nothing to do.`
          : `Added ${key} to the ${scope} schema${scope === 'runtime' ? ' and the runtime-config files' : ' and .env.example'}.`,
      );
  }
  return result;
}
