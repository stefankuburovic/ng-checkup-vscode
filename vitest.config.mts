import { defineConfig } from 'vitest/config';

/** Plain Node tests: the modules under test never import `vscode`, which is why the mapping lives apart from the extension. */
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['test/fixtures/**'],
  },
});
