/** An Rsbuild html tag (`html.tags`) that puts an inline script first in `<head>`. */
export interface HeadScriptTag {
  tag: 'script';
  children: string;
  head: true;
  append: false;
}

const scripts = new Map<string, string>();

/**
 * Asks the shell's `<head>` to run `source` before anything else: the first thing the page does, ahead of
 * the app's bundles (a stored theme, for example, so a reload never paints the wrong colours first).
 * Call it from a module that `rsbuild.config.ts` imports, before `createShellConfig` runs. Keyed by
 * `name`, so a config that is loaded again (dev server restart) replaces its script instead of adding a
 * second one. Only the shell uses it; remotes have no page of their own.
 */
export function registerHeadScript(name: string, source: string): void {
  scripts.set(name, source);
}

/** The registered scripts as Rsbuild html tags, in the order they were first registered. */
export function headScriptTags(): HeadScriptTag[] {
  return [...scripts.values()].map((children) => ({
    tag: 'script' as const,
    children,
    head: true as const,
    append: false as const,
  }));
}

/** Only for tests. */
export function resetHeadScriptsForTests(): void {
  scripts.clear();
}
