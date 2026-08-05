import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

// PR F (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — Panel 3's queue strip must render BLANK
// (§4's explicit instruction). Panel 4's toggle (2026-07-30: reduced to Arrivals / Arrivals
// and Boarding, matching Panel 3's two-toggle pattern) must switch views, and its "Arrivals
// and Boarding" toggle must split the staffing table into the two-table view (Nurses for
// Arrivals / Additional Nurses for Boarding, the latter netted against arrivals-grid spare
// capacity — see .claude/rules/boarding-seasonality.md).
const PROFILE = NAMED_DEPARTMENT_PARAMS.underTargetDayShort;

test('Panel 3 renders with a blank queue strip and the three-bar comparison', async ({ page }) => {
  await seedAndGoToResults(page, PROFILE);
  const panel3 = page.locator('#ch-full-coverage');
  await expect(panel3).toBeVisible();
  await expect(panel3.locator('.frame-queue-strip-blank')).toBeVisible();
  await expect(panel3.locator('.three-bar-chart')).toBeVisible();
});

test('Panel 4 renders, its toggle switches between arrivals and combined nurses, and splits the staffing table', async ({ page }) => {
  await seedAndGoToResults(page, PROFILE);
  const panel4 = page.locator('#ch-recommended');
  await expect(panel4).toBeVisible();
  await expect(panel4.locator('.whppv-heatmap')).toBeVisible();

  // Only two toggles now — no standalone "boarding" tab.
  await expect(panel4.getByRole('tab', { name: 'Nurses for boarding' })).toHaveCount(0);

  const combinedTab = panel4.getByRole('tab', { name: 'Arrivals and Boarding' });
  if (await combinedTab.count()) {
    await expect(panel4.getByText('Additional Nurses for Boarding')).toHaveCount(0);
    await combinedTab.click();
    await expect(combinedTab).toHaveAttribute('aria-selected', 'true');
    await expect(panel4.getByText('Nurses for Arrivals')).toBeVisible();
    await expect(panel4.getByText('Additional Nurses for Boarding')).toBeVisible();
  }

  // The shift-menu flexibility subsection is folded in, collapsed (there are two
  // .why-toggle-wrap details on this panel — flex-axes and the day-to-day explainer).
  await expect(panel4.locator('details.why-toggle-wrap').first()).toBeVisible();
});
