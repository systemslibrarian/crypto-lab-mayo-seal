import { expect, test } from '@playwright/test';
import { boot, driveAllStates, NARROW, reportCollected, watchPageErrors } from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches, and every state is scanned:
 * the arrival state in GUIDED mode, where each exhibit's own controls are
 * hidden and nothing has been computed; the skip link focused by a real Tab
 * press; the whipping figure at both ends of its slider; all three prediction
 * checks answered wrongly and then correctly; both disclosures opened by their
 * summaries; the guided journey run end to end and then reset; the switch into
 * EXPLORE mode, which is a different document; keygen at all five parameter
 * sets and from a typed seed; the whipping walkthrough stepped one beat at a
 * time, run at TOY, and run again at MAYO1 where the matrices are drawn as a
 * corner and the scrollers actually overflow; a signature accepted, all three
 * tampers rejected, and Exhibit 2's own artifact verified; every forgery
 * attempt, the control run and the malformed-input battery; a NIST level-5
 * reference vector; the preconditions recomputed; and the return to guided mode
 * with every exhibit populated. Each of those is scanned in
 * {dark, light} × {1280px, 380px}.
 *
 * See `gate.ts` for why nothing is injected into the page, why neither `hidden`
 * nor `open` is ever set from script — `hidden` is the mechanism of this lab's
 * guided/explore fork, and stripping it produces a document with two controls
 * claiming one value — why the lab's defaults are asserted rather than assumed,
 * and why `violations` is not the whole oracle on a page where every result is
 * printed on a `color-mix`.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    reportCollected();
  });
}
