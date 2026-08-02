import { defineConfig, devices } from '@playwright/test';

const PORT = 4347;
const BASE = '/crypto-lab-mayo-seal/';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  // The a11y sweep drives every exhibit and scans nine states per theme, which is
  // legitimately slower than the 30s default — and slower still on a shared CI
  // runner. One worker there too, so the two themes do not fight for the CPU.
  timeout: 180_000,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    colorScheme: 'dark',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build before serving. `preview` only serves whatever is already in
    // dist/; without the build in front, a failing build leaves the previous
    // good bundle on disk and the suite passes green against code that no
    // longer compiles — silently invalidating mutation checks.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
