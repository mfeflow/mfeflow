import type { HtmlTagDescriptor, Plugin } from 'vite';
import { headScripts } from '@mfeflow/bundler-shared';

export { registerHeadScript } from '@mfeflow/bundler-shared';

/** The registered head scripts as Vite html tags, first in `<head>`, in registration order. */
export function headScriptTags(): HtmlTagDescriptor[] {
  return headScripts().map((children) => ({
    tag: 'script',
    children,
    injectTo: 'head-prepend',
  }));
}

/**
 * Puts every script given to `registerHeadScript` first in the shell's `<head>`. The scripts are read
 * when the page is built, so a module the config imports can register one before or after this runs.
 */
export function pluginHeadScripts(): Plugin {
  return {
    name: 'mfeflow:head-scripts',
    transformIndexHtml: {
      order: 'pre',
      handler: () => headScriptTags(),
    },
  };
}
