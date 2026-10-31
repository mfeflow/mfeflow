export interface SingletonCheck {
  /** Expected shared packages that are not in the share scope at all (e.g. a workspace package without a `version`). */
  missing: string[];
  /** Packages with more than one loaded version. */
  duplicated: string[];
}

interface SharedEntry {
  loaded?: boolean;
  lib?: unknown;
}

type ShareScopes = Record<string, Record<string, Record<string, Record<string, SharedEntry>>>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function shareScopes(): ShareScopes | undefined {
  const federation: unknown = Reflect.get(globalThis, '__FEDERATION__');
  if (!isRecord(federation)) return undefined;
  const share: unknown = Reflect.get(federation, '__SHARE__');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape owned by @module-federation/runtime; read-only and checked field by field below
  return isRecord(share) ? (share as ShareScopes) : undefined;
}

/**
 * Checks the Module Federation share scope for the given singletons. Run in
 * the shell after remotes load; the spike found a shared package without a
 * `version` silently loaded once per app.
 */
export function checkSingletons(expected: readonly string[]): SingletonCheck {
  const scopes = shareScopes() ?? {};
  const loadedVersions = new Map<string, Set<string>>();
  for (const instance of Object.values(scopes)) {
    for (const scope of Object.values(instance)) {
      for (const [pkg, versions] of Object.entries(scope)) {
        for (const [version, entry] of Object.entries(versions)) {
          if (!loadedVersions.has(pkg)) loadedVersions.set(pkg, new Set());
          if (entry.loaded === true || entry.lib !== undefined)
            loadedVersions.get(pkg)?.add(version);
        }
      }
    }
  }
  return {
    missing: expected.filter((p) => !loadedVersions.has(p)),
    duplicated: expected.filter((p) => (loadedVersions.get(p)?.size ?? 0) > 1),
  };
}
