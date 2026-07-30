import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

// PR E (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — Panel 1 and Panel 2's own specs: the panel
// renders, its toggle switches views, and the shared frame's three elements are all present.
const PROFILE = NAMED_DEPARTMENT_PARAMS.underTargetDayShort;

test('Panel 1 renders, its toggle switches views, and the frame shows all three elements', async ({ page }) => {
  await seedAndGoToResults(page, PROFILE);
  const panel1 = page.locator('#ch-current-staffing');
  await expect(panel1).toBeVisible();
  await expect(panel1.locator('.frame-demand-chart')).toBeVisible();
  await expect(panel1.locator('.frame-queue-strip')).toBeVisible();
  await expect(panel1.locator('.whppv-heatmap')).toBeVisible();

  // PANEL1_COPY_REVISION_SPEC_2026-07-28.md §6 — the "Effective wHPPV" toggle is dropped;
  // 2026-07-30 — the "Boarding" toggle is also dropped, and the remaining "Combined" toggle
  // is renamed "Arrivals + Boarding" (matching Panels 2/3). Panel 1 keeps exactly two toggles:
  // Arrivals, Arrivals + Boarding.
  const effectiveToggle = panel1.getByRole('tab', { name: 'Effective wHPPV' });
  await expect(effectiveToggle).toHaveCount(0);

  const boardingToggle = panel1.getByRole('tab', { name: 'Boarding', exact: true });
  await expect(boardingToggle).toHaveCount(0);

  const combinedToggle = panel1.getByRole('tab', { name: 'Arrivals + Boarding' });
  await combinedToggle.click();
  await expect(combinedToggle).toHaveAttribute('aria-selected', 'true');
});

test('Panel 2 renders, its toggle switches views and updates the left-column stats', async ({ page }) => {
  await seedAndGoToResults(page, PROFILE);
  const panel2 = page.locator('#ch-scenario-b');
  await expect(panel2).toBeVisible();
  await expect(panel2.locator('.frame-demand-chart')).toBeVisible();
  await expect(panel2.locator('.whppv-heatmap')).toBeVisible();

  const currentTab = panel2.getByRole('tab', { name: 'Current' });
  const arrivalsTab = panel2.getByRole('tab', { name: 'Arrivals', exact: true });
  await expect(currentTab).toHaveAttribute('aria-selected', 'true');

  const statBefore = await panel2.locator('p').first().innerText();
  await arrivalsTab.click();
  await expect(arrivalsTab).toHaveAttribute('aria-selected', 'true');
  const statAfter = await panel2.locator('p').first().innerText();
  expect(statAfter).not.toBe(statBefore);
});
