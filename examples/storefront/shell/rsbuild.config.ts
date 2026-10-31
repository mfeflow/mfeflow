import { defineConfig, mergeRsbuildConfig } from '@rsbuild/core';
import { createShellConfig } from '@mfeflow/rsbuild';
import { noFlashScript } from '@mfeflow/theme';
import { themes } from './src/themes';

// `rsbuild build --mode development --env-mode dev-build` writes dist-dev: the React development build the StrictMode test serves.
export default defineConfig(({ envMode }) =>
  mergeRsbuildConfig(
    createShellConfig({ name: 'storefront', port: 4300 }),
    defineConfig({
      output: { distPath: { root: envMode === 'dev-build' ? 'dist-dev' : 'dist' } },
      // The development build is served as a build: no hot reload, so no React Refresh runtime.
      dev: { hmr: false },
      html: {
        title: 'mfeflow storefront',
        // Applies the stored theme before first paint, so reloads never flash.
        tags: [
          {
            tag: 'script',
            children: noFlashScript(themes, { defaultTheme: 'light' }),
            head: true,
            append: false,
          },
        ],
      },
    }),
  ),
);
