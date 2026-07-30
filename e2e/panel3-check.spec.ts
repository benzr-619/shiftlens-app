import { test, expect } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from '../e2e/seed';

test('panel3 visual check', async ({ page }) => {
  await seedAndGoToResults(page, NAMED_DEPARTMENT_PARAMS.underTargetDayShort);
  const panel3 = page.locator('#ch-full-coverage');
  await panel3.scrollIntoViewIfNeeded();
  await expect(panel3.getByRole('tab', { name: 'Arrivals', exact: true })).toBeVisible();
  await expect(panel3.getByRole('tab', { name: 'Arrivals + Boarding' })).toBeVisible();
  await page.screenshot({ path: '/tmp/panel3-combined.png', clip: await panel3.boundingBox() ?? undefined });
  await panel3.getByRole('tab', { name: 'Arrivals', exact: true }).click();
  await page.screenshot({ path: '/tmp/panel3-arrivals.png', clip: await panel3.boundingBox() ?? undefined });
});
