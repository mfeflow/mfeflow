import { defineConfig } from '@rslib/core';

export default defineConfig({
  source: {
    entry: { static: './src/static/index.ts', s3: './src/s3/index.ts' },
    tsconfigPath: './tsconfig.build.json',
  },
  lib: [{ format: 'esm', syntax: 'es2022', dts: true }],
  output: { target: 'node' },
});
