import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText, formatNonTextFailures } from './nontext';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, each one a correction of the gate this
 * replaces:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. `freeze()` pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSED this stylesheet's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the block was never measured once. `boot` asks for the preference and
 *     ASSERTS it took effect, which exercises the real block: it collapses
 *     every duration to 0.001ms and turns `html { scroll-behavior: smooth }`
 *     into `auto` — the second of which matters to the drive, because six of
 *     this page's controls call `scrollIntoView`.
 *
 *     The block was checked for the defect where cancelling an animation
 *     strands an element at its start value. It cannot be in that shape: it
 *     sets `animation-duration` and `transition-duration`, never
 *     `animation: none`, so every animation still runs and still ENDS at its
 *     end state. `expectNotBlank` measures the outcome in every state anyway.
 *
 *  2. IT FORCE-REVEALED EVERYTHING, BEFORE EVERY SCAN. `openEverything()` set
 *     `open = true` on both `<details>` and then stripped the `hidden`
 *     attribute from EVERY hidden element on the page — and it was called from
 *     inside `scan()`, so no scan ever saw the page as it actually was. On this
 *     lab that is not a small distortion: `lesson.ts` uses `hidden` as the
 *     mechanism of the guided/explore fork, hiding `#lsn-controls` in explore
 *     mode and each exhibit's own parameter and message field in guided mode.
 *     Stripping it produced a document with BOTH sets of controls visible — two
 *     controls claiming one value, which is the exact state the code comments
 *     say must never exist. This gate never touches `hidden` or `open`; the
 *     mode is switched by its button and each disclosure by its summary.
 *
 *  3. IT SCANNED NARROWED, AT ONE VIEWPORT. Every scan but the last passed
 *     `include` to axe, so eleven of the twelve scans checked one section and
 *     nothing else — landmarks, heading order, duplicate ids and the shared
 *     chrome were checked once, at the end, in one state. There was no 380px
 *     column at all. This drive scans the whole document after every step, in
 *     {dark, light} × {1280, 380}.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The gap is concrete
 *     here: every result this lab computes is printed inside a `.verdict`,
 *     whose surface is a `color-mix(in oklab, …)`, and axe files a `color-mix`
 *     under `incomplete`. A violations-only assertion measured the contrast of
 *     essentially nothing the lab produces.
 *
 *  5. ITS 1.4.11 CHECK WAS AIMED WHERE THE RULE WAS ALREADY KEPT, and there was
 *     no reflow, keyboard-scroller or focus-indicator oracle at all.
 *     `controlBorderContrasts()` queried `select, textarea, input[type='text']`
 *     — precisely the three selectors `--border-strong` was written for and
 *     correctly applied to — and skipped anything with a zero-width border,
 *     which is every `.btn` that draws itself with a fill. See
 *     `e2e/nontext.ts`, which judges every control and every `::before`.
 */
/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 *
 * This page cannot currently be in that shape, and the assertion is what makes
 * that a measurement rather than a reading: its reduced-motion block sets
 * `animation-duration` and `transition-duration` to 0.001ms — it never sets
 * `animation: none` — so every animation still runs and still arrives at its
 * end state. That is a property of the current stylesheet rather than of the
 * page, which is why this runs in every state instead of being reasoned about
 * once.
 *
 * `aria-hidden` subtrees are excluded, since text removed from the
 * accessibility tree is not what this check is for. Inside `#app` that is the
 * `.verdict__icon`, `.check__icon`, `.journey__tick`, `.swatch` and rendered
 * superscript glyphs, every one of which sits beside the words carrying the
 * same meaning (see the note in `contrast.ts`).
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. A renderer that throws halfway through leaves an earlier state on
 * screen, and a gate that scans that state reports green for a page that is
 * broken. Attach before `boot`, assert after the drive.
 *
 * This matters more than usual here. Eleven UI modules mount themselves on
 * load through a `byId()` that THROWS on a miss, and the crypto beneath them
 * throws on a failed precondition — so a MAYO1 walkthrough that dies halfway
 * leaves the previous beat's matrices on screen looking entirely plausible.
 * This is what notices.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark: the shared bar.
 *
 * The OUTCOME is asserted rather than either mechanism, so a change to the
 * nesting is caught as well as a change to the script. `index.html`'s
 * `dedupeBanner()` would demote a second banner to `role="group"`, but it never
 * fires here: this lab's `<header class="cl-hero">` sits inside
 * `<main id="app" class="shell">`, which scopes it out of the banner role on
 * its own, and `dedupeBanner` returns early for exactly that case
 * (`el.closest('main, article, aside, nav, section')`). The single banner is
 * therefore a property of the markup, and this asserts it as one.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including the
 * lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. Applying it before `goto` also matters
 * because the preference changes how the drive behaves, not only how the page
 * looks: `html { scroll-behavior: smooth }` becomes `auto`, and six controls on
 * this page scroll their target into view when pressed.
 *
 * The theme is seeded through `localStorage` rather than by clicking the
 * toggle, which also pins down a real failure mode: `index.html`'s anti-flash
 * script reads `localStorage.getItem('theme')` and the shared bar's toggle
 * writes `localStorage.setItem('theme', …)`. If those keys drift apart the
 * theme silently stops persisting, and this boot fails on `data-theme` rather
 * than quietly scanning dark twice.
 *
 * The defaults are asserted at length because THIS LAB SHIPS IN GUIDED MODE,
 * and guided mode is a different document. `lesson.ts` hides each exhibit's own
 * parameter and message field and drives all five from the journey controls at
 * the top; the arrival state therefore has FEWER controls than explore mode,
 * and every ratio measured in Exhibits 1-4 is a ratio of that rendering. The
 * gate this replaces could not tell the two apart, because it stripped the
 * `hidden` attribute that distinguishes them before every scan.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the whole
  // test timeout and reports nothing useful. 20s turns that silent hang into a
  // named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  // The reduced-motion block's own effect, asserted rather than assumed.
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    'reduced motion must turn the root scroll-behavior back to auto'
  ).toBe('auto');

  // Ten sections, each mounted by a module that throws on a missing id.
  await expect(page.locator('main#app')).toBeVisible();
  await expect(page.locator('#app section.section')).toHaveCount(10);
  await expect(page.locator('.jumpnav a')).toHaveCount(7);

  // ── Guided mode, which is what ships ─────────────────────────────────────
  await expect(page.locator('#lsn-mode')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#lsn-mode')).toHaveText('Explore independently');
  await expect(page.locator('#lsn-controls')).toBeVisible();
  await expect(page.locator('#lsn-params')).toHaveValue('TOY');
  await expect(page.locator('#lsn-msg')).toHaveValue('transfer 10 to alice');
  await expect(page.locator('#lsn-stages li')).toHaveCount(5);
  await expect(page.locator('#lsn-stages [data-state="done"]')).toHaveCount(0);
  // …and the seven per-exhibit fields it takes over are hidden, which is the
  // whole shape of the mode and the thing the old gate stripped away. The list
  // is `lesson.ts`'s PARAM_TARGETS and MESSAGE_TARGETS exactly; `#wv-params`
  // and `#kg-seed` are deliberately NOT in it, and asserting them visible is
  // what stops this turning into "everything is hidden in guided mode".
  for (const id of ['kg-params', 'whip-params', 'vf-params', 'fg-params']) {
    await expect(page.locator(`#${id}`)).toBeHidden();
  }
  for (const id of ['whip-msg', 'vf-msg', 'fg-msg']) {
    await expect(page.locator(`#${id}`)).toBeHidden();
  }
  await expect(page.locator('#wv-params')).toBeVisible();
  await expect(page.locator('#kg-seed')).toBeVisible();

  // ── The whipping figure in the intro, and its slider ─────────────────────
  await expect(page.locator('#wv-k')).toHaveValue('3');
  await expect(page.locator('#wv-k-value')).toHaveText('3');
  await expect(page.locator('#wv-readout')).not.toBeEmpty();
  await expect(page.locator('#wv-figure')).not.toBeEmpty();

  // ── Three prediction checks, mounted and unanswered ──────────────────────
  for (const id of ['pr-threshold', 'pr-whip', 'pr-salt']) {
    await expect(page.locator(`#${id} button`).first()).toBeVisible();
    await expect(page.locator(`#${id} [aria-pressed="true"]`)).toHaveCount(0);
    await expect(page.locator(`#${id} .verdict`)).toHaveCount(0);
  }

  // ── Everything computed ships ABSENT ─────────────────────────────────────
  for (const id of ['kg-out', 'vf-out', 'fg-out', 'kat-out', 'pc-out', 'lsn-out']) {
    await expect(page.locator(`#${id}`)).toBeEmpty();
  }
  await expect(page.locator('#kg-seed')).toHaveValue('');
  // Guided mode has already pushed the journey's message into the three panels
  // it drives, so their SHIPPED values are the journey's, not the markup's —
  // which is worth asserting, because the markup says otherwise.
  await expect(page.locator('#whip-msg')).toHaveValue('transfer 10 to alice');
  await expect(page.locator('#vf-msg')).toHaveValue('transfer 10 to alice');
  await expect(page.locator('#fg-msg')).toHaveValue('transfer 10 to alice');

  // Exhibit 2's three beats and five spec steps, all idle.
  await expect(page.locator('#whip-beats .beat[data-state="idle"]')).toHaveCount(3);
  await expect(page.locator('#whip-steps .step[data-state="idle"]')).toHaveCount(5);
  for (const n of [1, 2, 3]) {
    await expect(page.locator(`#whip-beat-state-${n}`)).toHaveText('Waiting');
  }

  // The reference-vector picker is populated by `kat.ts` on mount, so an empty
  // <select> here means the module never ran.
  await expect(page.locator('#kat-select option').first()).toBeAttached();

  // Three disclosures at first paint, all shut: the "Jargon, unpacked"
  // glossary and `#whip-full` from the markup, plus one `dom.ts` builds on
  // mount. More appear as the drive runs — every whipping beat can fold its
  // working away — which is why the count is asserted HERE, where it is a
  // property of the arrival state, and not later.
  await expect(page.locator('details')).toHaveCount(3);
  await expect(page.locator('details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert that `[hidden]` actually hides.
 *
 * `[hidden]` is a UA rule of specificity (0,0,0) in the author-facing sense —
 * any author `display` declaration beats it, including a single class — so
 * `hidden` can be set on an element and do nothing at all. Seven labs in this
 * fleet shipped that.
 *
 * This one already defends against it, and its comment names the exact reason:
 * `.field` and `.controls` both set `display`, so without an explicit rule the
 * `hidden` attribute would lose to them. `style.css` therefore carries
 * `[hidden] { display: none !important }`.
 *
 * The check stays because that one line is the entire mechanism of this lab's
 * guided/explore fork. `lesson.ts` hides `#lsn-controls` in explore mode and
 * every exhibit's own `.field` wrapper in guided mode, and the failure it
 * prevents is not cosmetic: it is two controls claiming one value, one of them
 * announced by a screen reader as if it were live. Asserting the computed
 * `display` on the elements that actually carry the attribute is what turns
 * "there is a rule" into "the rule works".
 */
export async function expectHiddenActuallyHides(page: Page): Promise<void> {
  const leaks = await page.evaluate(() => {
    const out: string[] = [];
    // The two element SHAPES that actually carry the attribute, named the way
    // `lesson.ts` reaches them: `#lsn-controls` is a `.controls`, and each
    // exhibit's field is `byId(id).closest('.field')`. Both of those classes
    // set `display`, which is precisely why the `!important` rule exists.
    const targets: Array<[string, Element | null]> = [
      ['#lsn-controls', document.getElementById('lsn-controls')],
      ['.field (kg-params)', document.getElementById('kg-params')?.closest('.field') ?? null],
      ['.field (whip-msg)', document.getElementById('whip-msg')?.closest('.field') ?? null],
    ];
    for (const [name, el] of targets) {
      if (!el) {
        out.push(`${name}: missing`);
        continue;
      }
      const had = el.hasAttribute('hidden');
      el.setAttribute('hidden', '');
      const display = getComputedStyle(el).display;
      if (!had) el.removeAttribute('hidden');
      if (display !== 'none') out.push(`${name} computes display:${display} while [hidden]`);
    }
    return out;
  });
  expect(leaks, '[hidden] must actually hide — a class-level display beats it').toEqual([]);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this page is
 * the shape that breaks it: linear systems drawn one element per GF(16) nibble,
 * which at MAYO1 parameters are 78 rows by 80 columns, plus hex dumps of keys
 * and signatures that run to hundreds of characters with no spaces in them.
 * Every wide thing is meant to scroll inside a `.scroller` or wrap on
 * `overflow-wrap: anywhere`; the assertion here is that none of them scrolls
 * the DOCUMENT.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow-x: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. That cost
    // a run elsewhere in this fleet, and this page has a decoy inside every
    // `.scroller` — at MAYO1 parameters the matrices inside them are several
    // thousand pixels wide.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1). If
 * it holds no focusable content it needs `tabindex="0"`, so it becomes a focus
 * target arrow keys can then scroll.
 *
 * Every scroller on this page is built by one helper — `dom.ts`'s `scroller()`
 * — so whether they are reachable is a property of that one function rather
 * than of eleven hand-written wrappers. The assertion still earns its place
 * twice over: a helper is a convention and not an enforcement, and the content
 * inside those scrollers is the evidence for most of what this lab claims — the
 * linear systems, the elimination that solves them, the ledger tables and every
 * hex dump. It is also a check that only has an answer in states a drive has to
 * build: at TOY parameters the matrices fit and nothing scrolls at all, and the
 * 2.1.1 question only exists once MAYO1 is selected.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Every tab stop must show WHERE the focus is (WCAG 2.4.7).
 *
 * This is here because it is the defect a reflow or 2.1.1 fix CREATES: making a
 * wide panel focusable so it can be scrolled from the keyboard adds a tab stop,
 * and a tab stop with no visible indicator is a new 2.4.7 failure. This lab
 * makes every scroller focusable through `dom.ts`'s `scroller()` for exactly
 * that reason, and — unusually for this fleet — its focus rule is a bare
 * `:focus-visible`, which is element-agnostic and therefore already reaches
 * them. This asserts that outcome instead of trusting the selector, across a
 * tab order that grows as the drive runs: the prediction checks are deliberately
 * BUTTONS rather than radios (a radio group is one Tab stop with arrow keys
 * inside it, so only one option would be reachable by Tab), which alone adds
 * eleven stops that a walk has to find indicators on.
 *
 * It walks the REAL tab order with real Tab presses rather than calling
 * `focus()` in a loop, because `:focus-visible` is modality-dependent:
 * programmatic focus on a `<div>` does not match it, so a `focus()`-based check
 * would report a failure for every correctly-styled region and a pass for
 * nothing. `outline-style: auto` counts as an indicator — that is the UA focus
 * ring, which is a real one.
 */
export async function expectFocusVisibleThroughTabOrder(
  page: Page,
  label: string
): Promise<void> {
  // Identity is tracked by ELEMENT, in a page-side array, not by a describe()
  // string: this page has eleven `button.predict__option`, several
  // `button.btn.btn--ghost` and `button.btn.btn--danger`, and two `a.cl-btn` in
  // the shared bar, all of which share a description — and a string-keyed set
  // declares the walk "wrapped" at the first repeat.
  await page.evaluate(() => {
    (window as unknown as { __tabStops?: Element[] }).__tabStops = [];
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  const bad = new Set<string>();
  let stops = 0;
  for (let i = 0; i < 200; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const seen = (window as unknown as { __tabStops: Element[] }).__tabStops;
      const el = document.activeElement as HTMLElement | null;
      // Focus has left the document's focusable set — Tab from the LAST tab
      // stop lands on <body>. That is not the end of the walk: the next Tab
      // re-enters at the top. Returning `null` (rather than stopping) is what
      // lets a walk that starts mid-document — which it does at the end of the
      // drive, because the last thing clicked was a <summary> near the bottom —
      // still reach every stop. Stopping here reported a 4-stop tab order.
      if (!el || el === document.body || el === document.documentElement) return 'edge';
      if (seen.includes(el)) return 'wrapped';
      seen.push(el);
      const cs = getComputedStyle(el);
      const w = parseFloat(cs.outlineWidth || '0');
      const drawn =
        (cs.outlineStyle !== 'none' && (cs.outlineStyle === 'auto' || w > 0)) ||
        (!!cs.boxShadow && cs.boxShadow !== 'none');
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).join('.');
      return {
        id: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}`,
        drawn,
        detail: `outline ${cs.outlineStyle} ${cs.outlineWidth}, box-shadow ${cs.boxShadow}`,
      } as const;
    });
    if (stop === 'edge') continue;
    if (stop === 'wrapped') break;
    stops += 1;
    if (!stop.drawn) bad.add(`${stop.id} — ${stop.detail}`);
  }
  await page.evaluate(() => {
    delete (window as unknown as { __tabStops?: Element[] }).__tabStops;
  });
  expect(stops, `tab order must have stops in state: ${label}`).toBeGreaterThan(10);
  expect(
    Array.from(bad),
    `tab stops with no visible focus indicator in state: ${label}`
  ).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run. It
 * is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the committed
 * workflow, and a run with it set prints every finding as it happens and then
 * fails at the end, so a green collection run cannot be mistaken for a green
 * gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/** Same, for the assertions that live inside an async page probe. */
async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Seven assertions, because axe's `violations` array alone is not a complete
 * oracle. (The eighth, WCAG 2.4.7, is `expectFocusVisibleThroughTabOrder`,
 * which is not called from here because it MOVES focus — walking the whole tab
 * order inside every scan would change the state being scanned. It is driven
 * separately at the two states where this page's tab order differs: first
 * paint, and the fully populated page.)
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because every `.verdict` this
 *    lab prints sits on a `color-mix(in oklab, …)` and axe declines to resolve
 *    one. Everything else in that bucket is a real result axe simply could not
 *    finish — including `aria-prohibited-attr`, which is where an `aria-label`
 *    on a role-less element hides, a defect that never reaches the violations
 *    array at all. That one is live: `dom.ts`'s `scroller()` puts an
 *    `aria-label` on a `<div>` and makes it legal with `role="region"`, and the
 *    role is easy to drop by accident.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - non-text contrast — SC 1.4.11 control boundaries AND `::before`/`::after`
 *    generated content, neither of which axe has a rule for and neither of
 *    which the text walk can reach. See `e2e/nontext.ts`.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    // These four are axe "best-practice" rules rather than WCAG-tagged ones, so
    // `withTags` alone does not run them. This page has a shared sticky
    // <header role="banner"> above a <main id="app"> that contains a second
    // <header>, a hero <aside aria-label="Why it matters"> inside that, a
    // <nav class="jumpnav">, and one aria-labelled region per scroller —
    // exactly the shape they catch, and none of them was enabled before.
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // A 1.4.11 oracle that silently measured nothing would be the same failure
  // this sweep exists to remove, so the population is asserted before the
  // verdict: `#app` must really contain visible controls to judge.
  expect(
    await page.locator('#app button:visible, #app input:visible').count(),
    `no controls found to measure in state: ${label}`
  ).toBeGreaterThan(0);
  softExpect(
    Array.from(new Set(formatNonTextFailures(await auditNonText(page)))),
    `non-text contrast failures (SC 1.4.11 / generated content) in state: ${label}`,
    []
  );

  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}



// ── The drive ───────────────────────────────────────────────────────────────

/**
 * Open every VISIBLE shut disclosure by clicking its summary.
 *
 * `:visible` is defensive rather than load-bearing — both `<details>` on this
 * page are in the static markup — but forcing `open` from script is exactly
 * what the gate this replaces did, inside `scan()` itself, so that no scan ever
 * saw a shut one.
 */
async function openAllDisclosures(page: Page, expectSome = true): Promise<void> {
  const shut = page.locator('details:not([open]) > summary:visible');
  let opened = 0;
  for (let i = await shut.count(); i > 0 && opened < 40; i = await shut.count()) {
    await shut.first().click();
    opened += 1;
  }
  await expect(page.locator('details:not([open]) > summary:visible')).toHaveCount(0);
  if (expectSome) {
    expect(opened, 'no shut disclosure was found where one was expected').toBeGreaterThan(0);
  }
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Six things shape this drive:
 *
 *  - GUIDED MODE IS SCANNED BEFORE EXPLORE MODE, BECAUSE GUIDED IS WHAT SHIPS.
 *    They are genuinely different documents: guided hides every exhibit's own
 *    parameter and message field and drives all five from the journey controls.
 *    The gate this replaces stripped `hidden` before every scan and therefore
 *    measured a third document that is neither.
 *
 *  - EVERY VERDICT KIND, WHICH IS FOUR INKS. `dom.ts`'s `verdict()` paints
 *    `ok`, `bad`, `warn` and `idle`, each a `color-mix` of a different hue over
 *    `--bg-2`, and each carries an icon and a worded headline. `bad` is only
 *    reachable by making something fail — a wrong prediction, a tampered
 *    signature, a forgery attempt — and `warn` only in the malformed-input
 *    battery. All four are driven.
 *
 *  - BOTH ANSWERS TO EVERY PREDICTION. A wrong answer is a state the page is
 *    built to produce ("the wrong answers here are the actual misconceptions"),
 *    and it is the only route to a `bad` verdict in the intro. Each of the
 *    three checks is answered wrongly first and then correctly, and the options
 *    stay enabled afterwards, which is another rendering again.
 *
 *  - REAL PARAMETERS, NOT JUST TOY. At TOY the matrices fit on screen and
 *    nothing scrolls; at MAYO1 they are 78 rows tall, drawn as a corner, and
 *    every `.scroller` on the page becomes a live WCAG 2.1.1 question. The
 *    whole 380px column exists mainly to ask it.
 *
 *  - EVERY REJECTING PATH IN EXHIBIT 3 AND EVERY ATTACK IN EXHIBIT 4, because a
 *    verifier that accepts is only half of what this lab claims. Three tampers,
 *    four forgery attempts, the control run and the malformed-input battery.
 *
 *  - NO FIXED TIMEOUTS. Every step has a DOM completion signal — a verdict
 *    appearing, a beat's state text turning to "Done", a stage's `data-state` —
 *    and the drive waits on those. The MAYO1 and MAYO5 runs are real
 *    cryptography and genuinely slow, so their waits are long; they are still
 *    waits on the DOM.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);
  const SLOW = { timeout: 90_000 };

  await expectHiddenActuallyHides(page);
  await scanAt('first paint: guided mode, nothing computed, both disclosures shut');

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('shared-header skip link focused');

  // Ordered after the skip-link step deliberately: the walk leaves a sequential
  // focus navigation starting point behind that `blur()` does not reset.
  await soft(() => expectFocusVisibleThroughTabOrder(page, `${theme} / first paint`));

  // ── The intro figure, at both ends of the whipping slider ────────────────
  // The slider's `max` is NOT the 5 in the markup: `whipviz.ts` rewrites it per
  // parameter set as `min(max(k + 2, 4), maxWhippingFactor(p))`, which is 3 at
  // TOY. Reading it is what makes "drive the extreme" mean the real extreme
  // rather than a value the control rejects — `fill('5')` is a malformed value
  // here and Playwright refuses it outright.
  const kMax = async (): Promise<string> =>
    (await page.locator('#wv-k').getAttribute('max')) ?? '1';
  await page.locator('#wv-k').fill('1');
  await expect(page.locator('#wv-k-value')).toHaveText('1');
  await expect(page.locator('#wv-readout')).not.toBeEmpty();
  await scanAt('the whipping figure at k = 1, where one copy is too narrow');
  const toyMax = await kMax();
  await page.locator('#wv-k').fill(toyMax);
  await expect(page.locator('#wv-k-value')).toHaveText(toyMax);
  await scanAt(`the whipping figure at k = ${toyMax}, the widest TOY allows`);

  // `#wv-params` is one of the two fields guided mode does NOT take over, so it
  // is reachable here — and MAYO1 is the only route to a k range wider than
  // TOY's and to the real m and o on the figure.
  await page.selectOption('#wv-params', 'MAYO1');
  await expect(page.locator('#wv-readout')).toContainText('78');
  await scanAt('the whipping figure at MAYO1 parameters');
  const realMax = await kMax();
  await page.locator('#wv-k').fill(realMax);
  await expect(page.locator('#wv-k-value')).toHaveText(realMax);
  await scanAt(`the whipping figure at MAYO1, k = ${realMax}`);
  await page.selectOption('#wv-params', 'TOY');
  await page.locator('#wv-k').fill('3');

  // ── All three predictions, wrong first and then right ────────────────────
  // The wrong answer is a state the page is built to produce, and it is the
  // only route to a `bad` verdict anywhere in the intro.
  await page.click('#pr-threshold-0');
  await expect(page.locator('#pr-threshold .verdict')).toContainText('Not quite');
  await expect(page.locator('#pr-threshold-0')).toHaveAttribute('aria-pressed', 'true');
  await scanAt('a prediction answered wrongly: the corrective verdict');
  await page.click('#pr-threshold-1');
  await expect(page.locator('#pr-threshold .verdict')).toContainText('Correct');
  await scanAt('the same prediction answered correctly');

  await page.click('#pr-whip-0');
  await expect(page.locator('#pr-whip .verdict')).toContainText('Not quite');
  await page.click('#pr-salt-0');
  await expect(page.locator('#pr-salt .verdict')).toContainText('Correct');
  await scanAt('all three prediction checks answered');

  await openAllDisclosures(page);
  await expect(page.locator('details:not([open])')).toHaveCount(0);
  await scanAt('the glossary and the five spec operations disclosed');

  // ── The guided journey, driven from the journey controls ─────────────────
  await page.fill('#lsn-msg', 'one message, all the way through');
  await expect(page.locator('#whip-msg')).toHaveValue('one message, all the way through');
  await scanAt('the journey message pushed into every exhibit');

  await page.click('#whip-run');
  await expect(page.locator('#whip-beat-state-3')).toHaveText('Done', SLOW);
  await expect(page.locator('#lsn-stages [data-state="done"]').first()).toBeVisible();
  await scanAt('the whipping walkthrough run at TOY parameters');

  await page.click('#vf-adopt');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('Adopted the');
  await page.click('#vf-verify');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('VALID');
  await expect(page.locator('#lsn-stages [data-state="done"]')).toHaveCount(4);
  await scanAt('four of the five journey stages done, signature VALID');

  // The fifth stage is "Break", and the only way to reach it is to make the
  // verifier refuse something. A journey indicator that never fills is a state
  // the old gate left unscanned.
  await page.click('#vf-tamper-sig');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('REJECTED');
  await expect(page.locator('#lsn-stages [data-state="done"]')).toHaveCount(5);
  await scanAt('the journey complete: all five stages done');

  await page.click('#lsn-reset');
  await expect(page.locator('#lsn-out .verdict')).toContainText('Journey reset');
  await expect(page.locator('#lsn-stages [data-state="done"]')).toHaveCount(0);
  await scanAt('the journey reset: progress cleared, results kept');

  // ── Explore mode, which is the OTHER document ────────────────────────────
  await page.click('#lsn-mode');
  await expect(page.locator('#lsn-mode')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#lsn-mode')).toHaveText('Back to the guided journey');
  await expect(page.locator('#lsn-controls')).toBeHidden();
  for (const id of ['kg-params', 'whip-params', 'vf-params', 'fg-params', 'whip-msg']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  await scanAt('explore mode: every exhibit gets its own controls back');

  // ── Exhibit 1, at every parameter set it offers ─────────────────────────
  for (const set of ['TOY', 'MAYO1', 'MAYO2', 'MAYO3', 'MAYO5']) {
    await page.selectOption('#kg-params', set);
    await page.click('#kg-run');
    await expect(page.locator('#kg-out .verdict').first()).toContainText('keypair derived', SLOW);
    await scanAt(`keygen at ${set}`);
  }
  // A seed the reader typed, rather than the random one.
  await page.fill('#kg-seed', '000102030405060708090a0b0c0d0e0f');
  await page.selectOption('#kg-params', 'TOY');
  await page.click('#kg-run');
  await expect(page.locator('#kg-out .verdict').first()).toContainText('keypair derived', SLOW);
  await scanAt('keygen from a typed seed');

  // ── Exhibit 2, stepped one beat at a time and then run ──────────────────
  await page.click('#whip-reset');
  await expect(page.locator('#whip-beat-state-1')).toHaveText('Waiting');
  await scanAt('the whipping walkthrough reset to Waiting');
  await page.click('#whip-next');
  await expect(page.locator('#whip-beat-state-1')).toHaveText('Done');
  await expect(page.locator('#whip-beat-state-2')).toHaveText('Waiting');
  await scanAt('beat 1 alone: one copy misses, the last row reads 0 = something');
  await page.click('#whip-run');
  await expect(page.locator('#whip-beat-state-3')).toHaveText('Done', SLOW);
  await expect(page.locator('#whip-state-5')).toHaveText('Done');
  await scanAt('all three beats and all five spec operations, TOY');

  // MAYO1 is the only route to the corner-view matrices and to a `.scroller`
  // that actually overflows, which is what makes 2.1.1 answerable here.
  await page.selectOption('#whip-params', 'MAYO1');
  await page.click('#whip-run');
  await expect(page.locator('#whip-beat-state-3')).toHaveText('Done', SLOW);
  await expect(page.locator('#whip-beat-body-3 .verdict').first()).toContainText('P*(s) = t');
  await expect(page.locator('#whip-body-5 .verdict').first()).toContainText('P*(s) = t');
  await scanAt('the whipping walkthrough at MAYO1, matrices drawn as a corner');

  // ── Exhibit 3: accept, adopt, and all three tampers ─────────────────────
  await page.selectOption('#vf-params', 'TOY');
  await page.click('#vf-sign');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('Signed with a fresh', SLOW);
  await scanAt('a fresh signature produced');
  await page.click('#vf-verify');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('VALID');
  await scanAt('signature accepted');

  for (const [button, what] of [
    ['#vf-tamper-sig', 'a nibble flipped in s'],
    ['#vf-tamper-salt', 'a bit flipped in the salt'],
    ['#vf-tamper-msg', 'the message changed under the signature'],
  ] as const) {
    await page.click(button);
    await expect(page.locator('#vf-out .verdict').first()).toContainText('REJECTED', SLOW);
    await scanAt(`signature rejected — ${what}`);
  }

  await page.click('#vf-adopt');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('Adopted the');
  await page.click('#vf-verify');
  await expect(page.locator('#vf-out .verdict').first()).toContainText('VALID');
  await scanAt("verifying Exhibit 2's own MAYO1 artifact");

  // ── Exhibit 4: every attack, the control, and the malformed battery ─────
  await page.click('#fg-guess');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('0 forgeries in', SLOW);
  await scanAt('forgery by guessing: nothing found');
  await page.click('#fg-oil-random');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('Forgery rejected', SLOW);
  await scanAt('forgery with a random oil space');
  await page.click('#fg-oil-nibble');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('Forgery rejected', SLOW);
  await scanAt('forgery with one nibble of O changed');
  await page.click('#fg-control');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('VALID', SLOW);
  await scanAt('the control: the same code path with the genuine oil space');
  await page.click('#fg-malformed');
  await expect(page.locator('#fg-out .verdict').first()).toContainText('were refused', SLOW);
  await scanAt('the malformed-input battery, every refusal reported');

  // ── Exhibit 6: a reference vector and the preconditions ─────────────────
  await page.selectOption('#kat-select', 'MAYO_5:0');
  await page.click('#kat-run');
  await expect(page.locator('#kat-out .verdict').first()).toContainText(
    'reproduced byte for byte',
    SLOW
  );
  await scanAt('a NIST level-5 reference vector replayed byte for byte');

  await page.selectOption('#pc-params', 'MAYO2');
  await page.click('#pc-run');
  await expect(page.locator('#pc-out .verdict').first()).toContainText('preconditions hold', SLOW);
  await scanAt('the structural preconditions recomputed at MAYO2');

  // ── Back to guided mode, from a fully populated page ────────────────────
  await page.click('#lsn-mode');
  await expect(page.locator('#lsn-mode')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#lsn-controls')).toBeVisible();
  await expect(page.locator('#kg-params')).toBeHidden();
  await scanAt('back in guided mode with every exhibit populated');

  await openAllDisclosures(page, false);
  await scanAt('the finished page, end to end');
  await soft(() => expectFocusVisibleThroughTabOrder(page, `${theme} / fully populated`));
}
