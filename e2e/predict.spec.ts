import { expect, test } from '@playwright/test';

/**
 * The prediction checks exist to make the reader commit before the page answers,
 * so the thing worth testing is that a wrong answer is met with a reason rather
 * than a buzz, and that the choice is exposed to assistive tech rather than
 * carried by the border colour.
 */

test('a wrong answer explains the misconception it comes from', async ({ page }) => {
  await page.goto('');
  const out = page.locator('#pr-whip .predict__out');
  await expect(out).toBeEmpty();

  // "The equations grow too" is the misconception the check is aimed at.
  await page.locator('#pr-whip-0').click();
  await expect(out).toContainText('Not quite');
  await expect(out).toContainText('m does not move');
  await expect(page.locator('#pr-whip-0')).toHaveAttribute('aria-pressed', 'true');

  // Options stay live, so the reader can read the reasoning behind the others.
  await page.locator('#pr-whip-1').click();
  await expect(out).toContainText('Correct');
  await expect(out).toContainText('m rows tall and becomes k·o columns wide');
  await expect(page.locator('#pr-whip-0')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#pr-whip-1')).toHaveAttribute('aria-pressed', 'true');
});

test('the threshold check refuses the "impossible" framing', async ({ page }) => {
  await page.goto('');
  // Priority 0 corrected this claim in the page copy; the check guards the same
  // line, since "cannot sign at all" is the intuition a reader arrives with.
  await page.locator('#pr-threshold-0').click();
  const out = page.locator('#pr-threshold .predict__out');
  await expect(out).toContainText('Not quite');
  await expect(out).toContainText('Improbable, not impossible');

  await page.locator('#pr-threshold-1').click();
  await expect(out).toContainText('Correct');
});

test('the salt check matches what the verifier actually does', async ({ page }) => {
  await page.goto('');
  // t is hashed from digest || salt; P*(s) never sees the salt.
  await page.locator('#pr-salt-0').click();
  await expect(page.locator('#pr-salt .predict__out')).toContainText('Correct');
  await page.locator('#pr-salt-2').click();
  await expect(page.locator('#pr-salt .predict__out')).toContainText('Not quite');
});

test('every check is answerable by keyboard and reports without colour', async ({ page }) => {
  await page.goto('');
  const first = page.locator('#pr-threshold-0');
  await first.focus();
  await page.keyboard.press('Enter');

  const out = page.locator('#pr-threshold .predict__out');
  // verdict() carries an icon and a worded headline, so the result survives
  // grayscale — the same contract the colour-alone gate checks page-wide.
  await expect(out.locator('.verdict__icon')).not.toBeEmpty();
  await expect(out.locator('strong')).toHaveText('Not quite');
  await expect(out).toHaveAttribute('aria-live', 'polite');
});
