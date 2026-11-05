import path from 'node:path';
import {
  inOrder,
  MfeflowError,
  resolveFeature,
  type MfeflowProject,
  type PlanBuilder,
} from '@mfeflow/core';
import type { Runtime } from './runtime';
import { loadToolingPackage } from './catalog';

export interface ToolingPackage {
  /** The folder in `templates/tooling` and the name under the user's scope. */
  name: string;
  /** Other tooling packages this one needs; they are added with it. */
  needs?: readonly string[];
  /** Our package is only needed to build this one, not by whoever installs it. */
  dev?: boolean;
  /** Said after the choice, for a package only some teams want. */
  note?: string;
}

/** Every package a tooling repo can hold. Adding one is a folder in `templates/tooling` and a line here. */
export const TOOLING_PACKAGES: readonly ToolingPackage[] = [
  { name: 'tsconfig' },
  { name: 'oxlint-config', dev: true },
  { name: 'analytics' },
  { name: 'telemetry' },
  { name: 'url-factory' },
  { name: 'http', needs: ['url-factory'] },
  { name: 'storage' },
  { name: 'theme', needs: ['storage'] },
  { name: 'i18n', needs: ['storage'] },
  { name: 'event-bus' },
  { name: 'route-factory', needs: ['url-factory'] },
  {
    name: 'runtime',
    note: 'for micro-frontends: it loads remotes from a registry. Leave it out if your apps do not run a shell',
  },
  {
    name: 'testing',
    needs: ['runtime'],
    note: 'for micro-frontends: it wraps components in the providers of the shell. Leave it out if your apps do not run a shell',
  },
];

export const DEFAULT_TOOLING_PACKAGES: readonly string[] = ['tsconfig', 'oxlint-config'];

/** Marks the features made from these templates, so the plan does not record them in `mfeflow.json`. */
const FEATURE_PREFIX = 'tooling-';

export interface PackageChoice {
  /** The packages to make, in catalogue order, with the ones they need. */
  packages: string[];
  /** What the command says about the choice: the packages it added and the notes. */
  notices: string[];
}

/** Checks the names against the catalogue and adds what each package needs. */
export function chooseToolingPackages(
  requested: readonly string[],
  catalogue: readonly ToolingPackage[] = TOOLING_PACKAGES,
): PackageChoice {
  const known = new Map(catalogue.map((entry) => [entry.name, entry]));
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new MfeflowError(
      'E107',
      `--packages ${unknown.join(', ')}: not a package this release makes (use ${catalogue.map((e) => e.name).join(', ')})`,
    );
  }
  const chosen = new Set(requested);
  const addedFor = new Map<string, string>();
  const pending = [...requested];
  for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
    for (const need of known.get(name)?.needs ?? []) {
      if (chosen.has(need)) continue;
      if (!known.has(need)) {
        throw new MfeflowError(
          'E107',
          `package ${name} needs ${need}, which is not in the catalogue`,
        );
      }
      chosen.add(need);
      addedFor.set(need, name);
      pending.push(need);
    }
  }
  const packages = catalogue.filter((e) => chosen.has(e.name)).map((e) => e.name);
  const notices = [...addedFor].map(
    ([need, by]) => `packages: also made ${need}, which ${by} needs`,
  );
  for (const entry of catalogue) {
    if (chosen.has(entry.name) && entry.note !== undefined) {
      notices.push(`packages: ${entry.name}: ${entry.note}`);
    }
  }
  return { packages, notices };
}

/**
 * Adds one package per name under `packages/<name>/` to the plan: the files of its template, and a
 * dependency on our `@mfeflow/<name>` that the builder turns into the version of this CLI (or a
 * `link:` with `--local`). The packages are not recorded as features: their files are tracked by
 * hash like any other copied file, and a package is the user's to change.
 */
export async function planToolingPackages(
  rt: Runtime,
  builder: PlanBuilder,
  project: MfeflowProject,
  names: readonly string[],
  catalogue: readonly ToolingPackage[] = TOOLING_PACKAGES,
): Promise<void> {
  const own = builder.scoped('first-party');
  await inOrder(names, async (name) => {
    const entry = catalogue.find((e) => e.name === name);
    const file = path.posix.join('packages', name, 'package.json');
    await resolveFeature({ feature: await loadToolingPackage(name, rt.roots), project, builder });
    await own.addDependency(file, `@mfeflow/${name}`, 'latest', entry?.dev === true);
  });
}

/** True for the plan entries `planToolingPackages` made. */
export function isToolingPackageFeature(name: string): boolean {
  return name.startsWith(FEATURE_PREFIX);
}
