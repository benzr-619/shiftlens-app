import { defineConfig } from 'vitest/config';

// PR A0 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — vitest's default include glob
// (`**/*.{test,spec}.ts`) would otherwise also pick up the new `e2e/*.spec.ts` Playwright
// specs, which don't run under vitest's environment at all. Exclude `e2e/` explicitly so
// `npm test` and `npm run test:e2e` stay two clearly separate suites.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
