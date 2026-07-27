import type { Page } from '@playwright/test';
import type { SyntheticDepartmentParams } from '../src/lib/__fixtures__/syntheticDepartment';

/**
 * Loads a named synthetic-department profile straight into the store via the dev-only
 * `window.__shiftlensSeed` hook (src/lib/testSeed.ts) and lands on the results page — no
 * stepping through setup. Shared by every e2e spec so no test hand-builds a department.
 */
export async function seedAndGoToResults(page: Page, params: SyntheticDepartmentParams): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__shiftlensSeed === 'function');
  await page.evaluate((p) => window.__shiftlensSeed!(p), params);
}

declare global {
  interface Window {
    __shiftlensSeed?: (params: SyntheticDepartmentParams) => void;
  }
}
