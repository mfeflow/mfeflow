import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';
import { federationFor } from './federation';

export default defineConfig({
  plugins: [pluginModuleFederation(federationFor(process.env.APP_ENV))],
});
