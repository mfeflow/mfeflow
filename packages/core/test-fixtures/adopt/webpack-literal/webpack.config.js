const { ModuleFederationPlugin } = require('@module-federation/enhanced/webpack');

const PORT = 3002;
const reactVersion = '^19.0.0';

const shared = {
  react: { singleton: true, requiredVersion: reactVersion },
  'react-dom': { singleton: true, requiredVersion: reactVersion },
};

module.exports = {
  mode: 'development',
  entry: './src/index.js',
  devServer: { port: PORT },
  plugins: [
    new ModuleFederationPlugin({
      name: 'cart',
      filename: 'remoteEntry.js',
      remotes: {
        profile: 'profile@http://localhost:3003/remoteEntry.js',
      },
      exposes: {
        './Cart': './src/Cart',
        './CartButton': { import: './src/CartButton' },
      },
      shared: { ...shared, lodash: '^4.17.21' },
    }),
  ],
};
