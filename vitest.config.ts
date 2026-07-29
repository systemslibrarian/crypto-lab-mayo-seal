import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Keep Vitest out of e2e/ — those are Playwright specs.
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
