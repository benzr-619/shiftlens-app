import { defineConfig, devices } from '@playwright/test';

// PR A0 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — the first committed browser-test harness
// in this repo. Chromium only, desktop viewport, per the spec's explicit scope (a narrow-
// viewport stack is acceptable elsewhere in the app but is not a gate — see §6). See
// .claude/rules/synthetic-fixtures.md's "No Playwright harness exists" section, now stale —
// update it in the same PR.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
