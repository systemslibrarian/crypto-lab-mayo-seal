import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  await page.locator('#lsn-mode').click();
  await expect(page.locator('#lsn-mode')).toHaveAttribute('aria-pressed', 'true');
});

test('round-2 level labels and research status qualify the size comparison', async ({ page }) => {
  for (const name of ['MAYO1', 'MAYO2', 'MAYO3', 'MAYO5']) {
    await expect(page.locator(`#kg-params option[value="${name}"]`)).toContainText('round-2 claimed NIST level');
  }
  const status = page.locator('#mayo-research-status');
  await expect(status).toBeVisible();
  await expect(status).toContainText('128 bits');
  await expect(status).toContainText('143-bit');
  await expect(status).toContainText('heuristic estimates in a preprint');
  await expect(status.locator('a')).toHaveAttribute('href', 'https://eprint.iacr.org/2026/2247');
  // A real parameter set must retain the qualification in the generated output.
  await page.locator('#kg-params').selectOption('MAYO1');
  await page.locator('#kg-run').click();
  await expect(page.locator('#kg-out')).toContainText('Round-2 claimed NIST security level 1');
});

test('a measured guessing run reports a baseline rather than a security bound', async ({ page }) => {
  await page.locator('#fg-params').selectOption('MAYO1');
  await page.locator('#fg-guess').click();
  await expect(page.locator('#fg-out')).toContainText('random-guess baseline');
  await expect(page.locator('#fg-out')).toContainText('not the best-known forgery cost');
});
