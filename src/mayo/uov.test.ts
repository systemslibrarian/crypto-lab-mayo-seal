import { describe, expect, it } from 'vitest';
import { MAYO1, MAYO2, MAYO3, MAYO5, sizes } from './params';
import { compareWithUov, computeTradeoffs, publicKeyBytes, signatureBytes, sizeBreakdown } from './uov';

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
