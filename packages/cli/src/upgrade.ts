import path from 'node:path';
import {
  messageOf,
  realFs,
  planUpgrade,
  type LoadedFeature,
  type MfeflowProject,
  type UpgradeDecisions,
  type UpgradePlan,
} from '@mfeflow/core';
import type { AssetRoots } from './assets';
import { inCatalogueOrder } from './commands/add';
import { loadAny } from './catalog';
import { remoteGlue } from './glue';
import { projectReader } from './pipeline';
import { readPackageJson } from './version';
import type { FetchLike } from '@mfeflow/core';

const ALWAYS = ['core', 'tsconfig'];

export interface UpgradeContext {
  roots: AssetRoots;
  fetch: FetchLike;
}

/** The features `init` would apply for these recorded ones, in its order, `core` and `tsconfig` first. */
export function replayOrder(project: MfeflowProject): string[] {
  const rest = Object.keys(project.features).filter((name) => !ALWAYS.includes(name));
  return [...ALWAYS, ...inCatalogueOrder(rest)];
}

/**
 * Plans moving the project at `root` to `toVersion` (default: this CLI) from the templates and
 * features this CLI ships. A recorded feature that cannot be loaded, or that a registry serves at
 * another version than the one installed, is left out and named in the plan's warnings.
 */
export async function planProjectUpgrade(
  ctx: UpgradeContext,
  root: string,
  project: MfeflowProject,
  toVersion: string = readPackageJson().version,
  decisions: UpgradeDecisions = {},
): Promise<UpgradePlan> {
  const features: LoadedFeature[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const name of replayOrder(project)) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one at a time keeps registry requests ordered
      const loaded = await loadAny(name, {
        roots: ctx.roots,
        registries: project.registries,
        fetch: ctx.fetch,
        version: project.features[name]?.version,
      });
      const recorded = project.features[name]?.version;
      if (
        loaded.trust === 'third-party' &&
        recorded !== undefined &&
        loaded.manifest.version !== recorded
      ) {
        throw new Error(`the registry serves ${loaded.manifest.version}, installed is ${recorded}`);
      }
      features.push(loaded);
    } catch (error) {
      if (ALWAYS.includes(name)) throw error;
      skipped.push({ name, reason: messageOf(error) });
    }
  }
  const core = features.find((f) => f.manifest.name === 'core');
  const glue = await Promise.all(
    Object.entries(project.apps).flatMap(([name, app]) =>
      app.kind === 'remote' && app.port !== undefined && core !== undefined
        ? [
            remoteGlue({
              roots: ctx.roots,
              version: core.manifest.version,
              remote: { name, port: app.port },
              registry: true,
              shells: ['shell'],
            }),
          ]
        : [],
    ),
  );
  return planUpgrade(project, {
    toVersion,
    decisions,
    read: projectReader(root),
    features,
    glue,
    skipped,
    isSymlink: (file) => realFs.isSymlink(path.join(root, ...file.split('/'))),
  });
}
