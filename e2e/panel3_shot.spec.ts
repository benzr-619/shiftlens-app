import { test } from '@playwright/test';
import { NAMED_DEPARTMENT_PARAMS } from '../src/lib/__fixtures__/namedDepartments';
import { seedAndGoToResults } from './seed';

test('panel3 screenshot', async ({ page }) => {
  await seedAndGoToResults(page, NAMED_DEPARTMENT_PARAMS.underTargetDayShort);
  const panel3 = page.locator('#ch-full-coverage');
  await panel3.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await panel3.screenshot({ path: '/tmp/panel3.png' });
});
