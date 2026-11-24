import { defineConfig } from 'vitest/config';

// Relative base so the build works from any sub-path, e.g. GitHub Pages
// project sites at https://<user>.github.io/<repo>/.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
