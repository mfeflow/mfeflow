import { MfeflowError } from '@mfeflow/core';

/** What a command with nothing to act on says in a project that has no apps (`init --kind tooling`). */
export const noApps = (what: string): string => `This project has no apps, so ${what}`;

export const hasNoApps = (project: { apps: Readonly<Record<string, unknown>> }): boolean =>
  Object.keys(project.apps).length === 0;

/** A tooling repo builds with tsc, so `--bundler` (any value, even an empty one) has nothing to act on. */
export function assertNoBundlerFlag(flag: string | undefined): void {
  if (flag === undefined) return;
  throw new MfeflowError(
    'E107',
    '--kind tooling has no apps to bundle, so it takes no --bundler (its packages build with tsc)',
  );
}
