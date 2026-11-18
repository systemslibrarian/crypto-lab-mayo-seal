import { describe, expect, it } from 'vitest';
import { MAYO1, MAYO2, MAYO3, MAYO5, maxWhippingFactor, sizes, TOY } from './params';
import {
  compareWithUov,
  fullRowRankProbability,
  rankDeficientProbability,
  computeTradeoffs,
  publicKeyBytes,
  signatureBytes,
  sizeBreakdown,
  restartProbabilityBits,
  smallestKWithRoom,
  whipBalance,
} from './uov';

describe('size ledger', () => {
  it.each([MAYO1, MAYO2, MAYO3, MAYO5])('$name: breakdown adds up to the real key sizes', (p) => {
    const b = sizeBreakdown(p);
    const sz = sizes(p);
    expect(b.seed + b.p3).toBe(b.publicKey);
    expect(b.publicKey).toBe(p.quoted!.pk);
    expect(b.signature).toBe(p.quoted!.sig);
    expect(b.expandedFromSeed).toBe(sz.p1Bytes + sz.p2Bytes);
    // The seed does nearly all the work: what it expands to dwarfs what ships.
    expect(b.expandedFromSeed).toBeGreaterThan(b.publicKey * 10);
  });

  it('reproduces every public-key size in the spec trade-off table', () => {
    for (const row of computeTradeoffs()) {
      expect(row.pkMatches, `n=${row.n} m=${row.m} o=${row.o} k=${row.k}`).toBe(true);
    }
  });

  it('matches the printed signature size wherever n·k is even', () => {
    for (const row of computeTradeoffs()) {
      if ((row.n * row.k) % 2 === 0) {
        expect(row.sigMatches, `n=${row.n} k=${row.k}`).toBe(true);
      } else {
        // Odd n·k needs ⌈n·k/2⌉ bytes; the printed table rounds down by one.
        expect(row.computedSig).toBe(row.quotedSig + 1);
      }
    }
  });

  it('shows public key growing and signature shrinking as o grows', () => {
    const rows = computeTradeoffs();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].o).toBeGreaterThan(rows[i - 1].o);
      expect(rows[i].k).toBeLessThan(rows[i - 1].k);
      expect(rows[i].computedPk).toBeGreaterThan(rows[i - 1].computedPk);
      expect(rows[i].computedSig).toBeLessThan(rows[i - 1].computedSig);
    }
  });

  it('keeps every trade-off row solvable: k·o > m', () => {
    for (const row of computeTradeoffs()) expect(row.k * row.o).toBeGreaterThan(row.m);
  });
});

describe('why k is what it is', () => {
  it.each([MAYO1, MAYO2, MAYO3, MAYO5])('$name: k is the smallest whipping factor with at least m unknowns', (p) => {
    expect(p.k).toBe(Math.ceil(p.m / p.o));
  });

  it.each([MAYO1, MAYO2, MAYO3, MAYO5])('$name: one copy fewer is short, one more is dearer', (p) => {
    const below = whipBalance(p.m, p.o, p.n, p.k - 1, p.saltBytes);
    const at = whipBalance(p.m, p.o, p.n, p.k, p.saltBytes);
    const above = whipBalance(p.m, p.o, p.n, p.k + 1, p.saltBytes);
    expect(below.status).toBe('short');
    expect(below.slack).toBeLessThanOrEqual(0);
    expect(at.status).toBe(p === MAYO1 ? 'exact' : 'slack');
    expect(above.status).toBe('slack');
    expect(above.signatureBytes).toBeGreaterThan(at.signatureBytes);
  });

  it('TOY: the same rule picks k = 3', () => {
    expect(smallestKWithRoom(TOY.m, TOY.o)).toBe(TOY.k);
    expect(whipBalance(TOY.m, TOY.o, TOY.n, 1, TOY.saltBytes).slack).toBe(-3);
    expect(whipBalance(TOY.m, TOY.o, TOY.n, 2, TOY.saltBytes).slack).toBe(0);
    expect(whipBalance(TOY.m, TOY.o, TOY.n, 3, TOY.saltBytes).slack).toBe(3);
  });

  it('distinguishes short, exact and slack rather than solvable / not solvable', () => {
    const short = whipBalance(6, 3, 9, 1, 8);
    expect(short.status).toBe('short');
    // Not impossible — a random target is hit about once in 16³.
    expect(short.unreachableBits).toBe(12);
    expect(short.restartBits).toBeNull();

    const exact = whipBalance(6, 3, 9, 2, 8);
    expect(exact.status).toBe('exact');
    expect(exact.unreachableBits).toBeNull();
    // A square draw is invertible about 93% of the time, so it retries ~7%.
    expect(exact.restartBits!).toBeGreaterThan(3);
    expect(exact.restartBits!).toBeLessThan(4);

    const slack = whipBalance(6, 3, 9, 3, 8);
    expect(slack.status).toBe('slack');
    expect(slack.slack).toBe(3);
    expect(slack.restartBits!).toBeGreaterThan(15);
  });

  it('no shipped set claims a guarantee: every one can still need a retry', () => {
    for (const p of [MAYO1, MAYO2, MAYO3, MAYO5]) {
      const at = whipBalance(p.m, p.o, p.n, p.k, p.saltBytes);
      expect(at.restartBits).not.toBeNull();
      expect(Number.isFinite(at.restartBits!)).toBe(true);
    }
  });

  it.each([[MAYO1, 3.91], [MAYO2, 7.91], [MAYO3, 11.91], [MAYO5, 11.91]] as const)(
    '%s: models the round-3 restart probability from the shipped dimensions',
    (p, bits) => expect(restartProbabilityBits(p.m, p.k * p.o)).toBeCloseTo(bits, 2),
  );

  it('keeps the retry figure finite where the naive 1 − product underflows', () => {
    // Regression: computing 1 − ∏(1 − 16^(i−N)) in double precision rounds to
    // exactly 0 once the slack is large, and the UI printed "2^Infinity" when the
    // slider went two copies past MAYO2's shipped k.
    for (const [m, n] of [
      [64, 85],
      [64, 102],
      [6, 15],
      [142, 168],
    ]) {
      const bits = restartProbabilityBits(m, n);
      expect(Number.isFinite(bits), `m=${m} N=${n} gave ${bits}`).toBe(true);
      expect(bits).toBeGreaterThan(0);
    }
    // The naive form is the thing that breaks, so check we are past it.
    const naive = 1 - [...Array(64).keys()].reduce((p, i) => p * (1 - 16 ** (i - 85)), 1);
    expect(naive).toBe(0);
    expect(rankDeficientProbability(64, 85)).toBeGreaterThan(0);
  });

  it('every stop the slider can reach prints a real number', () => {
    // whipviz falls back to words when the figure is not finite. That fallback is
    // honest, but it should never actually fire: if it does, the exhibit is
    // showing prose where it promised a number. Walk the slider's real range.
    let worst = 0;
    let worstAt = '';
    for (const p of [TOY, MAYO1, MAYO2, MAYO3, MAYO5]) {
      const max = Math.min(Math.max(p.k + 2, 4), maxWhippingFactor(p));
      for (let k = 1; k <= max; k++) {
        const b = whipBalance(p.m, p.o, p.n, k, 24);
        if (b.status === 'short') {
          expect(b.restartBits, `${p.name} k=${k} is short`).toBeNull();
          continue;
        }
        expect(
          Number.isFinite(b.restartBits!),
          `${p.name} k=${k}: restartBits=${b.restartBits}`,
        ).toBe(true);
        if (b.restartBits! > worst) {
          worst = b.restartBits!;
          worstAt = `${p.name} k=${k}`;
        }
      }
    }
    // The largest figure any stop can reach, quoted in rankDeficientProbability's
    // comment as the reason the fallback stays dormant.
    expect(worstAt).toBe('MAYO2 k=7');
    expect(worst).toBeGreaterThan(110);
    expect(worst).toBeLessThan(112);
  });

  it('rank deficiency is impossible to rule out but easy to detect', () => {
    // Fewer unknowns than equations can never have full row rank.
    expect(fullRowRankProbability(6, 3)).toBe(0);
    // And more unknowns never reaches certainty.
    expect(fullRowRankProbability(6, 9)).toBeLessThan(1);
    expect(fullRowRankProbability(6, 9)).toBeGreaterThan(0.99);
  });
});

describe('MAYO versus the unwhipped map (k = 1)', () => {
  it('MAYO2 computes the round-3 size trade against the unwhipped model', () => {
    const c = compareWithUov(MAYO2);
    expect(c.uov.o).toBe(64);
    expect(c.uov.k).toBe(1);
    expect(c.pkRatio).toBeCloseTo(66_576 / 2_928, 8);
    expect(c.sigRatio).toBeCloseTo(239 / 88, 8);
  });

  it.each([MAYO1, MAYO2, MAYO3, MAYO5])('$name: dropping the whip costs at least 10× in key size', (p) => {
    expect(compareWithUov(p).pkRatio).toBeGreaterThan(10);
  });

  it('agrees with the closed-form size helpers', () => {
    expect(publicKeyBytes(80, 8)).toBe(sizes(MAYO1).cpkBytes);
    expect(signatureBytes(88, 10, 24)).toBe(sizes(MAYO1).sigBytes);
  });
});
