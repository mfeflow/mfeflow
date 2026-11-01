import fs from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot, loadProject, MfeflowError, resolveFeature } from '@mfeflow/core';
import type { Globals } from '../args';
import { text } from '../args';
import { inCatalogueOrder, isFirstParty, loadAny, POLYREPO_FEATURE } from '../catalog';
import { Cancelled } from '../exit';
import { assertAppName, nameFrom, portFor, remoteGlue, REMOTE_PORT } from '../glue';
import { readText } from '../inspect';
import { chooseLocal } from '../local';
import type { FeatureOptions } from '../options';
import { planReport, type AddResult } from '../output';
import { createBuilder } from '../pipeline';
import { DEV_CONFIG, devConfigText, portOf, readDevRemotes, withDevRemote } from '../devremotes';
import { mergeReports, planRepo, PLATFORM_DIR, prefixReport } from '../polyrepo';
import type { Runtime } from '../runtime';
import { writePlan } from '../write';
import { assertEmpty } from './init';

const KEPT_IN_SHELL = new Set(['core', 'tsconfig', POLYREPO_FEATURE]);

/**
 * `mfeflow add team-repo <name>`, run in the shell repo: makes `../<name>` a new git repo with the
 * remote in it, then registers the remote here (a route, staging and prod registry entries and its
 * dev server in the dev config). The new repo is written first, so a failure here leaves no folder.
 */
export async function addTeamRepo(
  rt: Runtime,
  globals: Globals,
  args: Record<string, unknown>,
  given: string | undefined,
): Promise<AddResult> {
  const root = await findProjectRoot(globals.cwd);
  const chosen = chooseLocal(await loadProject(root), root, globals.cwd, text(args, 'local'));
  const { project } = chosen;
  if (project.topology !== 'polyrepo' || project.repo !== 'shell') {
    throw new MfeflowError('E107', 'add team-repo works in the shell repo of a polyrepo', {
      fix: 'Run it from the shell folder made by `mfeflow init --topology polyrepo`.',
    });
  }
  const name = await nameFrom(rt, globals, given, 'team-repo');
  const devText = await readText(path.join(root, ...DEV_CONFIG.split('/')));
  const known = readDevRemotes(devText);
  const taken = {
    apps: {
      ...project.apps,
      ...Object.fromEntries(
        Object.entries(known).map(([remote, url]) => [
          remote,
          { kind: 'remote' as const, path: '', ...optionalPort(portOf(url)) },
        ]),
      ),
    },
  };
  assertAppName(name, taken.apps);
  if (name === PLATFORM_DIR) {
    throw new MfeflowError('E215', `"${PLATFORM_DIR}" is a reserved name in a polyrepo`);
  }
  const port = portFor(args, taken, REMOTE_PORT);
  const org = path.dirname(root);
  const repoRoot = path.join(org, name);
  await assertEmpty(repoRoot);

  const inherited = Object.keys(project.features).filter((n) => !KEPT_IN_SHELL.has(n));
  const features = inCatalogueOrder(inherited.filter(isFirstParty));
  const featureOptions: FeatureOptions = Object.fromEntries(
    features.map((feature) => [feature, project.features[feature]?.options ?? {}]),
  );
  const repo = await planRepo(rt, {
    kind: 'remote',
    dir: name,
    root: repoRoot,
    scope: project.scope,
    remote: { name, port },
    features,
    featureOptions,
    local: chosen.checkout,
    cwd: globals.cwd,
  });
  const warnings = [
    ...inherited.filter((n) => !isFirstParty(n)).map((n) => `${n} is not in ${name}; add it there`),
    ...((await exists(path.join(org, PLATFORM_DIR)))
      ? []
      : [`${PLATFORM_DIR}/ is not next to ${path.basename(root)}/, so ${name} cannot link to it`]),
  ];
  const repoPlan = { ...repo.plan, warnings: [...repo.plan.warnings, ...warnings] };

  const builder = createBuilder(root, chosen.checkout);
  const core = await loadAny('core', { roots: rt.roots });
  await resolveFeature({
    feature: await remoteGlue({
      roots: rt.roots,
      version: core.manifest.version,
      remote: { name, port },
      registry: true,
      registryEnvs: ['staging', 'prod'],
      shells: ['shell'],
    }),
    project,
    builder,
  });
  if (devText === undefined) await builder.create(DEV_CONFIG, devConfigText([{ name, port }]));
  else await builder.patch(DEV_CONFIG, (source) => withDevRemote(source, { name, port }));
  // Adding a repo does not change which features are installed, or at what version.
  const shellPlan = { ...builder.build(), features: [] };

  if (globals.canPrompt) {
    const ok = await rt.prompter.confirm({
      message: `Create ${repoRoot} and register ${name} in ${root}?`,
    });
    if (!ok) throw new Cancelled();
  }
  const inner = { ...globals, canPrompt: false };
  if (!globals.json) rt.io.stdout(`\n${name}/`);
  const created = await writePlan({
    rt,
    globals: inner,
    root: repoRoot,
    plan: repoPlan,
    project: repo.project,
    afterWrite: async () => {
      await rt.system.initRepo(repoRoot);
    },
  });
  if (!globals.json) rt.io.stdout(`\n${path.basename(root)}/`);
  let registered;
  try {
    registered = await writePlan({ rt, globals: inner, root, plan: shellPlan, project });
  } catch (error) {
    if (!created.dryRun) await fs.rm(repoRoot, { recursive: true, force: true });
    throw error;
  }

  const result: AddResult = {
    ok: true,
    command: 'add',
    kind: 'team-repo',
    dryRun: registered.dryRun,
    root,
    added: [name],
    skipped: [],
    created: repoRoot,
    plan: mergeReports([
      prefixReport(planReport(created.shown), name),
      prefixReport(planReport(registered.shown), path.basename(root)),
    ]),
    written: [
      ...created.written.map((file) => `${name}/${file}`),
      ...registered.written.map((file) => `${path.basename(root)}/${file}`),
    ],
    installed: created.installed,
    ...(registered.diff === undefined
      ? {}
      : { diff: [created.diff ?? '', registered.diff].join('\n') }),
  };
  if (!globals.json) {
    if (result.dryRun) rt.io.stdout('\nDry run: nothing was written.');
    else {
      rt.io.stdout(`\nAdded ${name} (team-repo) at ${repoRoot}.`);
      rt.io.stdout(
        `Next:\n  cd ../${name}${created.installed ? '' : ' && pnpm install'}\n  pnpm dev`,
      );
    }
  }
  return result;
}

function optionalPort(port: number | undefined): { port?: number } {
  return port === undefined ? {} : { port };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
