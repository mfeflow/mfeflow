import { defineConfig } from '@rslib/core';

// Bundleless: one output file per source file, so `./react` imports the same
// `./index` module instance instead of a bundled copy.
export default defineConfig({
  source: {
    entry: { index: ['./src/**/*.{ts,tsx}', '!./src/**/*.test.{ts,tsx}'] },
    tsconfigPath: './tsconfig.build.json',
  },
  lib: [{ format: 'esm', syntax: 'es2022', dts: true, bundle: false }],
  output: { target: 'web' },
});
