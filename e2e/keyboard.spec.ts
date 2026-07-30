/**
 * Keyboard operability and colour-independence, gated the same way the axe scan
 * is. These are the WCAG requirements a static scan cannot check: that the whole
 * demo can be driven from the keyboard with visible focus, and that no state is
 * conveyed by colour alone.
 */
import { expect, test, type Page } from '@playwright/test';

/** Walks Tab through the page and returns what the browser focused, in order. */
async function tabOrder(page: Page, steps: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return 'body';
        const id = el.id ? `#${el.id}` : '';
        return `${el.tagName.toLowerCase()}${id}`;
      }),
    );
  }
  return seen;
}

test('the skip link is the first stop and it reaches the content', async ({ page }) => {
  await page.goto('.');
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toBeVisible();
});

test('every interactive control is reachable by Tab', async ({ page }) => {
  await page.goto('.');
  // Put the page into its fullest state first, so dynamically added controls count.
  await page.click('#kg-run');
  await page.click('#whip-run');
  await page.click('#vf-sign');
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));

  // Only id-bearing controls are checked: an id is a stable focus key, whereas a
  // label derived from text content is not.
  const expected = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#app button, #app select, #app input, #app summary'))
      .filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null && el.id !== '')
      .map((el) => `${el.tagName.toLowerCase()}#${el.id}`),
  );
  expect(expected.length).toBeGreaterThan(20);

  const focusableCount = await page.evaluate(
    () => document.querySelectorAll('a[href], button, select, input, summary, [tabindex]:not([tabindex="-1"])').length,
  );
  const reached = new Set(await tabOrder(page, focusableCount + 10));
  const missing = expected.filter((key) => !reached.has(key));
  expect(missing, `unreachable by keyboard: ${missing.join(', ')}`).toEqual([]);
});

test('focus is always visible', async ({ page }) => {
  await page.goto('.');
  const controls = ['#kg-run', '#kg-params', '#kg-seed', '#whip-next', '#vf-sign', '#fg-guess', '#wv-k', '#kat-run'];
  for (const selector of controls) {
    await page.focus(selector);
    const outline = await page.locator(selector).evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, style: s.outlineStyle, shadow: s.boxShadow };
    });
    const visible = Number.parseFloat(outline.width) > 0 && outline.style !== 'none';
    expect(visible || outline.shadow !== 'none', `${selector} has no visible focus indicator`).toBe(true);
  }
});

test('the whipping figure is operable with the arrow keys and reports in text', async ({ page }) => {
  await page.goto('.');
  await page.focus('#wv-k');
  const before = await page.locator('#wv-readout').textContent();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const after = await page.locator('#wv-readout').textContent();
  expect(after).not.toBe(before);
  // At k = 1 the figure must say, in words, that the system cannot be solved.
  await page.fill('#wv-k', '1');
  await page.dispatchEvent('#wv-k', 'input');
  await expect(page.locator('#wv-readout')).toContainText('Not solvable');
  // And the SVG's own accessible name must carry the same state.
  await expect(page.locator('#wv-figure svg')).toHaveAttribute('aria-label', /too narrow to solve/);
});

test('the demo can be driven from the keyboard alone', async ({ page }) => {
  await page.goto('.');
  await page.focus('#kg-run');
  await page.keyboard.press('Enter');
  await expect(page.locator('#kg-out .verdict').first()).toContainText('keypair derived');

  await page.focus('#whip-next');
  await page.keyboard.press('Enter');
  await expect(page.locator('#whip-state-1')).toHaveText('Done');

  await page.focus('#vf-sign');
  await page.keyboard.press('Enter');
  await page.focus('#vf-verify');
  await page.keyboard.press('Space');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('VALID');

  await page.focus('#fg-oil-nibble');
  await page.keyboard.press('Enter');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('Forgery rejected', { timeout: 30_000 });
});

test('no state is conveyed by colour alone', async ({ page }) => {
  await page.goto('.');
  await page.click('#kg-run');
  await page.click('#whip-run');
  await page.click('#vf-sign');
  await page.click('#vf-verify');
  await page.click('#vf-tamper-sig');
  await page.click('#fg-malformed');
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));

  // Every verdict carries an icon glyph and a worded headline, not just a tint.
  const verdicts = await page.locator('.verdict').all();
  expect(verdicts.length).toBeGreaterThan(3);
  for (const v of verdicts) {
    await expect(v.locator('.verdict__icon')).not.toBeEmpty();
    await expect(v.locator('strong')).not.toBeEmpty();
  }

  // Compare strips: differing cells get a distinct border style and an accessible
  // name, so the distinction survives grayscale and colour blindness.
  const marked = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>('.vec li.is-bad, .vec li.is-ok'));
    return cells.map((el) => ({
      cls: el.className,
      label: el.getAttribute('aria-label') || '',
      borderBottom: getComputedStyle(el).borderBottomStyle,
    }));
  });
  expect(marked.length).toBeGreaterThan(0);
  for (const cell of marked) {
    expect(cell.label, `cell ${cell.cls} has no accessible name`).not.toBe('');
    if (cell.cls.includes('is-bad')) expect(cell.borderBottom).toBe('double');
    else expect(cell.borderBottom).toBe('solid');
  }

  // Every pass/fail row in the malformed battery is worded, not just coloured.
  for (const check of await page.locator('.check').all()) {
    await expect(check.locator('.check__icon')).not.toBeEmpty();
    await expect(check.locator('strong')).toContainText(/refused|rejected|ACCEPTED/);
  }
});
