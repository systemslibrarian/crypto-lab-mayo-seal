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

/**
 * The three prediction checks, left answered so every later scan sees a chosen
 * option and a verdict rather than the untouched state. Both verdict kinds are
 * covered, and the selected option carries an accent fill that only exists once
 * something has been clicked.
 */
async function drivePredictions(page: Page): Promise<void> {
  await page.click('#pr-threshold-0');
  await expect(page.locator('#pr-threshold .verdict')).toContainText('Not quite');
  await page.click('#pr-threshold-1');
  await expect(page.locator('#pr-threshold .verdict')).toContainText('Correct');
  await page.click('#pr-whip-0');
  await expect(page.locator('#pr-whip .verdict')).toContainText('Not quite');
  await page.click('#pr-salt-0');
  await expect(page.locator('#pr-salt .verdict')).toContainText('Correct');
}

/**
 * The guided journey: one choice at the top, carried through sign, verify and
 * tamper, with the progress indicator part way along rather than empty or full.
 */
async function driveJourney(page: Page): Promise<void> {
  await page.selectOption('#lsn-params', 'TOY');
  await page.fill('#lsn-msg', 'one message, all the way through');
  await page.click('#whip-run');
  await page.click('#vf-adopt');
  await page.click('#vf-verify');
  await expect(page.locator('#lsn-stages [data-state="done"]')).toHaveCount(4);
  await page.click('#lsn-reset');
  await expect(page.locator('#lsn-out .verdict')).toContainText('Journey reset');
  await page.click('#vf-verify');
}

/** Exhibit 1, for every offered parameter set. */
async function driveKeygen(page: Page): Promise<void> {
  for (const set of ['MAYO1', 'MAYO2', 'MAYO3', 'MAYO5', 'TOY']) {
    await page.selectOption('#kg-params', set);
    await page.click('#kg-run');
    await expect(page.locator('#kg-out .verdict').first()).toContainText('keypair derived');
  }
}

/**
 * Exhibit 2: the three beats that form the default path, then the five spec
 * operations behind the disclosure. Both are scanned — the steps are optional
 * for a reader, not for the gate.
 */
async function driveWhip(page: Page): Promise<void> {
  // The guided journey ran the walkthrough already, so start from a clean board.
  await page.click('#whip-reset');
  await page.click('#whip-next');
  await expect(page.locator('#whip-beat-state-1')).toHaveText('Done');
  await page.click('#whip-run');
  await expect(page.locator('#whip-beat-state-3')).toHaveText('Done');
  await openEverything(page);
  await expect(page.locator('#whip-state-5')).toHaveText('Done');
}

/** Exhibit 2 again, at real parameters, where the matrices are drawn as a corner. */
async function driveWhipRealParams(page: Page): Promise<void> {
  await page.selectOption('#whip-params', 'MAYO1');
  await page.click('#whip-run');
  await expect(page.locator('#whip-beat-state-3')).toHaveText('Done', { timeout: 30_000 });
  await expect(page.locator('#whip-beat-body-3 .verdict').first()).toContainText('P*(s) = t');
  await openEverything(page);
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
  await drivePredictions(page);
  await scan(page, 'prediction checks answered', '#intro');
  await driveJourney(page);
  await scan(page, 'the guided journey, part way through', '#journey');
  // The rest of the sweep drives each exhibit's own controls, which is what
  // explore mode exists for. Guided mode has just been scanned above.
  await page.click('#lsn-mode');
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

/**
 * SC 1.4.11 (non-text contrast): every text-entry control boundary (text
 * input, textarea, select) must reach 3:1 against the adjacent surface and
 * the field's own fill, in both themes. Axe does not flag border-vs-surface,
 * so this composites rendered computed styles over the real ancestor backdrop
 * and asserts the worst pairing directly.
 */
async function controlBorderContrasts(
  page: Page,
): Promise<Array<{ id: string; ratio: number }>> {
  return page.evaluate(() => {
    type C = { r: number; g: number; b: number; a: number };
    const parse = (s: string): C => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return { r: 0, g: 0, b: 0, a: 0 };
      const p = m[1].split(/[,\s/]+/).map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg: C, bg: C): C => {
      const a = fg.a + bg.a * (1 - fg.a);
      return {
        r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
        g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
        b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
        a,
      };
    };
    const lum = (c: C) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: C, b: C) => {
      const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
      return (hi + 0.05) / (lo + 0.05);
    };
    const backdrop = (start: Element | null): C => {
      const stack: C[] = [];
      for (let n = start; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.a > 0) {
          stack.push(c);
          if (c.a >= 1) break;
        }
      }
      let out: C = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
      return out;
    };
    const out: Array<{ id: string; ratio: number }> = [];
    document
      .querySelectorAll<HTMLElement>("select, textarea, input[type='text']")
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const cs = getComputedStyle(el);
        if (parseFloat(cs.borderTopWidth) === 0) return;
        const outside = backdrop(el.parentElement);
        const fillRaw = parse(cs.backgroundColor);
        const fill = fillRaw.a > 0 ? over(fillRaw, outside) : outside;
        const border = over(over(parse(cs.borderTopColor), fill), outside);
        out.push({
          id: el.id || el.tagName.toLowerCase(),
          ratio: Math.min(ratio(border, outside), ratio(border, fill)),
        });
      });
    return out;
  });
}

async function assertControlBorders(page: Page): Promise<void> {
  await openEverything(page);
  const results = await controlBorderContrasts(page);
  expect(results.length).toBeGreaterThan(0);
  for (const { id, ratio } of results) {
    expect(ratio, `#${id} border contrast`).toBeGreaterThanOrEqual(3);
  }
}

test('control borders reach 3:1 — dark theme (SC 1.4.11)', async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await assertControlBorders(page);
});

test('control borders reach 3:1 — light theme (SC 1.4.11)', async ({ page }) => {
  await page.goto('.');
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await assertControlBorders(page);
});

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
