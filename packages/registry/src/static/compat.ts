import semver from 'semver';

/**
 * The comparable version behind an installed version or a declared range. Undefined for a spec
 * that names no version (`link:`, `workspace:*`, `catalog:`, `latest`): it is only known after install.
 */
export function comparable(version: string): string | undefined {
  const exact = semver.valid(version);
  if (exact !== null) return exact;
  return semver.validRange(version) === null
    ? undefined
    : (semver.minVersion(version)?.version ?? undefined);
}

/** Does `provided` satisfy `range`? Unknown or unresolved versions and unparsable ranges pass: nothing to compare. */
export function satisfiesRange(range: string, provided: string | undefined): boolean {
  if (provided === undefined) return true;
  const have = comparable(provided);
  const valid = semver.validRange(range);
  return have === undefined || valid === null || semver.satisfies(have, valid);
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface SharedEntry {
  name: string;
  version?: string;
  requiredVersion?: string;
  singleton: boolean;
}

/** The `shared` entries of a Module Federation `mf-manifest.json`. */
export function sharedOf(manifest: unknown): SharedEntry[] {
  if (!isObj(manifest) || !Array.isArray(manifest.shared)) return [];
  return manifest.shared.flatMap((item: unknown) => {
    if (!isObj(item) || typeof item.name !== 'string') return [];
    return [
      {
        name: item.name,
        singleton: item.singleton === true,
        ...(typeof item.version === 'string' ? { version: item.version } : {}),
        ...(typeof item.requiredVersion === 'string'
          ? { requiredVersion: item.requiredVersion }
          : {}),
      },
    ];
  });
}

export interface CompatProblem {
  name: string;
  range: string;
  provided: string;
  /** Where the range came from. */
  source: 'shared' | 'mfe.json platform';
}

export interface CompatInput {
  /** The remote's own `mf-manifest.json`. */
  remoteManifest: unknown;
  /** `mfe.json` `platform` ranges. */
  platform?: Record<string, string> | undefined;
  /** The target shell's deployed `mf-manifest.json`. */
  shellManifest?: unknown;
  /** Versions to fall back to for packages the shell manifest does not list. */
  workspaceVersions?: Record<string, string> | undefined;
}

/**
 * Every singleton range the remote asks for (its `shared` entries and `mfe.json` platform) that the
 * version the shell provides does not satisfy. A package neither the shell manifest nor the workspace
 * versions know is not checked.
 */
export function compatProblems(input: CompatInput): CompatProblem[] {
  const provided = new Map<string, string>(Object.entries(input.workspaceVersions ?? {}));
  for (const shared of sharedOf(input.shellManifest))
    if (shared.version !== undefined) provided.set(shared.name, shared.version);
  const asked: Omit<CompatProblem, 'provided'>[] = [
    ...sharedOf(input.remoteManifest).flatMap((s) =>
      s.singleton && s.requiredVersion !== undefined
        ? [{ name: s.name, range: s.requiredVersion, source: 'shared' as const }]
        : [],
    ),
    ...Object.entries(input.platform ?? {}).map(([name, range]) => ({
      name,
      range,
      source: 'mfe.json platform' as const,
    })),
  ];
  const out: CompatProblem[] = [];
  for (const ask of asked) {
    const have = provided.get(ask.name);
    if (have !== undefined && !satisfiesRange(ask.range, have))
      out.push({ ...ask, provided: have });
  }
  return out;
}
