import { defineConfig } from 'vitest/config';

export default defineConfig({
  // One copy of React and Testing Library, also when a package like @mfeflow/testing is linked from another folder.
  resolve: { dedupe: ['react', 'react-dom', '@testing-library/react', '@testing-library/dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
