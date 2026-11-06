import { headScripts } from '@mfeflow/bundler-shared';

export { registerHeadScript, resetHeadScriptsForTests } from '@mfeflow/bundler-shared';

/** An Rsbuild html tag (`html.tags`) that puts an inline script first in `<head>`. */
export interface HeadScriptTag {
  tag: 'script';
  children: string;
  head: true;
  append: false;
}

/** The registered scripts as Rsbuild html tags, in the order they were first registered. */
export function headScriptTags(): HeadScriptTag[] {
  return headScripts().map((children) => ({
    tag: 'script' as const,
    children,
    head: true as const,
    append: false as const,
  }));
}
