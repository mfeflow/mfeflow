const { ModuleFederationPlugin } = require('@module-federation/enhanced/webpack');
const { getRemotes } = require('./federation/remotes');
const baseShared = require('./federation/shared');
const deps = require('./package.json').dependencies;

module.exports = (env) => ({
  mode: env.production ? 'production' : 'development',
  devServer: { port: Number(process.env.PORT) || 3000 },
  plugins: [
    new ModuleFederationPlugin({
      name: 'dynamic_host',
      remotes: getRemotes(env),
      exposes: {
        './Widget': './src/Widget',
        [`./${env.extra}`]: './src/Extra',
      },
      shared: {
        ...baseShared,
        react: { singleton: true, requiredVersion: deps.react },
        'react-dom': { singleton: true, requiredVersion: process.env.REACT_RANGE },
      },
    }),
  ],
});
