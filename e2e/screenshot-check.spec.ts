import { test } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

test('screenshot panel5 heading spacing', async ({ page }) => {
  const profile = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus;
  await seedAndGoToResults(page, profile);
  await page.locator('#ch-sandbox').scrollIntoViewIfNeeded();
  await page.locator('#ch-sandbox').screenshot({ path: 'e2e/screenshots/panel5-caveat-check.png' });
});
