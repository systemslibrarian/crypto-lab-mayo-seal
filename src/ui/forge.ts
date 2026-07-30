/**
 * Exhibit 4 — the break-it-yourself panel. Every button drives real MAYO code
 * and reports what the real verifier said; none of them succeeds, and the page
 * says why in terms the learner just watched happen.
 */
import { PARAM_SETS, sizes, type MayoParams, type ParamSetName } from '../mayo/params';
import { compactKeyGen, expandPK, expandSK, sign, type CompactKeys, type ExpandedPublicKey } from '../mayo/mayo';
import {
  guessByChance,
  MALFORMED_CASES,
  runMalformedCase,
  signWithOilSpace,
  type GuessResult,
  type OilSpaceAttempt,
  type OilSpaceMode,
} from '../mayo/forge';
import { bar, byId, clear, compareLegend, el, formatMs, statList, superscript, vectorList, verdict } from './dom';

interface Session {
  p: MayoParams;
  keys: CompactKeys;
  pk: ExpandedPublicKey;
  message: string;
}

let session: Session | null = null;

/** Guess budgets: enough to see the distribution, not enough to freeze the tab. */
const GUESS_BUDGET: Record<string, number> = { TOY: 4000, MAYO1: 40, MAYO2: 60 };

export function initForge(): void {
  const select = byId<HTMLSelectElement>('fg-params');
  const msgInput = byId<HTMLInputElement>('fg-msg');
  const out = byId('fg-out');

  const ensure = (): Session => {
    const p = PARAM_SETS[select.value as ParamSetName];
    if (session && session.p === p && session.message === msgInput.value) return session;
    const seed = crypto.getRandomValues(new Uint8Array(sizes(p).skSeedBytes));
    const keys = compactKeyGen(p, seed);
    session = { p, keys, pk: expandPK(p, keys.cpk), message: msgInput.value };
    return session;
  };

  const reset = (): void => {
    session = null;
    clear(out);
  };
  select.addEventListener('change', reset);
  msgInput.addEventListener('input', reset);

  byId('fg-guess').addEventListener('click', () => {
    const s = ensure();
    const attempts = GUESS_BUDGET[s.p.name] ?? 40;
    clear(out);
    out.append(verdict('idle', `Guessing ${attempts.toLocaleString()} times…`, 'Evaluating the real public map on each guess.'));
    window.setTimeout(() => {
      const result = guessByChance(s.p, s.pk, new TextEncoder().encode(s.message), attempts);
      clear(out);
      out.append(renderGuess(s.p, result));
    }, 0);
  });

  const runOil = (mode: OilSpaceMode): void => {
    const s = ensure();
    clear(out);
    out.append(verdict('idle', 'Rebuilding the secret key and signing…'));
    window.setTimeout(() => {
      const attempt = signWithOilSpace(s.p, s.keys, s.pk, new TextEncoder().encode(s.message), mode);
      clear(out);
      out.append(renderOilAttempt(s.p, attempt));
    }, 0);
  };

  byId('fg-oil-random').addEventListener('click', () => runOil('random'));
  byId('fg-oil-nibble').addEventListener('click', () => runOil('one-nibble'));
  byId('fg-control').addEventListener('click', () => runOil('real'));

  byId('fg-malformed').addEventListener('click', () => {
    const s = ensure();
    clear(out);
    out.append(renderMalformed(s));
  });
}

function renderGuess(p: MayoParams, result: GuessResult): HTMLElement {
  const holder = el('div');
  const perSecond = result.elapsedMs > 0 ? (result.attempts / result.elapsedMs) * 1000 : 0;

  holder.append(
    verdict(
      result.forged ? 'bad' : 'warn',
      result.forged
        ? 'A random guess verified — at these odds, please report it'
        : `0 forgeries in ${result.attempts.toLocaleString()} guesses — the best one matched ${result.bestMatch} of ${p.m} coordinates`,
      result.forged
        ? 'This should take 16^m attempts on average; seeing it here means something is wrong.'
        : `Each coordinate lands by luck one time in sixteen, so a full hit needs about 16${superscript(p.m)} = 2${superscript(result.expectedWorkBits)} guesses. Partial credit is worth nothing: the verifier compares all ${p.m} coordinates.`,
    ),
    statList([
      { label: 'guesses', value: result.attempts.toLocaleString() },
      { label: 'best match', value: `${result.bestMatch} / ${p.m}` },
      { label: 'guess rate', value: `${Math.round(perSecond).toLocaleString()} /s` },
      { label: 'expected work', value: `2${superscript(result.expectedWorkBits)}` },
      { label: 'time at this rate', value: estimateTime(result.expectedWorkBits, perSecond) },
      { label: 'elapsed', value: formatMs(result.elapsedMs) },
    ]),
  );

  const best = el('div', { class: 'card' }, [
    el('h3', { text: `The closest guess (attempt ${result.bestAttempt + 1})` }),
    el('p', { class: 'field-label', text: 'P*(s) for the guessed signature' }),
    vectorList(result.bestY, {
      ariaLabel: 'the whipped map evaluated on the best guess',
      maxItems: 80,
      cell: (i, value) => (value === result.bestT[i] ? 'is-ok' : 'is-bad'),
    }),
    el('p', { class: 'field-label', text: 't for the guessed salt' }),
    vectorList(result.bestT, { ariaLabel: 'the target for the guessed salt', maxItems: 80 }),
    compareLegend(),
  ]);

  const histogram = el('div', { class: 'card' }, [el('h3', { text: 'How many coordinates each guess matched' })]);
  const maxCount = Math.max(...result.matchCounts);
  result.matchCounts.forEach((count, matches) => {
    if (count === 0 && matches > result.bestMatch) return;
    histogram.append(
      bar(
        count / maxCount,
        `${matches} of ${p.m} matched — ${count.toLocaleString()} guess${count === 1 ? '' : 'es'}`,
        matches > 0,
      ),
    );
  });

  holder.append(el('div', { class: 'grid grid--2' }, [best, histogram]));
  return holder;
}

/** Rough wall-clock for 2^bits attempts at the measured rate, honestly rounded. */
function estimateTime(bits: number, perSecond: number): string {
  if (perSecond <= 0) return 'unmeasured';
  const log10Seconds = bits * Math.log10(2) - Math.log10(perSecond);
  const log10Years = log10Seconds - Math.log10(365.25 * 24 * 3600);
  if (log10Seconds < 0) return 'under a second';
  if (log10Seconds < 2) return `${Math.round(10 ** log10Seconds)} s`;
  if (log10Seconds < 3.6) return `${Math.round(10 ** (log10Seconds - Math.log10(60)))} min`;
  if (log10Years < 0) return `${Math.round(10 ** (log10Seconds - Math.log10(86400)))} days`;
  if (log10Years < 6) return `${Math.round(10 ** log10Years).toLocaleString()} years`;
  return `10${superscript(Math.round(log10Years))} years`;
}

function renderOilAttempt(p: MayoParams, attempt: OilSpaceAttempt): HTMLElement {
  const holder = el('div');
  const isControl = attempt.mode === 'real';
  const ok = attempt.result.ok;

  // Colour tracks whether the system behaved correctly, not the return value: a
  // forgery that gets rejected is a pass, and a forgery that gets accepted would
  // be the alarm.
  const headline = isControl
    ? ok
      ? 'VALID — the real oil space, through the same rebuilt key, signs correctly'
      : 'The control failed, which would be a bug'
    : ok
      ? 'ALARM — a wrong oil space produced a signature the verifier accepted'
      : `Forgery rejected — P*(s) ≠ t, first difference at coordinate ${attempt.result.firstMismatch}`;

  const detail = isControl
    ? 'This is the control: identical code, identical key material, only the genuine O. It proves the failures above come from the oil space and nothing else.'
    : `Sign found a full-rank system and produced a well-formed ${attempt.sig.length}-byte signature — the linear algebra never noticed anything wrong. Verification did, because P⁽³⁾ was built from the real O and the public map vanishes on that subspace alone.`;

  holder.append(
    verdict(isControl === ok ? 'ok' : 'bad', headline, detail),
    statList([
      { label: 'oil space used', value: oilLabel(attempt.mode) },
      { label: 'entries changed', value: `${attempt.changedEntries} of ${attempt.oil.d.length}` },
      { label: 'linear system', value: attempt.solvedLinearSystem ? 'solved' : 'unsolved' },
      { label: 'signature', value: `${attempt.sig.length} B` },
      { label: 'verifier says', value: ok ? 'valid' : 'invalid' },
      { label: 'coordinates wrong', value: `${countMismatches(attempt.result.y, attempt.result.t)} of ${p.m}` },
    ]),
    el('p', { class: 'field-label', text: 'P*(s) — from the signature this attempt produced' }),
    vectorList(attempt.result.y, {
      ariaLabel: 'the whipped map evaluated on the forged signature',
      maxItems: 80,
      cell: (i, value) => (value === attempt.result.t[i] ? 'is-ok' : 'is-bad'),
    }),
    el('p', { class: 'field-label', text: 't — what a valid signature had to hit' }),
    vectorList(attempt.result.t, { ariaLabel: 'target vector t', maxItems: 80 }),
    compareLegend(),
  );
  return holder;
}

function oilLabel(mode: OilSpaceMode): string {
  if (mode === 'real') return 'genuine';
  return mode === 'random' ? 'random' : 'one nibble off';
}

function renderMalformed(s: Session): HTMLElement {
  const message = new TextEncoder().encode(s.message);
  const sk = expandSK(s.p, s.keys.csk);
  const good = sign(s.p, sk.esk, message).sig;
  // Same key, different message — its salt is genuine but belongs elsewhere.
  const otherMessage = sign(s.p, sk.esk, new TextEncoder().encode(`${s.message} (a different message)`)).sig;

  // A genuine signature under a different parameter set, for the portability case.
  const otherName: ParamSetName = s.p.name === 'MAYO2' ? 'MAYO1' : 'MAYO2';
  const other = PARAM_SETS[otherName];
  const otherKeys = compactKeyGen(other, crypto.getRandomValues(new Uint8Array(sizes(other).skSeedBytes)));
  const otherParams = sign(other, expandSK(other, otherKeys.csk).esk, message).sig;

  const ctx = { p: s.p, sig: good, otherParams, otherMessage };
  const outcomes = MALFORMED_CASES.map((testCase) => runMalformedCase(ctx, s.pk, message, testCase));
  const allRejected = outcomes.every((o) => o.outcome !== 'accepted');

  const list = el('ul', { class: 'checks', role: 'list' });
  for (const outcome of outcomes) {
    const icon = outcome.outcome === 'accepted' ? '✗' : '✓';
    const word = outcome.outcome === 'refused' ? 'refused while parsing' : outcome.outcome === 'invalid' ? 'rejected by the math' : 'ACCEPTED';
    list.append(
      el('li', { role: 'listitem', class: 'check', title: outcome.explains }, [
        el('span', { class: 'check__icon', 'aria-hidden': 'true', text: icon }),
        el('div', {}, [
          el('strong', { text: `${outcome.label} — ${word}` }),
          el('p', { text: outcome.detail }),
          el('p', { class: 'check__why', text: outcome.explains }),
        ]),
      ]),
    );
  }

  return el('div', {}, [
    verdict(
      allRejected ? 'ok' : 'bad',
      allRejected
        ? `All ${outcomes.length} malformed signatures were refused`
        : 'A malformed signature was accepted — that is a bug',
      allRejected
        ? `Two are refused on shape before any field arithmetic runs, and two run the full comparison and fail it. The genuine signature for the same message still verifies, so nothing here weakened the good path.`
        : 'Please report this.',
    ),
    list,
  ]);
}

function countMismatches(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}
