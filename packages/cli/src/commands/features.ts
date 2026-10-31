import { findProjectRoot, loadProject } from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals } from '../args';
import { FIRST_PARTY, loadAny } from '../catalog';
import type { FeatureInfo, FeaturesResult } from '../output';
import type { Runtime } from '../runtime';

export const FEATURES_ARGS = {
  search: {
    type: 'positional',
    required: false,
    description: 'Only features whose name or description contains this',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

async function installedFeatures(cwd: string): Promise<Set<string>> {
  try {
    const project = await loadProject(await findProjectRoot(cwd));
    return new Set(Object.keys(project.features));
  } catch {
    return new Set();
  }
}

export function matches(feature: FeatureInfo, search: string): boolean {
  const needle = search.toLowerCase();
  return (
    feature.name.toLowerCase().includes(needle) ||
    feature.description.toLowerCase().includes(needle)
  );
}

function line(feature: FeatureInfo): string {
  const tags = [
    feature.always ? 'always' : feature.default ? 'default' : 'opt-in',
    ...(feature.installed ? ['installed'] : []),
  ];
  return `  ${feature.name.padEnd(14)} ${feature.version.padEnd(7)} ${feature.description} [${tags.join(', ')}]`;
}

export async function runFeatures(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<FeaturesResult> {
  assertKnownFlags(raw, FEATURES_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const search = typeof args.search === 'string' && args.search !== '' ? args.search : null;
  const installed = await installedFeatures(globals.cwd);
  const all = await Promise.all(
    FIRST_PARTY.map(async (first): Promise<FeatureInfo> => {
      const { manifest } = await loadAny(first.name, { roots: rt.roots });
      return {
        name: first.name,
        version: manifest.version,
        description: manifest.description ?? '',
        always: first.always,
        default: first.default,
        installed: installed.has(first.name),
      };
    }),
  );
  const features = search === null ? all : all.filter((f) => matches(f, search));
  if (!globals.json) {
    if (features.length === 0) rt.io.stdout(`No features match "${search ?? ''}".`);
    else rt.io.stdout(features.map(line).join('\n'));
    rt.io.stdout(
      '\nFrom a registry: mfeflow add @namespace/name (configure it under "registries" in mfeflow.json).',
    );
  }
  return { ok: true, command: 'features', search, features };
}
