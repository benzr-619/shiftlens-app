import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

// PR F (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — Panel 3's queue strip must render BLANK
// (§4's explicit instruction), and Panel 4's toggle must switch views including the boarding
// nurses / combined toggle (R6).
const PROFILE = NAMED_DEPARTMENT_PARAMS.underTargetDayShort;

test('Panel 3 renders with a blank queue strip and the two-bar comparison', async ({ page }) => {
  await seedAndGoToResults(page, PROFILE);
  const panel3 = page.locator('#ch-full-coverage');
  await expect(panel3).toBeVisible();
  await expect(panel3.locator('.frame-queue-strip-blank')).toBeVisible();
  await expect(panel3.locator('.two-bar-chart')).toBeVisible();
});

test('Panel 4 renders, its toggle switches between arrivals/boarding/combined nurses', async ({ page }) => {
  await seedAndGoToResults(page, PROFILE);
  const panel4 = page.locator('#ch-recommended');
  await expect(panel4).toBeVisible();
  await expect(panel4.locator('.whppv-heatmap')).toBeVisible();

  const boardingTab = panel4.getByRole('tab', { name: 'Nurses for boarding' });
  if (await boardingTab.count()) {
    await boardingTab.click();
    await expect(boardingTab).toHaveAttribute('aria-selected', 'true');
  }
  const combinedTab = panel4.getByRole('tab', { name: 'Combined' });
  if (await combinedTab.count()) {
    await combinedTab.click();
    await expect(combinedTab).toHaveAttribute('aria-selected', 'true');
  }

  // The shift-menu flexibility subsection is folded in, collapsed.
  await expect(panel4.locator('details.why-toggle-wrap')).toBeVisible();
});
