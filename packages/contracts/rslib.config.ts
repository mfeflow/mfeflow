import { defineConfig } from '@rslib/core';

export default defineConfig({
  source: {
    entry: { index: './src/index.ts', entry: './src/entry.ts' },
    tsconfigPath: './tsconfig.build.json',
  },
  lib: [{ format: 'esm', syntax: 'es2022', dts: true }],
  output: { target: 'web' },
});
