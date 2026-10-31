import semver from 'semver';
import { finding, type Check, type Finding } from '../findings';
import { versionIn } from '../inspect';
import { SINGLETON_PACKAGES, specifiersOf } from '../singletons';

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

/** The warning for specs that cannot be compared before install. */
export function unresolved(
  check: string,
  code: 'E301' | 'E302',
  name: string,
  specs: readonly string[],
): Finding {
  return finding(
    check,
    code,
    `${name} is ${specs.join(', ')}: the version cannot be compared until install, so it is not checked`,
    { severity: 'warning' },
  );
}

export const singletonVersions: Check = {
  id: 'singletons.versions',
  title: 'each singleton (react, react-dom, …) is one version across the apps',
  async run({ apps, root }) {
    const present = apps.filter((app) => app.present);
    const out: Finding[] = [];
    for (const name of SINGLETON_PACKAGES) {
      // oxlint-disable-next-line no-await-in-loop -- reads a few package.json files per package
      const found = await Promise.all(
        present.map(async (app) => ({
          app: app.name,
          version: await versionIn(app, name, root),
        })),
      );
      const used = found.flatMap((f) => {
        const version = f.version === undefined ? undefined : comparable(f.version);
        return version === undefined ? [] : [{ app: f.app, version }];
      });
      const open = found.filter(
        (f) => f.version !== undefined && comparable(f.version) === undefined,
      );
      if (open.length > 0) {
        out.push(
          unresolved(
            'singletons.versions',
            'E301',
            name,
            open.map((f) => `${f.app} ${String(f.version)}`),
          ),
        );
      }
      const versions = new Set(used.map((u) => u.version));
      if (versions.size > 1) {
        const list = used.map((u) => `${u.app} ${u.version}`).join(', ');
        out.push(
          finding(
            'singletons.versions',
            'E301',
            `${name} (${specifiersOf(name).join(', ')}) is ${[...versions].join(' and ')}: ${list}`,
          ),
        );
      }
    }
    return { findings: out };
  },
};
