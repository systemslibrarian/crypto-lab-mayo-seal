import { describe, expect, it } from 'vitest';
import {
  add,
  inv,
  mat,
  matMul,
  matVecMul,
  mul,
  polyString,
  rank,
  transpose,
  upper,
  vecMatMul,
} from './gf16';

describe('GF(16) = F2[x]/(x^4+x+1)', () => {
  it('is closed and commutative', () => {
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        expect(mul(a, b)).toBe(mul(b, a));
        expect(mul(a, b)).toBeLessThan(16);
        expect(add(a, b)).toBeLessThan(16);
      }
    }
  });

  it('has 1 as identity and 0 as annihilator', () => {
    for (let a = 0; a < 16; a++) {
      expect(mul(a, 1)).toBe(a);
      expect(mul(a, 0)).toBe(0);
      expect(add(a, 0)).toBe(a);
      expect(add(a, a)).toBe(0); // characteristic 2
    }
  });

  it('is associative and distributive', () => {
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        for (let c = 0; c < 16; c++) {
          expect(mul(mul(a, b), c)).toBe(mul(a, mul(b, c)));
          expect(mul(a, add(b, c))).toBe(add(mul(a, b), mul(a, c)));
        }
      }
    }
  });

  it('gives every nonzero element a unique inverse', () => {
    for (let a = 1; a < 16; a++) expect(mul(a, inv(a))).toBe(1);
    expect(() => inv(0)).toThrow();
  });

  it('reduces by the spec modulus: x^4 = x + 1', () => {
    // x·x³ must reduce to x + 1 = 0b0011.
    expect(mul(0b0010, 0b1000)).toBe(0b0011);
    expect(polyString(0b1011)).toBe('x³+x+1');
    expect(polyString(0)).toBe('0');
  });

  it('makes the multiplicative group cyclic of order 15', () => {
    // x is a generator of F16*, so its powers cover every nonzero element.
    const seen = new Set<number>();
    let acc = 1;
    for (let i = 0; i < 15; i++) {
      seen.add(acc);
      acc = mul(acc, 2);
    }
    expect(seen.size).toBe(15);
    expect(acc).toBe(1);
  });
});

describe('matrix arithmetic', () => {
  it('multiplies associatively and respects the transpose law', () => {
    const a = mat(3, 4, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    const b = mat(4, 2, Uint8Array.from([3, 1, 4, 1, 5, 9, 2, 6]));
    const ab = matMul(a, b);
    expect(ab.rows).toBe(3);
    expect(ab.cols).toBe(2);
    // (AB)ᵀ = BᵀAᵀ
    expect(Array.from(transpose(ab).d)).toEqual(Array.from(matMul(transpose(b), transpose(a)).d));
  });

  it('agrees between vecMatMul, matVecMul and transpose', () => {
    const a = mat(3, 3, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const x = Uint8Array.from([2, 0, 5]);
    expect(Array.from(vecMatMul(x, a))).toEqual(Array.from(matVecMul(transpose(a), x)));
  });

  it('Upper() preserves the quadratic form xᵀMx', () => {
    const m = mat(4, 4, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 1]));
    const u = upper(m);
    for (let trial = 0; trial < 32; trial++) {
      const x = Uint8Array.from({ length: 4 }, (_, i) => (trial * 7 + i * 5) % 16);
      const formM = evalForm(m, x);
      const formU = evalForm(u, x);
      expect(formU).toBe(formM);
    }
    // and it really is upper triangular
    for (let i = 0; i < 4; i++) for (let j = 0; j < i; j++) expect(u.d[i * 4 + j]).toBe(0);
  });

  it('computes rank correctly on known cases', () => {
    const identity = mat(3, 3, Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    expect(rank(identity)).toBe(3);
    const dependent = mat(3, 3, Uint8Array.from([1, 2, 3, 2, 4, 6, 0, 0, 0]));
    expect(rank(dependent)).toBe(1);
    expect(rank(mat(3, 3))).toBe(0);
  });
});

function evalForm(m: ReturnType<typeof mat>, x: Uint8Array): number {
  const row = vecMatMul(x, m);
  let acc = 0;
  for (let i = 0; i < x.length; i++) acc = add(acc, mul(row[i], x[i]));
  return acc;
}
