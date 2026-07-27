import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

// PR A0 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — the smoke spec every named profile (A-H)
// must clear before any panel-specific spec is trusted. Console-error-free is a HARD
// assertion here, not a warning (spec's own instruction) — it is the check that has caught
// the most in this repo's history per every "verified end-to-end" note in .claude/rules/.

const PROFILES = Object.entries(NAMED_DEPARTMENT_PARAMS);

for (const [name, params] of PROFILES) {
  test(`results page renders cleanly — profile ${name}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await seedAndGoToResults(page, params);

    // The results screen must actually be showing (not stuck on welcome/setup).
    await expect(page.locator('.dashboard-screen')).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('NaN');
    expect(bodyText).not.toContain('undefined');
    expect(bodyText).not.toContain('{{');

    expect(consoleErrors, `console errors for profile ${name}:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `uncaught page errors for profile ${name}:\n${pageErrors.join('\n')}`).toEqual([]);

    await page.screenshot({ path: `e2e/screenshots/smoke-${name}.png`, fullPage: true });
  });
}
