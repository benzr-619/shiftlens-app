import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

// Panel 5 redesign (2026-08-05) — an Arrivals / Arrivals + Boarding toggle now drives every
// stat/curve/starting-point/grid on the panel; the hold-nurse grid and its shift-restriction
// checkboxes only exist under Arrivals + Boarding.

test('Panel 5 defaults to Arrivals — only the ED grid is mounted, hold grid absent', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.underTargetDayShort;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');
  await expect(panel5).toBeVisible();

  await expect(panel5.locator('.sandbox-grid')).toHaveCount(1);
  await expect(panel5.getByRole('button', { name: 'Current Staffing', exact: true })).toBeVisible();
  await expect(panel5.getByRole('button', { name: 'Re-allocated Current Staffing' })).toBeVisible();
  await expect(panel5.getByRole('button', { name: 'ShiftLens Solver Staffing', exact: true })).toBeVisible();
  await expect(panel5.getByText('Which shifts can hold nurses work?')).toHaveCount(0);
});

test('switching to Arrivals + Boarding mounts the hold grid, checkboxes, and hold-specific starting points', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');
  await expect(panel5).toBeVisible();

  await panel5.getByRole('tab', { name: 'Arrivals + Boarding' }).click();

  await expect(panel5.locator('.sandbox-grid')).toHaveCount(2);
  await expect(panel5.getByText('Which shifts can hold nurses work?')).toBeVisible();
  await expect(panel5.getByRole('button', { name: 'ShiftLens Solver Staffing (All ED Nurses)' })).toBeVisible();
  await expect(panel5.getByRole('button', { name: 'ShiftLens Solver Staffing (Hold Nurses for Boarding)' })).toBeVisible();
});

test('prefill buttons populate the ED nurses grid under Arrivals', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.underTargetDayShort;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');
  await expect(panel5).toBeVisible();

  const firstEdInput = panel5.locator('.sandbox-grid').first().locator('input').first();
  await expect(firstEdInput).toHaveValue('0');

  await panel5.getByRole('button', { name: 'ShiftLens Solver Staffing', exact: true }).click();
  const values = await panel5
    .locator('.sandbox-grid')
    .first()
    .locator('input')
    .evaluateAll((els) => els.map((el) => Number((el as HTMLInputElement).value)));
  expect(values.some((v) => v > 0)).toBe(true);
});

test('unchecking a hold-shift checkbox disables that column in the hold grid', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');
  await panel5.getByRole('tab', { name: 'Arrivals + Boarding' }).click();

  const firstCheckbox = panel5.locator('.flex-axis-option input[type="checkbox"]').first();
  await expect(firstCheckbox).toBeChecked();
  await firstCheckbox.uncheck();

  const holdGrid = panel5.locator('.sandbox-grid').nth(1);
  const firstColumnInputs = holdGrid.locator('tbody tr td:nth-child(2) input');
  const count = await firstColumnInputs.count();
  for (let i = 0; i < count; i++) {
    await expect(firstColumnInputs.nth(i)).toBeDisabled();
    await expect(firstColumnInputs.nth(i)).toHaveValue('0');
  }
});

test('hold-nurse surplus appears when hold nurses exceed medical boarding demand', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus; // has boarding data
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');
  await panel5.getByRole('tab', { name: 'Arrivals + Boarding' }).click();

  await panel5.getByRole('button', { name: 'ShiftLens Solver Staffing (Hold Nurses for Boarding)' }).click();
  // Manually push hold nurses far above what's needed by editing every visible (enabled) hold cell.
  const holdInputs = panel5.locator('.sandbox-grid').nth(1).locator('input:not([disabled])');
  const count = await holdInputs.count();
  for (let i = 0; i < count; i++) {
    await holdInputs.nth(i).fill('50');
  }
  await expect(panel5.getByText(/Hold-nurse surplus/)).toBeVisible();
});

test('the live % demand covered curve renders and reflects the current scenario', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.underTargetDayShort;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');
  await expect(panel5.locator('.marginal-curve-chart')).toBeVisible();
  // A live dot exists (the marker circle), labeled "Your scenario" in the legend.
  await expect(panel5.locator('.marginal-curve-legend').getByText('Your scenario', { exact: true })).toBeVisible();

  await panel5.getByRole('button', { name: 'ShiftLens Solver Staffing', exact: true }).click();
  await expect(panel5.getByText(/Hours below need this week: \d/)).toBeVisible();
});

test('a heavy-BH profile shows a real, finite result in both toggle states', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');

  const unmetText = async () => panel5.getByText(/Hours below need this week/).innerText();
  const before = await unmetText();

  await panel5.getByRole('tab', { name: 'Arrivals + Boarding' }).click();
  await panel5.getByRole('button', { name: 'ShiftLens Solver Staffing (Hold Nurses for Boarding)' }).click();
  const after = await unmetText();

  // Both states render a real, finite number — the specific claim (hold nurses barely move
  // coverage when BH-heavy) is a finding about THIS profile's own BH/medical mix, not asserted
  // as a fixed percentage here; the important thing is the page doesn't crash and reports
  // something for both states.
  expect(before).toMatch(/Hours below need this week: \d/);
  expect(after).toMatch(/Hours below need this week: \d/);
});
