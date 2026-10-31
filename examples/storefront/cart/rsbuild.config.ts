import { createRemoteConfig } from '@mfeflow/rsbuild';

export default createRemoteConfig({
  name: 'cart',
  port: 4312,
  exposes: { './App': './src/exposed/App.tsx', './MiniCart': './src/exposed/MiniCart.tsx' },
});
