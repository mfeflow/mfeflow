import { done, finding, type Check } from '../findings';

export const workspaceVersions: Check = {
  id: 'singletons.workspace-version',
  title: 'every workspace package has a version',
  run: ({ workspace }) =>
    done(
      workspace
        .filter((p) => !p.hasVersion)
        .map((p) =>
          finding(
            'singletons.workspace-version',
            'E111',
            `${p.pkg.name ?? p.rel} (${p.rel}/package.json)`,
            { path: `${p.rel}/package.json`, fixable: true },
          ),
        ),
    ),
};
