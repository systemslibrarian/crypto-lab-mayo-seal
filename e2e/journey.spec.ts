import { expect, test } from '@playwright/test';

/**
 * The guided journey exists to make one claim true: the signature you watch being
 * assembled is the one that gets verified and the one you break. So the tests
 * that matter are the ones that would catch that claim being false — a panel
 * quietly running a different parameter set or a different message.
 */

test('one choice reaches every exhibit on the journey', async ({ page }) => {
  await page.goto('');
  await page.selectOption('#lsn-params', 'MAYO2');
  await page.fill('#lsn-msg', 'one message everywhere');

  // Explore mode hands the per-exhibit controls back, which is also the only way
  // to read what the journey pushed into them.
  await page.click('#lsn-mode');
  for (const id of ['#kg-params', '#whip-params', '#vf-params', '#fg-params']) {
    await expect(page.locator(id), `${id} did not follow the journey`).toHaveValue('MAYO2');
  }
  for (const id of ['#whip-msg', '#vf-msg', '#fg-msg']) {
    await expect(page.locator(id), `${id} did not follow the journey`).toHaveValue('one message everywhere');
  }
});

test('guided mode owns the inputs; explore mode gives them back', async ({ page }) => {
  await page.goto('');
  // One control per value: the journey's copy is showing, the panels' are not.
  await expect(page.locator('#lsn-controls')).toBeVisible();
  await expect(page.locator('#whip-params')).toBeHidden();
  await expect(page.locator('#vf-msg')).toBeHidden();
  await expect(page.locator('#lsn-mode')).toHaveAttribute('aria-pressed', 'false');

  await page.click('#lsn-mode');
  await expect(page.locator('#lsn-controls')).toBeHidden();
  await expect(page.locator('#whip-params')).toBeVisible();
  await expect(page.locator('#vf-msg')).toBeVisible();
  await expect(page.locator('#lsn-mode')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#lsn-mode')).toHaveText('Back to the guided journey');

  await page.click('#lsn-mode');
  await expect(page.locator('#whip-params')).toBeHidden();
});

test('the indicator only marks stages the exhibits actually computed', async ({ page }) => {
  await page.goto('');
  const done = page.locator('#lsn-stages [data-state="done"]');
  await expect(done).toHaveCount(0);

  await page.click('#whip-next');
  await expect(done).toHaveCount(1); // Problem
  await page.click('#whip-run');
  await expect(done).toHaveCount(3); // + Whip, Solve

  await page.click('#vf-adopt');
  await expect(done).toHaveCount(3); // adopting is not verifying
  await page.click('#vf-verify');
  await expect(done).toHaveCount(4); // + Verify

  await page.click('#vf-tamper-sig');
  await expect(done).toHaveCount(5); // + Break
});

test('a rejection with no tampering behind it is not a Break', async ({ page }) => {
  await page.goto('');
  await page.click('#whip-run');
  await page.click('#vf-adopt');
  await page.click('#vf-verify');
  const labels = async () =>
    page.locator('#lsn-stages [data-state="done"] .journey__label').allTextContents();
  expect(await labels()).toEqual(['Problem', 'Whip', 'Solve', 'Verify']);
});

test('the journey carries the walkthrough signature into verification intact', async ({ page }) => {
  await page.goto('');
  await page.fill('#lsn-msg', 'the very same bytes');
  await page.click('#whip-run');
  await page.click('#vf-adopt');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('Adopted the TOY signature');
  await page.click('#vf-verify');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('VALID');
  // The message it was signed over is the journey's, not a panel default.
  await expect(page.locator('#vf-out')).toContainText('the very same bytes');
});

test('Reset progress clears the marks without disturbing the exhibits', async ({ page }) => {
  await page.goto('');
  await page.click('#whip-run');
  await expect(page.locator('#lsn-stages [data-state="done"]')).toHaveCount(3);

  await page.click('#lsn-reset');
  await expect(page.locator('#lsn-stages [data-state="done"]')).toHaveCount(0);
  await expect(page.locator('#lsn-out .verdict')).toContainText('Journey reset');
  // The walkthrough kept its run — only the marks were cleared.
  await expect(page.locator('#whip-beat-state-3')).toHaveText('Done');
});
