import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { rspack } from '@rspack/core';

export default {
  entry: './src/index.ts',
  output: { publicPath: 'auto', clean: true },
  devServer: {
    port: 3002,
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
  resolve: { extensions: ['.tsx', '.ts', '.js'] },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic' } },
          },
        },
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({ template: './index.html' }),
    new ModuleFederationPlugin({
      name: 'checkout',
      exposes: { './Checkout': './src/Checkout.tsx' },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
};
