import { createRemoteConfig } from '@mfeflow/rsbuild';

export default createRemoteConfig({
  name: 'catalog',
  port: 4311,
  exposes: { './App': './src/exposed/App.tsx', './stock': './src/stock.ts' },
});
