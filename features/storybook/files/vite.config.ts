import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Storybook's own build config. It leaves out the app's vite.config.ts on purpose: that one
// sets up Module Federation, which a story does not need. Add plugins or aliases your stories need here.
export default defineConfig({
  plugins: [react()],
  // One copy of React, also when a package is linked from another folder.
  resolve: { dedupe: ['react', 'react-dom'] },
});
