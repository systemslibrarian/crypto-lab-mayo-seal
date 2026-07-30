import { expect, test } from '@playwright/test';

/**
 * The whipping figure prints two things the maths has to keep honest: a retry
 * figure, and a note explaining why the slider stops where it does. Both were
 * wrong in ways that only showed at the ends of the slider's range, so drive it
 * to the ends rather than trusting the shipped k.
 */

/** Set the range input to a value and let the figure re-render. */
async function setK(page: import('@playwright/test').Page, k: number): Promise<void> {
  const slider = page.locator('#wv-k');
  await slider.evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, k);
}

test('the retry figure is always a number, never 2^Infinity', async ({ page }) => {
  await page.goto('');
  // MAYO2 at k = 6 is the largest figure any stop can reach, and the exact stop
  // where the old 1 − product form underflowed to a printed "2^Infinity".
  await page.locator('#wv-params').selectOption('MAYO2');
  await setK(page, 6);

  const readout = page.locator('#wv-readout');
  await expect(readout).toContainText('Room to spare');
  await expect(readout).not.toContainText('Infinity');
  await expect(readout).not.toContainText('too small for this page to print');
  // power() also emits an sr-only reading, which is the exact-match-friendly form.
  await expect(readout).toContainText('2 to the power 156');
});

test('the slider never offers a whipping factor MAYO cannot build', async ({ page }) => {
  await page.goto('');
  await page.locator('#wv-params').selectOption('TOY');

  // The toy set has m = 6, so k(k+1)/2 <= 6 caps k at 3 — the same k it ships.
  // Without the cap the slider ran to k + 2 = 5 and offered k = 4 and 5, which
  // MAYO cannot build.
  await expect(page.locator('#wv-k')).toHaveAttribute('max', '3');
  // Here the ceiling and the smallest-k-with-room are the same k, and that is
  // the more useful thing to say, so the note stays on the shipped-k message.
  await setK(page, 3);
  await expect(page.locator('#wv-readout')).toContainText('the k that TOY ships');

  // MAYO2's window fits well inside its ceiling of 10, so nothing is clipped.
  await page.locator('#wv-params').selectOption('MAYO2');
  await expect(page.locator('#wv-k')).toHaveAttribute('max', '6');
});

test('the size trade shows both halves, and only the cost half moves with k', async ({ page }) => {
  await page.goto('');
  await page.locator('#wv-params').selectOption('MAYO1');
  const trade = page.locator('#wv-trade');

  // Classic UOV at m = 78 needs o = 78, which is what makes its key enormous.
  await expect(trade).toContainText('1.4 KB');
  await expect(trade).toContainText('85× smaller');
  await expect(trade).toContainText('117 KB');

  await setK(page, 10);
  await expect(trade).toContainText('454 B');
  await setK(page, 12);
  // The signature grows by ceil(n/2) = 43 B per copy...
  await expect(trade).toContainText('540 B');
  // ...while the public key, set by o, does not move at all.
  await expect(trade).toContainText('1.4 KB');
  await expect(trade).toContainText('85× smaller');
});

test('MAYO1 explains the E-matrix ceiling when the slider reaches it', async ({ page }) => {
  await page.goto('');
  await page.locator('#wv-params').selectOption('MAYO1');
  // MAYO1 ships k = 10 and its ceiling is exactly 12: k(k+1)/2 = 78 = m, so the
  // last stop consumes every E matrix the field can supply.
  await expect(page.locator('#wv-k')).toHaveAttribute('max', '12');

  await setK(page, 12);
  await expect(page.locator('#wv-readout')).toContainText(
    'k = 12 is as far as MAYO1 can go',
  );
  await expect(page.locator('#wv-readout')).toContainText('only m = 78 exist');
});
