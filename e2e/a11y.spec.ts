import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function freeze(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important}`,
  });
}

async function openEverything(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => (d.open = true));
    document.querySelectorAll<HTMLElement>('[hidden]').forEach((el) => el.removeAttribute('hidden'));
  });
}

async function scan(page: Page, label: string): Promise<void> {
  // Deep readouts live behind disclosures; open them all first, because an
  // unscanned state is an ungated state.
  await openEverything(page);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => ({
      state: label,
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    })),
  ).toEqual([]);
}

/** Exhibit 1, for every offered parameter set. */
async function driveKeygen(page: Page): Promise<void> {
  for (const set of ['MAYO1', 'MAYO2', 'MAYO3', 'MAYO5', 'TOY']) {
    await page.selectOption('#kg-params', set);
    await page.click('#kg-run');
    await expect(page.locator('#kg-out .verdict').first()).toContainText('keypair derived');
  }
}

/** Exhibit 2: every step of the whipping walkthrough, plus its disclosure. */
async function driveWhip(page: Page): Promise<void> {
  await page.click('#whip-next');
  await expect(page.locator('#whip-state-1')).toHaveText('Done');
  await page.click('#whip-run');
  await expect(page.locator('#whip-state-5')).toHaveText('Done');
  await openEverything(page);
}

/** Exhibit 3, accepting path. */
async function driveVerifyValid(page: Page): Promise<void> {
  await page.click('#vf-sign');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('Signed with a fresh');
  await page.click('#vf-verify');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('VALID');
}

/** Exhibit 3, every rejecting path. */
async function driveVerifyRejected(page: Page): Promise<void> {
  for (const button of ['#vf-tamper-sig', '#vf-tamper-salt', '#vf-tamper-msg']) {
    await page.click(button);
    await expect(page.locator('#vf-out .verdict').first()).toContainText('REJECTED');
  }
}

/** Exhibit 3 under real parameters, where the vectors are long enough to clip. */
async function driveVerifyRealParams(page: Page): Promise<void> {
  await page.selectOption('#vf-params', 'MAYO1');
  await page.click('#vf-sign');
  await page.click('#vf-verify');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('VALID');
}

/** Exhibit 4: every forgery attempt, plus the malformed-input battery. */
async function driveForge(page: Page): Promise<void> {
  await page.click('#fg-guess');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('0 forgeries in', { timeout: 30_000 });
  await page.click('#fg-oil-random');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('Forgery rejected', { timeout: 30_000 });
  await page.click('#fg-oil-nibble');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('Forgery rejected', { timeout: 30_000 });
  await page.click('#fg-control');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('VALID', { timeout: 30_000 });
  await page.click('#fg-malformed');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('were refused', { timeout: 30_000 });
}

/** Exhibit 6: replay a reference vector, including a level-5 one. */
async function driveKat(page: Page): Promise<void> {
  await page.selectOption('#kat-select', 'MAYO_5:0');
  await page.click('#kat-run');
  await expect(page.locator('#kat-out .verdict').first()).toContainText('reproduced byte for byte', { timeout: 30_000 });
}

async function driveAll(page: Page): Promise<void> {
  await freeze(page);
  await driveKeygen(page);
  await scan(page, 'after keygen');
  await driveWhip(page);
  await scan(page, 'after the whipping walkthrough');
  await driveVerifyValid(page);
  await scan(page, 'signature accepted');
  await driveVerifyRejected(page);
  await scan(page, 'signature rejected');
  await driveVerifyRealParams(page);
  await scan(page, 'real parameters accepted');
  await driveForge(page);
  await scan(page, 'forgery attempts and the malformed-input battery');
  await driveKat(page);
  await openEverything(page);
  await scan(page, 'reference vector replayed');
}

test('no WCAG A/AA violations — dark theme', async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await driveAll(page);
});

test('no WCAG A/AA violations — light theme', async ({ page }) => {
  await page.goto('.');
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await driveAll(page);
});
