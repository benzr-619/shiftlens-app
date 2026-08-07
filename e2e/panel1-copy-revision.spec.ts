import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

// PANEL1_COPY_REVISION_SPEC_2026-07-28.md verification checklist — a Playwright screenshot
// review of Panel 1 in both states (current staffing entered / absent), confirming the
// "Effective WHPPV" and "Boarding" toggles are gone (two toggles remain: Arrivals,
// Arrivals + Boarding — renamed from "Combined" 2026-07-30), the per-shift diagnostic renders
// for both a 2-shift and a 3-shift overlapping menu, and the heatmap's split-shift cells + new
// legend render together correctly.

const THREE_SHIFT = NAMED_DEPARTMENT_PARAMS.underTargetDayShort; // 3x12, boarding present
const TWO_SHIFT = NAMED_DEPARTMENT_PARAMS.adequatelyStaffedBadlyShaped; // 2x12, boarding present

test('Panel 1 with current staffing entered (3-shift menu): two toggles, per-shift sentences, split-shift heatmap cells', async ({ page }) => {
  await seedAndGoToResults(page, THREE_SHIFT);
  const panel1 = page.locator('#ch-current-staffing');
  await expect(panel1).toBeVisible();

  // Exactly two toggles remain — Arrivals, Arrivals + Boarding — no bare "Boarding", no
  // "Effective WHPPV". `exact: true` on 'Arrivals' since 'Arrivals + Boarding' would otherwise
  // also match a substring lookup.
  await expect(panel1.getByRole('tab', { name: 'Arrivals', exact: true })).toBeVisible();
  await expect(panel1.getByRole('tab', { name: 'Boarding', exact: true })).toHaveCount(0);
  await expect(panel1.getByRole('tab', { name: 'Arrivals + Boarding' })).toBeVisible();
  await expect(panel1.getByRole('tab', { name: 'Effective WHPPV' })).toHaveCount(0);

  // Legend: no old three-swatch leaner/typical/richer row.
  await expect(panel1.locator('.heat-legend-band')).toHaveCount(0);
  await expect(panel1.locator('.heat-legend-line').first()).toContainText('split by shift when more than one covers that hour');

  const bodyText = await panel1.innerText();
  expect(bodyText).not.toContain('running within the peer band');
  expect(bodyText).not.toContain('Of the nursing time per visit you staff');
  expect(bodyText).not.toContain("nurses do not let a line form");

  await page.screenshot({ path: 'e2e/screenshots/panel1-copy-revision-current-3shift.png', fullPage: true });
});

test('Panel 1 with current staffing entered (2-shift Day/Night menu) renders the per-shift diagnostic sensibly', async ({ page }) => {
  await seedAndGoToResults(page, TWO_SHIFT);
  const panel1 = page.locator('#ch-current-staffing');
  await expect(panel1).toBeVisible();
  await expect(panel1.getByRole('tab', { name: 'Effective WHPPV' })).toHaveCount(0);
  await page.screenshot({ path: 'e2e/screenshots/panel1-copy-revision-current-2shift.png', fullPage: true });
});

test('Panel 1 with no current staffing shows the CTA and nothing referencing removed content', async ({ page }) => {
  await seedAndGoToResults(page, { ...THREE_SHIFT, currentStaffingRatio: 0 });
  const panel1 = page.locator('#ch-current-staffing');
  await expect(panel1).toBeVisible();
  await expect(panel1.getByText('Add what you actually staff today')).toBeVisible();
  await expect(panel1.getByRole('tab')).toHaveCount(0);
  await expect(panel1.locator('.whppv-heatmap')).toHaveCount(0);

  await page.screenshot({ path: 'e2e/screenshots/panel1-copy-revision-absent.png', fullPage: true });
});
