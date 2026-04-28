import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — runs against either the local Vite dev server
 * (`npm run dev`) or the deployed Netlify URL. Override the target with
 * `PLAYWRIGHT_BASE_URL`, e.g.:
 *
 *   PLAYWRIGHT_BASE_URL=https://invenioprojectcontrols.netlify.app \
 *     npx playwright test
 *
 * For local runs the config auto-starts `npm run dev` (port 5173).
 *
 * First-time setup: `npx playwright install chromium` to download the
 * browser binary (~600MB).
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const isLocal = baseURL.startsWith('http://localhost');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(isLocal && {
    webServer: {
      command: 'npm run dev',
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  }),
});
