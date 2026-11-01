const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  devServer: { port: 3002 },
  plugins: [
    new ModuleFederationPlugin({
      name: 'checkout',
      filename: 'remoteEntry.js',
      exposes: { './Checkout': './src/Checkout' },
      shared: {
        react: { singleton: true, requiredVersion: false },
        'react-dom': { singleton: true },
      },
    }),
  ],
};
