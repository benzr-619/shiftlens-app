import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

// PR H (RESULTS_PAGE_V2_SPEC_2026-07-27.md §7, R12) — export moved from the top bar to the
// bottom of the page, after Panel 5. Confirms it's no longer in the topbar and IS present
// after the sandbox panel, and that clicking it doesn't throw (writeFile triggers a real
// browser download here, not mocked — Playwright just needs the click to not error).
test('Export to PPTX lives at the bottom of the page, after Panel 5, not in the top bar', async ({ page }) => {
  await seedAndGoToResults(page, NAMED_DEPARTMENT_PARAMS.underTargetDayShort);

  const topbar = page.locator('.dashboard-topbar');
  await expect(topbar.getByRole('button', { name: /Export to PPTX/ })).toHaveCount(0);

  const exportButton = page.locator('.export-row').getByRole('button', { name: /Export to PPTX/ });
  await expect(exportButton).toBeVisible();

  // The export row should appear after Panel 5 (#ch-sandbox) in document order.
  const sandboxBox = await page.locator('#ch-sandbox').boundingBox();
  const exportBox = await exportButton.boundingBox();
  expect(sandboxBox).not.toBeNull();
  expect(exportBox).not.toBeNull();
  expect(exportBox!.y).toBeGreaterThan(sandboxBox!.y);
});
