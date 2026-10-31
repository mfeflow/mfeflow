import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { noFlashScript } from '@mfeflow/theme';
import { themes } from '../shell/src/themes';

// The same pages as the storefront, built as one app with route-level lazy
// chunks. Only used as the performance baseline (Phase 01 gate 4).
export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './src/index.tsx' } },
  html: {
    title: 'mfeflow storefront (monolith baseline)',
    tags: [
      {
        tag: 'script',
        children: noFlashScript(themes, { defaultTheme: 'light' }),
        head: true,
        append: false,
      },
    ],
  },
  server: { port: 4302, historyApiFallback: true },
});
