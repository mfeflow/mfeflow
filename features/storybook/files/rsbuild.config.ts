import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

// Storybook's own build config. It leaves out the app's rsbuild.config.ts on purpose: that one
// sets up Module Federation, which a story does not need. Add loaders or aliases your stories need here.
export default defineConfig({
  plugins: [pluginReact()],
  // One copy of React, also when a package is linked from another folder.
  resolve: { dedupe: ['react', 'react-dom'] },
});
