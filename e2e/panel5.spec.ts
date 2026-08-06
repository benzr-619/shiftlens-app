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
  // 2026-08-05: the old "Hours below need this week" aggregate was replaced by the same
  // per-shift diagnostic Panel 1/2/4 show (shiftDiagnosticSentence) — assert one of its two
  // sentence shapes renders instead.
  await expect(panel5.getByText(/nursing hours (short|ahead) of arrivals demand alone|for arrivals\./).first()).toBeVisible();
});

test('a heavy-BH profile shows a real, finite per-shift diagnostic in both toggle states', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');

  const diagnosticPattern = /nursing hours (short|ahead) of arrivals demand alone|for arrivals\./;
  const diagnosticText = async () => panel5.getByText(diagnosticPattern).first().innerText();
  const before = await diagnosticText();

  await panel5.getByRole('tab', { name: 'Arrivals + Boarding' }).click();
  await panel5.getByRole('button', { name: 'ShiftLens Solver Staffing (Hold Nurses for Boarding)' }).click();
  const after = await diagnosticText();

  // Both states render real, finite per-shift sentences — the specific claim (hold nurses
  // barely move coverage when BH-heavy) is a finding about THIS profile's own BH/medical mix,
  // not asserted as fixed text here; the important thing is the page doesn't crash and reports
  // something sensible for both states.
  expect(before).toMatch(diagnosticPattern);
  expect(after).toMatch(diagnosticPattern);
  expect(before).not.toContain('NaN');
  expect(after).not.toContain('NaN');
});

async function sumDiffMain(scope: import('@playwright/test').Locator, tableIndex: number): Promise<number> {
  const values = await scope.locator('table.diff-grid').nth(tableIndex).locator('.diff-main').allTextContents();
  return values.reduce((total, text) => total + Number(text.replace('+', '')), 0);
}

async function sumSandboxGrid(panel5: import('@playwright/test').Locator, gridIndex: number): Promise<number> {
  const values = await panel5
    .locator('.sandbox-grid')
    .nth(gridIndex)
    .locator('input')
    .evaluateAll((els) => els.map((el) => Number((el as HTMLInputElement).value)));
  return values.reduce((a, b) => a + b, 0);
}

test('"All ED Nurses" is exactly Panel 4\'s two tables added together; "Hold Nurses for Boarding" exactly recreates them split across pools', async ({
  page,
}) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus;
  await seedAndGoToResults(page, profile);

  const panel4 = page.locator('#ch-recommended');
  await panel4.getByRole('tab', { name: 'Arrivals and Boarding' }).click();
  // Table 0 = "Nurses for Arrivals" (result.grid), table 1 = "Additional Nurses for Boarding"
  // (the arrivals-spare-netted recommendation) — see Panel4.tsx's own render order.
  const arrivalsTotal = await sumDiffMain(panel4, 0);
  const boardingTotal = await sumDiffMain(panel4, 1);
  expect(arrivalsTotal).toBeGreaterThan(0);
  expect(boardingTotal).toBeGreaterThan(0);

  const panel5 = page.locator('#ch-sandbox');
  await panel5.getByRole('tab', { name: 'Arrivals + Boarding' }).click();

  await panel5.getByRole('button', { name: 'ShiftLens Solver Staffing (All ED Nurses)' }).click();
  const allEdTotal = await sumSandboxGrid(panel5, 0);
  expect(allEdTotal).toBe(arrivalsTotal + boardingTotal);

  await panel5.getByRole('button', { name: 'ShiftLens Solver Staffing (Hold Nurses for Boarding)' }).click();
  const edTotal = await sumSandboxGrid(panel5, 0);
  const holdTotal = await sumSandboxGrid(panel5, 1);
  expect(edTotal).toBe(arrivalsTotal);
  expect(holdTotal).toBe(boardingTotal);
});
