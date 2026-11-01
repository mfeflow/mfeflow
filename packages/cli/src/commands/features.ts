import { redactUrl, registryIndexUrl, type FeatureRegistryItem } from '@mfeflow/contracts';
import {
  fetchFeatureIndex,
  findProjectRoot,
  isMfeflowError,
  loadProject,
  type MfeflowProject,
} from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals } from '../args';
import { FIRST_PARTY, loadAny } from '../catalog';
import { reportOf, unexpectedReport } from '../exit';
import type { FeatureInfo, FeaturesResult, RegistryStatus } from '../output';
import type { Runtime } from '../runtime';
import { trustedIn } from '../trust';

export const FEATURES_ARGS = {
  search: {
    type: 'positional',
    required: false,
    description: 'Only features whose name, description or keywords contain this',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

/** The project at or above `cwd`, or undefined outside one. A broken mfeflow.json is still an error. */
async function projectAt(cwd: string): Promise<MfeflowProject | undefined> {
  try {
    return await loadProject(await findProjectRoot(cwd));
  } catch (error) {
    if (isMfeflowError(error) && error.code === 'MFEFLOW_E102') return undefined;
    throw error;
  }
}

export function matches(feature: FeatureInfo, search: string, keywords: string[] = []): boolean {
  const needle = search.toLowerCase();
  return (
    feature.name.toLowerCase().includes(needle) ||
    feature.description.toLowerCase().includes(needle) ||
    keywords.some((keyword) => keyword.toLowerCase().includes(needle))
  );
}

function line(feature: FeatureInfo, widths: { source: number; name: number }): string {
  const tags = [
    feature.always
      ? 'always'
      : feature.source === 'mfeflow'
        ? feature.default
          ? 'default'
          : 'opt-in'
        : 'registry',
    ...(feature.installed ? ['installed'] : []),
  ];
  return `  ${feature.source.padEnd(widths.source)} ${feature.name.padEnd(widths.name)} ${feature.version.padEnd(7)} ${feature.description} [${tags.join(', ')}]`;
}

interface Fetched {
  status: RegistryStatus;
  items: FeatureRegistryItem[];
}

/**
 * The index of every registry the user trusts, asked for at the same time; one that fails is
 * reported, not thrown. A registry that is only named in mfeflow.json is not asked at all.
 */
function fetchIndexes(
  rt: Runtime,
  registries: Record<string, string>,
  trusted: ReadonlySet<string>,
): Promise<Fetched[]> {
  return Promise.all(
    Object.entries(registries)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(async ([namespace, template]): Promise<Fetched> => {
        const base = { namespace, index: redactUrl(registryIndexUrl(template)) };
        if (!trusted.has(namespace)) {
          return { status: { ...base, trusted: false, items: 0, error: null }, items: [] };
        }
        try {
          const items = await fetchFeatureIndex(namespace, registries, rt.fetch, true);
          return { status: { ...base, trusted: true, items: items.length, error: null }, items };
        } catch (error) {
          const report = isMfeflowError(error) ? reportOf(error) : unexpectedReport(error);
          return { status: { ...base, trusted: true, items: 0, error: report }, items: [] };
        }
      }),
  );
}

export async function runFeatures(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<FeaturesResult> {
  assertKnownFlags(raw, FEATURES_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd);
  const search = typeof args.search === 'string' && args.search !== '' ? args.search : null;
  const project = await projectAt(globals.cwd);
  const installed = new Set(Object.keys(project?.features ?? {}));
  const [firstParty, fetched] = await Promise.all([
    Promise.all(
      FIRST_PARTY.map(async (first): Promise<FeatureInfo> => {
        const { manifest } = await loadAny(first.name, { roots: rt.roots });
        return {
          source: 'mfeflow',
          name: first.name,
          version: manifest.version,
          description: manifest.description ?? '',
          always: first.always,
          default: first.default,
          installed: installed.has(first.name),
        };
      }),
    ),
    trustedIn(rt, project?.registries).then((trusted) =>
      fetchIndexes(rt, project?.registries ?? {}, trusted),
    ),
  ]);
  const fromRegistries = fetched.flatMap(({ status, items }) =>
    items
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((item): [FeatureInfo, string[]] => {
        const name = `${status.namespace}/${item.name}`;
        return [
          {
            source: status.namespace,
            name,
            version: item.version,
            description: item.description,
            always: false,
            default: false,
            installed: installed.has(name),
          },
          item.keywords ?? [],
        ];
      }),
  );
  const features = [
    ...firstParty.filter((f) => search === null || matches(f, search)),
    ...fromRegistries
      .filter(([f, keywords]) => search === null || matches(f, search, keywords))
      .map(([f]) => f),
  ];
  const registries = fetched.map((f) => f.status);
  if (!globals.json) {
    if (features.length === 0) rt.io.stdout(`No features match "${search ?? ''}".`);
    else {
      const widths = {
        source: Math.max(...features.map((f) => f.source.length)),
        name: Math.max(14, ...features.map((f) => f.name.length)),
      };
      rt.io.stdout(features.map((f) => line(f, widths)).join('\n'));
    }
    for (const { namespace, error } of registries) {
      if (error) rt.io.stderr(`Could not read ${namespace}: ${error.message}\n  ${error.fix}`);
    }
    const untrusted = registries.filter((r) => !r.trusted).map((r) => r.namespace);
    if (untrusted.length > 0) {
      rt.io.stdout(
        [
          '',
          ...untrusted.map(
            (namespace) =>
              `${namespace}: not trusted yet, nothing was requested. Run \`mfeflow registry trust ${namespace}\` to list its features.`,
          ),
        ].join('\n'),
      );
    }
    rt.io.stdout(
      registries.length === 0
        ? '\nFrom a registry: mfeflow registry add @namespace <url>, then mfeflow add @namespace/name.'
        : '\nAdd one with: mfeflow add @namespace/name.',
    );
  }
  return { ok: true, command: 'features', search, features, registries };
}
