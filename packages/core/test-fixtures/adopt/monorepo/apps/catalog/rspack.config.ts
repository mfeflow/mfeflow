import { ModuleFederationPlugin as Federation } from '@module-federation/enhanced/rspack';
import { defineConfig } from '@rspack/cli';

const exposes = {
  './ProductList': './src/ProductList.tsx',
} as const;

export default defineConfig({
  devServer: { port: 3001 },
  plugins: [
    new Federation({
      name: 'catalog',
      exposes,
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    } satisfies Record<string, unknown>),
  ],
});
