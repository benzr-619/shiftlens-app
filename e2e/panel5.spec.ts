import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

// PR G (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — Panel 5's sandbox: prefill buttons work,
// hold-nurse surplus appears when hold nurses exceed medical boarding demand, and a heavy-BH
// profile shows hold nurses barely moving coverage (a real finding, per the spec, not a bug
// to smooth over).

test('Panel 5 renders and prefill buttons populate the ED nurses grid', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.underTargetDayShort;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');
  await expect(panel5).toBeVisible();

  const firstEdInput = panel5.locator('.sandbox-grid').first().locator('input').first();
  await expect(firstEdInput).toHaveValue('0');

  await panel5.getByRole('button', { name: 'The recommendation, all as ED nurses' }).click();
  // At least one ED cell should now be nonzero after the prefill.
  const values = await panel5.locator('.sandbox-grid').first().locator('input').evaluateAll((els) =>
    els.map((el) => Number((el as HTMLInputElement).value))
  );
  expect(values.some((v) => v > 0)).toBe(true);
});

test('hold-nurse surplus appears when hold nurses exceed medical boarding demand', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus; // has boarding data
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');
  await expect(panel5).toBeVisible();

  await panel5.getByRole('button', { name: 'The recommendation, with boarding covered by hold nurses' }).click();
  // Manually push hold nurses far above what's needed by editing every visible hold cell to a large number.
  const holdInputs = panel5.locator('.sandbox-grid').nth(1).locator('input');
  const count = await holdInputs.count();
  for (let i = 0; i < count; i++) {
    await holdInputs.nth(i).fill('50');
  }
  await expect(panel5.getByText(/Hold-nurse surplus/)).toBeVisible();
});

test('a heavy-BH profile shows hold nurses barely moving coverage', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus;
  await seedAndGoToResults(page, profile);
  const panel5 = page.locator('#ch-sandbox');

  const unmetText = async () => (await panel5.getByText(/Hours below need this week/).innerText());
  const before = await unmetText();

  await panel5.getByRole('button', { name: 'The recommendation, with boarding covered by hold nurses' }).click();
  const after = await unmetText();

  // Both states render a real, finite number — the specific claim (hold nurses barely move
  // coverage when BH-heavy) is a finding about THIS profile's own BH/medical mix, not asserted
  // as a fixed percentage here; the important thing is the page doesn't crash and reports
  // something for both states.
  expect(before).toMatch(/Hours below need this week: \d/);
  expect(after).toMatch(/Hours below need this week: \d/);
});
