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

/**
 * Scans one state. `include` narrows the scan to the exhibit that just changed:
 * re-scanning the whole page after every interaction re-checks thousands of
 * already-cleared nodes, which on a CI runner pushed the sweep past its timeout.
 * Every state is still scanned, and driveAll finishes with one full-page pass so
 * landmarks, heading order and the shared chrome are covered too.
 */
async function scan(page: Page, label: string, include?: string): Promise<void> {
  // Deep readouts live behind disclosures; open them all first, because an
  // unscanned state is an ungated state.
  await openEverything(page);
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder.include(include);
  const { violations } = await builder.analyze();
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

/** Exhibit 2 again, at real parameters, where the matrices are drawn as a corner. */
async function driveWhipRealParams(page: Page): Promise<void> {
  await page.selectOption('#whip-params', 'MAYO1');
  await page.click('#whip-run');
  await expect(page.locator('#whip-state-5')).toHaveText('Done', { timeout: 30_000 });
  await expect(page.locator('#whip-body-5 .verdict').first()).toContainText('P*(s) = t');
}

/** Exhibit 3, accepting path. */
async function driveVerifyValid(page: Page): Promise<void> {
  await page.click('#vf-sign');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('Signed with a fresh');
  await page.click('#vf-verify');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('VALID');
}

/** Exhibit 3 verifying the exact artifact Exhibit 2 produced. */
async function driveVerifyAdopted(page: Page): Promise<void> {
  await page.click('#vf-adopt');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('Adopted the');
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

/** Exhibit 6, second panel: recompute the structural preconditions. */
async function drivePreconditions(page: Page): Promise<void> {
  await page.selectOption('#pc-params', 'MAYO2');
  await page.click('#pc-run');
  await expect(page.locator('#pc-out .verdict').first()).toContainText('preconditions hold', { timeout: 30_000 });
}

async function driveAll(page: Page): Promise<void> {
  await freeze(page);
  await driveKeygen(page);
  await scan(page, 'after keygen', '#keygen');
  await driveWhip(page);
  await scan(page, 'after the whipping walkthrough', '#whip');
  await driveWhipRealParams(page);
  await scan(page, 'the whipping walkthrough at real parameters', '#whip');
  await driveVerifyValid(page);
  await scan(page, 'signature accepted', '#verify');
  await driveVerifyAdopted(page);
  await scan(page, 'verifying the walkthrough artifact', '#verify');
  await driveVerifyRejected(page);
  await scan(page, 'signature rejected', '#verify');
  await driveVerifyRealParams(page);
  await scan(page, 'real parameters accepted', '#verify');
  await driveForge(page);
  await scan(page, 'forgery attempts and the malformed-input battery', '#forge');
  await driveKat(page);
  await drivePreconditions(page);
  await scan(page, 'reference vector replayed and preconditions rechecked', '#real');
  // One whole-page pass with every exhibit in its final state.
  await scan(page, 'the finished page, end to end');
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
