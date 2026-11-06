import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 3003, strictPort: true, origin: 'http://localhost:3003' },
  build: { target: 'esnext' },
  plugins: [
    react(),
    federation({
      name: 'reviews',
      filename: 'remoteEntry.js',
      manifest: true,
      dts: false,
      exposes: { './Reviews': './src/Reviews.tsx' },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
        // Shared as their own keys, so the shell's copy of React also runs the remote's JSX.
        'react/jsx-runtime': { singleton: true, requiredVersion: '^19.0.0' },
        'react/jsx-dev-runtime': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
});
