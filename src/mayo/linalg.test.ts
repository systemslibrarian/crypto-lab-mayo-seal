import { describe, expect, it } from 'vitest';
import { mat, matVecMul, rank, vecEqual } from './gf16';
import { echelonForm, sampleSolution, solveGeneral } from './linalg';

function randomMat(rows: number, cols: number, seed: number) {
  return mat(
    rows,
    cols,
    Uint8Array.from({ length: rows * cols }, (_, i) => (seed * 13 + i * 7 + ((i * i) % 11)) % 16),
  );
}

describe('EF — echelon form with leading ones (Algorithm 1)', () => {
  it('produces leading ones at strictly increasing columns, zero rows last', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { b, pivots } = echelonForm(randomMat(5, 7, seed));
      let last = -1;
      let seenZeroRow = false;
      for (let i = 0; i < b.rows; i++) {
        const lead = pivots[i];
        if (lead < 0) {
          seenZeroRow = true;
          continue;
        }
        expect(seenZeroRow, 'zero rows must be at the bottom').toBe(false);
        expect(lead).toBeGreaterThan(last);
        expect(b.d[i * b.cols + lead]).toBe(1);
        last = lead;
      }
    }
  });

  it('preserves rank', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const a = randomMat(6, 6, seed);
      expect(rank(echelonForm(a).b)).toBe(rank(a));
    }
  });

  it('handles an all-zero matrix', () => {
    const { b, pivots } = echelonForm(mat(3, 4));
    expect(Array.from(b.d)).toEqual(new Array(12).fill(0));
    expect(pivots).toEqual([-1, -1, -1]);
  });
});

describe('SampleSolution (Algorithm 2)', () => {
  it('returns a genuine solution for a full-rank wide system', () => {
    let solved = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const a = randomMat(6, 9, seed);
      if (rank(a) < 6) continue;
      const y = Uint8Array.from({ length: 6 }, (_, i) => (seed * 5 + i) % 16);
      const r = Uint8Array.from({ length: 9 }, (_, i) => (seed * 3 + i * 2) % 16);
      const res = sampleSolution(a, y, r);
      expect(res.x).not.toBeNull();
      expect(vecEqual(matVecMul(a, res.x!), y)).toBe(true);
      solved++;
    }
    expect(solved).toBeGreaterThan(10);
  });

  it('reports rank deficiency instead of returning a bogus solution', () => {
    const a = mat(3, 5);
    // Rows 2 and 3 are multiples of row 1, so rank is 1 < m = 3.
    a.d.set([1, 2, 3, 4, 5], 0);
    a.d.set([2, 4, 6, 8, 10].map((v) => v % 16), 5);
    const res = sampleSolution(a, Uint8Array.from([1, 2, 3]), new Uint8Array(5));
    expect(res.x).toBeNull();
    expect(res.rankDeficient).toBe(true);
  });

  it('different randomizers give different solutions to the same system', () => {
    const a = randomMat(4, 8, 3);
    const y = Uint8Array.from([1, 2, 3, 4]);
    const first = sampleSolution(a, y, new Uint8Array(8));
    const second = sampleSolution(a, y, Uint8Array.from([5, 0, 9, 3, 1, 12, 7, 2]));
    expect(first.x).not.toBeNull();
    expect(second.x).not.toBeNull();
    expect(vecEqual(matVecMul(a, first.x!), y)).toBe(true);
    expect(vecEqual(matVecMul(a, second.x!), y)).toBe(true);
    expect(vecEqual(first.x!, second.x!)).toBe(false);
  });

  it('refuses a system with fewer unknowns than equations', () => {
    expect(() => sampleSolution(mat(4, 3), new Uint8Array(4), new Uint8Array(3))).toThrow(/ko >= m/);
  });
});

describe('solveGeneral — the honest answer for an over-determined system', () => {
  it('finds a solution when one exists', () => {
    const a = randomMat(6, 3, 5);
    const x = Uint8Array.from([3, 9, 1]);
    const y = matVecMul(a, x);
    const res = solveGeneral(a, y);
    expect(res.contradictionRow).toBeNull();
    expect(res.x).not.toBeNull();
    expect(vecEqual(matVecMul(a, res.x!), y)).toBe(true);
  });

  it('points at the contradiction when none exists', () => {
    const a = randomMat(6, 3, 5);
    const y = Uint8Array.from([1, 1, 1, 1, 1, 1]);
    const res = solveGeneral(a, y);
    if (res.x === null) {
      expect(res.contradictionRow).not.toBeNull();
      const row = res.contradictionRow!;
      // The offending row reads 0 · x = nonzero.
      for (let j = 0; j < a.cols; j++) expect(res.echelon.d[row * (a.cols + 1) + j]).toBe(0);
      expect(res.echelon.d[row * (a.cols + 1) + a.cols]).not.toBe(0);
    }
  });
});
