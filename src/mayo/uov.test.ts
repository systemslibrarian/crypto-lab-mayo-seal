import { describe, expect, it } from 'vitest';
import { MAYO1, MAYO2, MAYO3, MAYO5, sizes, TOY } from './params';
import {
  compareWithUov,
  computeTradeoffs,
  publicKeyBytes,
  signatureBytes,
  sizeBreakdown,
  smallestSolvableK,
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
  it.each([MAYO1, MAYO2, MAYO3, MAYO5])('$name: k is exactly the smallest whipping factor that solves', (p) => {
    // The headline claim behind Exhibit 2's slider: the whipping is turned up
    // just far enough for k·o > m, and no further, because every extra copy adds
    // n more field elements to the signature.
    expect(smallestSolvableK(p.m, p.o)).toBe(p.k);
  });

  it.each([MAYO1, MAYO2, MAYO3, MAYO5])('$name: one copy fewer is unsolvable, one more is dearer', (p) => {
    const below = whipBalance(p.m, p.o, p.n, p.k - 1, p.saltBytes);
    const at = whipBalance(p.m, p.o, p.n, p.k, p.saltBytes);
    const above = whipBalance(p.m, p.o, p.n, p.k + 1, p.saltBytes);
    expect(below.solvable).toBe(false);
    expect(below.slack).toBeLessThanOrEqual(0);
    expect(at.solvable).toBe(true);
    expect(above.solvable).toBe(true);
    expect(above.signatureBytes).toBeGreaterThan(at.signatureBytes);
  });

  it('TOY: the same rule picks k = 3', () => {
    expect(smallestSolvableK(TOY.m, TOY.o)).toBe(TOY.k);
    expect(whipBalance(TOY.m, TOY.o, TOY.n, 1, TOY.saltBytes).slack).toBe(-3);
    expect(whipBalance(TOY.m, TOY.o, TOY.n, 2, TOY.saltBytes).slack).toBe(0);
    expect(whipBalance(TOY.m, TOY.o, TOY.n, 3, TOY.saltBytes).slack).toBe(3);
  });

  it('k·o = m exactly is not enough', () => {
    // m equations in m unknowns is square: solvable only when the matrix happens
    // to be invertible, which is not something a signer can rely on.
    expect(whipBalance(6, 3, 9, 2, 8).solvable).toBe(false);
  });
});

describe('MAYO versus the unwhipped map (k = 1)', () => {
  it('MAYO2 shows roughly the 14× / 2× trade the spec claims', () => {
    // Spec §1: versus compressed Oil-and-Vinegar at the same security level,
    // (n,m,o,k) = (81,64,17,4) is "a 14-fold reduction in public key size at the
    // cost of a 2-fold increase in signature size".
    const c = compareWithUov(MAYO2);
    expect(c.uov.o).toBe(MAYO2.m);
    expect(c.uov.k).toBe(1);
    expect(c.pkRatio).toBeGreaterThan(13);
    expect(c.pkRatio).toBeLessThan(15);
    expect(c.sigRatio).toBeGreaterThan(1.8);
    expect(c.sigRatio).toBeLessThan(2.4);
  });

  it.each([MAYO1, MAYO2, MAYO3, MAYO5])('$name: dropping the whip costs at least 10× in key size', (p) => {
    expect(compareWithUov(p).pkRatio).toBeGreaterThan(10);
  });

  it('agrees with the closed-form size helpers', () => {
    expect(publicKeyBytes(78, 8)).toBe(sizes(MAYO1).cpkBytes);
    expect(signatureBytes(86, 10, 24)).toBe(sizes(MAYO1).sigBytes);
  });
});
