import { defineConfig, mergeRsbuildConfig } from '@rsbuild/core';
import { createShellConfig } from '@mfeflow/rsbuild';
import { noFlashScript } from '@mfeflow/theme';
import { themes } from './src/themes';

export default mergeRsbuildConfig(
  createShellConfig({ name: 'storefront', port: 4300 }),
  defineConfig({
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
);
