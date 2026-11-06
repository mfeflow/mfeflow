/** What a command with nothing to act on says in a project that has no apps (`init --kind tooling`). */
export const noApps = (what: string): string => `This project has no apps, so ${what}`;

export const hasNoApps = (project: { apps: Readonly<Record<string, unknown>> }): boolean =>
  Object.keys(project.apps).length === 0;
