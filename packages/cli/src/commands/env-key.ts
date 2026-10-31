import fs from 'node:fs/promises';
import path from 'node:path';
import type { AddEnvKeyOp, TransformOp } from '@mfeflow/contracts';
import {
  findProjectRoot,
  loadProject,
  MfeflowError,
  resolveFeature,
  type MfeflowProject,
} from '@mfeflow/core';
import { text, type Globals } from '../args';
import { chooseLocal } from '../local';
import { planReport, type AddResult } from '../output';
import { createBuilder } from '../pipeline';
import type { Runtime } from '../runtime';
import { writePlan } from '../write';

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONFIG_FILE = /^runtime-config(\.[a-z0-9-]+)?\.json$/;

/** Where a server key goes: `--app` names one app or `root`; by default every app. */
function serverTargets(project: MfeflowProject, app: string | undefined): string[] {
  if (app === undefined) return ['shell', 'remotes'];
  if (app === 'root' || app in project.apps) return [app];
  throw new MfeflowError(
    'E107',
    `--app ${app} is not an app (${['root', ...Object.keys(project.apps)].join(', ')})`,
  );
}

/** Runtime config belongs to a shell, which serves /config/runtime-config.json. */
function runtimeTargets(project: MfeflowProject, app: string | undefined): string[] {
  const shells = Object.entries(project.apps).filter(([, a]) => a.kind === 'shell');
  if (app === undefined) return shells.map(([name]) => name);
  if (shells.some(([name]) => name === app)) return [app];
  throw new MfeflowError(
    'E107',
    `--app ${app} is not a shell; runtime config lives in a shell (${shells.map(([n]) => n).join(', ')})`,
  );
}

async function configFilesOf(root: string, dir: string): Promise<string[]> {
  const folder = path.join(root, ...dir.split('/'), 'public', 'config');
  try {
    return (await fs.readdir(folder))
      .filter((name) => CONFIG_FILE.test(name))
      .toSorted()
      .map((name) => `public/config/${name}`);
  } catch {
    return [];
  }
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
  if (key === undefined || !KEY.test(key)) {
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
  const targets = scope === 'server' ? serverTargets(project, app) : runtimeTargets(project, app);
  const configs = await Promise.all(
    targets.map(async (target) =>
      scope === 'runtime' ? await configFilesOf(root, project.apps[target]?.path ?? '') : [],
    ),
  );
  const transforms = targets.map((target, i) =>
    envKeyOp({ target, key, scope, schema, value, configFiles: configs[i] ?? [] }),
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
  const outcome = await writePlan({
    rt,
    globals: { ...globals, install: false },
    root,
    plan,
    project,
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
