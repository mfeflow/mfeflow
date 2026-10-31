import semver from 'semver';
import { finding, type Check } from '../findings';
import { versionIn } from '../inspect';
import { SINGLETON_PACKAGES, specifiersOf } from '../singletons';

/** The comparable version behind an installed version or a declared range. */
export function comparable(version: string): string | undefined {
  return semver.valid(version) ?? semver.minVersion(version)?.version ?? undefined;
}

export const singletonVersions: Check = {
  id: 'singletons.versions',
  title: 'each singleton (react, react-dom, …) is one version across the apps',
  async run({ apps }) {
    const present = apps.filter((app) => app.present);
    const out = [];
    for (const name of SINGLETON_PACKAGES) {
      // oxlint-disable-next-line no-await-in-loop -- reads a few package.json files per package
      const found = await Promise.all(
        present.map(async (app) => ({ app: app.name, version: await versionIn(app, name) })),
      );
      const used = found.flatMap((f) =>
        f.version === undefined
          ? []
          : [{ app: f.app, version: comparable(f.version) ?? f.version }],
      );
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
