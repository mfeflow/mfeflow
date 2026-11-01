import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';

const shared = {
  react: { singleton: true, requiredVersion: '^19.0.0' },
  'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
};

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    pluginModuleFederation({
      name: 'shell',
      remotes: {
        catalog: 'catalog@http://localhost:3001/mf-manifest.json',
        checkout: 'checkout@http://localhost:3002/remoteEntry.js',
      },
      shared,
    }),
  ],
});
