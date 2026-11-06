const scripts = new Map<string, string>();

/**
 * Asks the shell's `<head>` to run `source` before anything else: the first thing the page does, ahead of
 * the app's bundles (a stored theme, for example, so a reload never paints the wrong colours first).
 * Call it from a module that the bundler config (`rsbuild.config.ts` or `vite.config.ts`) imports, before
 * `createShellConfig` runs. Keyed by `name`, so a config that is loaded again (dev server restart)
 * replaces its script instead of adding a second one. Only the shell uses it; remotes have no page of
 * their own.
 */
export function registerHeadScript(name: string, source: string): void {
  scripts.set(name, source);
}

/** The registered script sources, in the order they were first registered. */
export function headScripts(): string[] {
  return [...scripts.values()];
}

/** Only for tests. */
export function resetHeadScriptsForTests(): void {
  scripts.clear();
}
