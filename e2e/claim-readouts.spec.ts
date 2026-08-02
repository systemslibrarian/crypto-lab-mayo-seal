import { expect, test } from '@playwright/test';

test('the malformed battery reports measured outcomes and a verified genuine control', async ({ page }) => {
  await page.goto('');
  await page.click('#fg-malformed');

  const out = page.locator('#fg-out');
  await expect(out.locator('.check')).toHaveCount(4);
  await expect(out).toContainText('2 are refused on shape');
  await expect(out).toContainText('2 run the full comparison and fail it');
  await expect(out).toContainText('genuine signature for the same message was checked too and verified');
});

test('the precondition panel identifies its fixed E-power samples as deterministic', async ({ page }) => {
  await page.goto('');
  await page.click('#pc-run');

  const out = page.locator('#pc-out');
  await expect(out).toContainText('3 deterministic combinations');
  await expect(out).not.toContainText('random combinations');
});
