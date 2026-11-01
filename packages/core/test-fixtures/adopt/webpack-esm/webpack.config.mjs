import webpack from 'webpack';

export default {
  mode: 'development',
  devServer: { port: 8080 },
  plugins: [
    new webpack.container.ModuleFederationPlugin({
      name: 'host',
      remotes: {
        cart: 'cart@http://localhost:3002/remoteEntry.js',
        search: 'http://localhost:3004/mf-manifest.json',
      },
      shared: ['react', 'react-dom'],
    }),
  ],
};
