import { expect, test } from '@playwright/test';

/**
 * Exhibit 2's default path is three conceptual beats, with the five spec
 * operations behind a disclosure. The risk in that split is drift: two views of
 * what is meant to be one signature, quietly disagreeing. These tests pin the
 * split and the shared state machine.
 */

test('the default path is three beats and the spec steps start collapsed', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('#whip-beats .beat')).toHaveCount(3);
  await expect(page.locator('#whip-beats')).toContainText('One copy misses');
  await expect(page.locator('#whip-beats')).toContainText('Whipping adds room');
  await expect(page.locator('#whip-beats')).toContainText('Solve and check');

  // Available, but not in the way.
  const full = page.locator('#whip-full');
  await expect(full).not.toHaveAttribute('open', '');
  // Direct child: the steps render their own nested disclosures once run.
  await expect(full.locator('> summary')).toHaveText('Show the full signing algorithm');
  await expect(page.locator('#whip-steps .step')).toHaveCount(5);
});

test('Step forward advances a beat and carries its spec steps with it', async ({ page }) => {
  await page.goto('');
  const state = (n: number) => page.locator(`#whip-beat-state-${n}`);

  await page.click('#whip-next');
  await expect(state(1)).toHaveText('Done');
  await expect(state(2)).toHaveText('Waiting');
  // Beat 1 covers spec steps 1 and 2, so both must have filled in beneath it.
  await expect(page.locator('#whip-state-1')).toHaveText('Done');
  await expect(page.locator('#whip-state-2')).toHaveText('Done');
  await expect(page.locator('#whip-state-3')).toHaveText('Waiting');

  await page.click('#whip-next');
  await expect(state(2)).toHaveText('Done');
  await expect(page.locator('#whip-state-3')).toHaveText('Done');

  await page.click('#whip-next');
  await expect(state(3)).toHaveText('Done');
  await expect(page.locator('#whip-state-5')).toHaveText('Done');
  await expect(page.locator('#whip-next')).toBeDisabled();
  await expect(page.locator('#whip-next')).toHaveText('All beats shown');
});

test('the beats report the same run as the steps behind them', async ({ page }) => {
  await page.goto('');
  await page.click('#whip-run');

  // Beat 1: one copy is short by exactly m - o, and says so without a matrix.
  const beat1 = page.locator('#whip-beat-body-1');
  await expect(beat1).toContainText('6'); // TOY: m = 6
  await expect(beat1).toContainText('3'); // TOY: o = 3
  await expect(beat1.locator('.verdict')).toContainText('No solution');
  await expect(beat1.locator('table')).toHaveCount(0);

  // Beat 2: width moved, height did not.
  await expect(page.locator('#whip-beat-body-2')).toContainText('3 unknowns became 9, and m stayed at 6');

  // Beat 3 and spec step 5 are the same check on the same signature.
  await expect(page.locator('#whip-beat-body-3 .verdict')).toContainText('P*(s) = t');
  await expect(page.locator('#whip-body-5 .verdict').first()).toContainText('P*(s) = t');
});

test('Reset clears the beats as well as the steps', async ({ page }) => {
  await page.goto('');
  await page.click('#whip-run');
  await expect(page.locator('#whip-beat-state-3')).toHaveText('Done');

  await page.click('#whip-reset');
  await expect(page.locator('#whip-beat-state-1')).toHaveText('Waiting');
  await expect(page.locator('#whip-beat-body-1')).toBeEmpty();
  await expect(page.locator('#whip-beat-body-3')).toBeEmpty();
  await expect(page.locator('#whip-state-5')).toHaveText('Waiting');
  await expect(page.locator('#whip-next')).toBeEnabled();
});
