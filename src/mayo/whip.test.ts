import { describe, expect, it } from 'vitest';
import { mat, matMul, matVecMul, rank, vecEqual } from './gf16';
import { MAYO1, MAYO2, MAYO3, MAYO5, TOY } from './params';
import { detZNonzeroModF, emulsifierMatrix, isIrreducible, mulZ, mulZPow, whipPairs } from './whip';

const ALL = [TOY, MAYO1, MAYO2, MAYO3, MAYO5];

describe('the emulsifier polynomials f(z)', () => {
  it.each(ALL)('$name: $fName is irreducible over F16', (p) => {
    expect(isIrreducible(p.f)).toBe(true);
  });

  it.each(ALL)('$name: f does not divide det Z(k×k)', (p) => {
    // The spec's second requirement on f. Equivalent to Z being invertible over
    // F16[z]/f(z), which is what we check.
    expect(detZNonzeroModF(p.f, p.k)).toBe(true);
  });

  it('rejects a reducible polynomial', () => {
    // z² + 1 = (z + 1)² in characteristic 2.
    expect(isIrreducible(Uint8Array.from([1, 0, 1]))).toBe(false);
  });
});

describe('E-matrices', () => {
  it.each([TOY, MAYO2])('$name: every non-trivial combination of E^ℓ has rank m', (p) => {
    // This is the property the spec footnote demands. The E^ℓ are multiplication
    // by zˡ in a field, so any nonzero F16-combination is an invertible field
    // element; we spot-check that claim on random combinations.
    const count = (p.k * (p.k + 1)) / 2;
    const powers = Array.from({ length: count }, (_, l) => emulsifierMatrix(p.f, l));
    for (let trial = 0; trial < 6; trial++) {
      const combo = mat(p.m, p.m);
      let nonzero = false;
      for (let l = 0; l < count; l++) {
        const c = (trial * 5 + l * 3) % 16;
        if (c === 0) continue;
        nonzero = true;
        for (let idx = 0; idx < combo.d.length; idx++) {
          combo.d[idx] ^= mulCoeff(c, powers[l].d[idx]);
        }
      }
      if (!nonzero) continue;
      expect(rank(combo)).toBe(p.m);
    }
  });

  it('E^0 is the identity and E^ℓ matches repeated multiplication by z', () => {
    const p = TOY;
    const e0 = emulsifierMatrix(p.f, 0);
    for (let i = 0; i < p.m; i++) {
      for (let j = 0; j < p.m; j++) expect(e0.d[i * p.m + j]).toBe(i === j ? 1 : 0);
    }
    const e1 = emulsifierMatrix(p.f, 1);
    const e3 = emulsifierMatrix(p.f, 3);
    expect(Array.from(e3.d)).toEqual(Array.from(matMul(matMul(e1, e1), e1).d));
  });

  it.each(ALL)('$name: mulZPow agrees with the materialised matrix', (p) => {
    const u = Uint8Array.from({ length: p.m }, (_, i) => (i * 7 + 5) % 16);
    for (const l of [0, 1, 2, (p.k * (p.k + 1)) / 2 - 1]) {
      const viaMatrix = matVecMul(emulsifierMatrix(p.f, l), u);
      expect(vecEqual(mulZPow(p.f, u, l), viaMatrix), `ℓ=${l}`).toBe(true);
    }
  });

  it('reduces exactly when the top coefficient falls off', () => {
    const p = TOY; // f6(z) = z⁶ + (x³+1)z² + z + 1
    const top = Uint8Array.from([0, 0, 0, 0, 0, 1]); // z⁵
    // z·z⁵ = z⁶ = (x³+1)z² + z + 1
    expect(Array.from(mulZ(p.f, top))).toEqual([1, 1, 9, 0, 0, 0]);
  });
});

describe('the (i, j) → ℓ pair numbering', () => {
  it.each(ALL)('$name: covers each unordered pair once, ℓ = 0 … k(k+1)/2 − 1', (p) => {
    const pairs = whipPairs(p.k);
    expect(pairs.length).toBe((p.k * (p.k + 1)) / 2);
    expect(pairs.map((x) => x.l)).toEqual(pairs.map((_, idx) => idx));
    const seen = new Set(pairs.map(({ i, j }) => `${Math.min(i, j)}:${Math.max(i, j)}`));
    expect(seen.size).toBe(pairs.length);
    for (const { i, j } of pairs) expect(i).toBeLessThanOrEqual(j);
  });

  it('matches the spec Z(3×3) layout', () => {
    // Z[0][2] = z⁰, Z[0][1] = z¹, Z[0][0] = z², Z[1][2] = z³, Z[1][1] = z⁴, Z[2][2] = z⁵
    const pairs = whipPairs(3);
    expect(pairs).toEqual([
      { i: 0, j: 2, l: 0 },
      { i: 0, j: 1, l: 1 },
      { i: 0, j: 0, l: 2 },
      { i: 1, j: 2, l: 3 },
      { i: 1, j: 1, l: 4 },
      { i: 2, j: 2, l: 5 },
    ]);
  });
});

function mulCoeff(a: number, b: number): number {
  let r = 0;
  for (let i = 0; i < 4; i++) if ((b >> i) & 1) r ^= a << i;
  for (let bit = 6; bit >= 4; bit--) if ((r >> bit) & 1) r ^= 0b10011 << (bit - 4);
  return r & 0xf;
}
