import path from 'node:path';
import {
  detectFederation,
  MfeflowError,
  planAdoption,
  PROJECT_FILE,
  APP_FILE,
  LEGACY_APP_FILE,
  type AdoptPlan,
  type FederationReport,
  type MfeflowProject,
  type NotAdopted,
} from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals } from '../args';
import { chooseLocal, PLACEHOLDER_RANGE } from '../local';
import { registryEntryFiles } from '../glue';
import { planReport, type AdoptResult, type AppReport } from '../output';
import { createBuilder, projectReader } from '../pipeline';
import type { Runtime } from '../runtime';
import { writePlan } from '../write';
import { scopeFor } from './init';

export const ADOPT_ARGS = {
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

const RUNTIME_PACKAGE = '@mfeflow/runtime';

const join = (dir: string, file: string): string => (dir === '.' ? file : `${dir}/${file}`);
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The lines to paste into the shared list of a build config, which adopt never edits. */
export const SHARED_SNIPPET = `    '${RUNTIME_PACKAGE}': { singleton: true },`;

async function readName(root: string): Promise<string | undefined> {
  const source = await projectReader(root)('package.json');
  if (source === undefined) return undefined;
  try {
    const pkg: unknown = JSON.parse(source);
    return typeof pkg === 'object' && pkg !== null && 'name' in pkg && typeof pkg.name === 'string'
      ? pkg.name
      : undefined;
  } catch {
    return undefined;
  }
}

const SCOPE_OF = /^(@[a-z0-9][a-z0-9-._]*)\//;

/** The npm scope of the root package, else of the first app's package, else one made from the folder name. */
async function scopeOf(root: string, report: FederationReport): Promise<string> {
  const names = [await readName(root), ...report.apps.map((app) => app.packageName)];
  const own = names.map((name) => SCOPE_OF.exec(name ?? '')?.[1]).find((scope) => scope);
  return own ?? scopeFor('.', root);
}

async function packageManagerOf(root: string): Promise<MfeflowProject['packageManager']> {
  const read = projectReader(root);
  const [workspace, pnpmLock, npmLock, yarnLock, bunLock] = await Promise.all([
    read('pnpm-workspace.yaml'),
    read('pnpm-lock.yaml'),
    read('package-lock.json'),
    read('yarn.lock'),
    read('bun.lock'),
  ]);
  if (workspace !== undefined || pnpmLock !== undefined) return 'pnpm';
  if (npmLock !== undefined) return 'npm';
  if (yarnLock !== undefined || bunLock !== undefined) {
    throw new MfeflowError(
      'E107',
      'this project uses yarn or bun; adopt writes pnpm or npm projects in this release',
    );
  }
  return 'pnpm';
}

/** Each distinct build config file the detector read, relative to the project root. */
function buildConfigsOf(report: FederationReport): string[] {
  const files = report.apps.flatMap((app) => [
    app.configFile,
    app.federationFile ?? app.configFile,
  ]);
  return [...new Set(files)].toSorted();
}

function assertMayWrite(globals: ReturnType<typeof readGlobals>): void {
  if (globals.dryRun || globals.canPrompt || globals.yes) return;
  throw new MfeflowError(
    'E107',
    'adopt writes files and there is no terminal to confirm in; pass --yes to write them, or --dry-run to only look',
  );
}

async function buildPlan(
  rt: Runtime,
  root: string,
  adoption: AdoptPlan,
  checkout: string | undefined,
) {
  const builder = createBuilder(root, checkout);
  await builder.captureProject();
  for (const file of adoption.appFiles) {
    const target = join(file.dir, APP_FILE);
    const legacy = join(file.dir, LEGACY_APP_FILE);
    // oxlint-disable-next-line no-await-in-loop -- the plan builder records edits one at a time
    if ((await builder.exists(target)) || (await builder.exists(legacy))) {
      builder.warn(
        `${file.name}: ${join(file.dir, APP_FILE)} or ${LEGACY_APP_FILE} already exists, so it was kept as it is`,
      );
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- as above
    await builder.create(target, json(file.content), false);
  }
  for (const remote of adoption.remotes) {
    // oxlint-disable-next-line no-await-in-loop -- as above
    for (const entry of await registryEntryFiles(rt.roots, remote)) {
      // oxlint-disable-next-line no-await-in-loop -- as above
      await builder.create(entry.path, entry.content, false);
    }
  }
  for (const dir of adoption.shellDirs) {
    const manifest = join(dir, 'package.json');
    // oxlint-disable-next-line no-await-in-loop -- as above
    if (await builder.exists(manifest)) {
      // oxlint-disable-next-line no-await-in-loop -- as above
      await builder.addDependency(manifest, RUNTIME_PACKAGE, PLACEHOLDER_RANGE);
    } else {
      builder.warn(
        `${dir} has no package.json, so ${RUNTIME_PACKAGE} was not added; add it yourself`,
      );
    }
  }
  for (const warning of adoption.warnings) builder.warn(warning);
  return builder.build();
}

function listNotAdopted(items: readonly NotAdopted[]): string {
  return [
    'not carried over:',
    ...items.map((item) => `  ${item.file} ${item.field}: ${item.reason}`),
  ].join('\n');
}

function printAfter(
  rt: Runtime,
  result: AdoptResult,
  notAdopted: readonly NotAdopted[],
  buildConfig: readonly string[],
): void {
  const lines: string[] = [''];
  if (notAdopted.length > 0) lines.push(listNotAdopted(notAdopted), '');
  lines.push(
    `Your build config was not changed (${buildConfig.join(', ')}). adopt never edits it.`,
    `To share the runtime as a singleton, add this line to the shared list in the shell's config:`,
    '',
    result.snippet,
    '',
  );
  if (result.dryRun) lines.push('Dry run: nothing was written.');
  else lines.push(`Next:\n${result.next.map((line) => `  ${line}`).join('\n')}`);
  rt.io.stdout(lines.join('\n'));
}

export async function runAdopt(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<AdoptResult> {
  assertKnownFlags(raw, ADOPT_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const root = path.resolve(globals.cwd);
  if ((await projectReader(root)(PROJECT_FILE)) !== undefined) {
    throw new MfeflowError('E123', `${root} has one already`);
  }
  assertMayWrite(globals);

  const report = await detectFederation(root);
  const adoption = planAdoption({
    report,
    scope: await scopeOf(root, report),
    packageManager: await packageManagerOf(root),
  });
  const chosen = chooseLocal(adoption.project, root, globals.cwd, globals.local);
  const plan = await buildPlan(rt, root, adoption, chosen.checkout);

  const outcome = await writePlan({ rt, globals, root, plan, project: chosen.project });
  const buildConfig = buildConfigsOf(report);
  const apps: AppReport[] = Object.entries(chosen.project.apps).map(([name, app]) => ({
    name,
    kind: app.kind,
    path: app.path,
    port: app.port ?? null,
  }));
  const next = [
    ...(outcome.installed ? [] : ['pnpm install']),
    'set the owner and the routes in each mfeflow.app.json',
    'mfeflow validate',
    'mfeflow doctor',
  ];
  const result: AdoptResult = {
    ok: true,
    command: 'adopt',
    dryRun: outcome.dryRun,
    root,
    scope: chosen.project.scope,
    apps,
    notAdopted: adoption.notAdopted,
    buildConfig,
    snippet: SHARED_SNIPPET,
    next,
    plan: planReport(outcome.shown),
    written: outcome.written,
    installed: outcome.installed,
    ...(outcome.diff === undefined ? {} : { diff: outcome.diff }),
  };
  if (!globals.json) printAfter(rt, result, adoption.notAdopted, buildConfig);
  return result;
}
