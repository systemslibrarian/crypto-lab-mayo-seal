/**
 * The whipping construction — the part of MAYO that is actually new.
 *
 * MAYO's public matrices E_{i,j} ∈ F16^{m×m} are the matrix representations of
 * multiplication by z⁰, z¹, … in the field F16[z]/f(z), where f is irreducible
 * of degree m. Two consequences the rest of the scheme leans on:
 *
 *  1. Every non-trivial F16-linear combination of the E matrices is a *nonzero
 *     field element*, hence invertible, hence has full rank m. That is the
 *     property the spec footnote demands of the E-matrices, and it is why the
 *     whipped map cannot collapse.
 *  2. Multiplying by E^ℓ never needs the m×m matrix: it is multiplication by zˡ
 *     in the field, which is a shift and one reduction. That is what mulZPow
 *     does, and it is how both Sign and Verify accumulate their m-vectors.
 */
import { mat, mul, type Mat } from './gf16';

/** Multiply u by z in F16[z]/f(z). f is monic of degree m, so z^m = Σ f[i]·zⁱ. */
export function mulZ(f: Uint8Array, u: Uint8Array): Uint8Array {
  const m = f.length - 1;
  const out = new Uint8Array(m);
  const carry = u[m - 1];
  for (let i = m - 1; i >= 1; i--) out[i] = u[i - 1];
  if (carry !== 0) {
    for (let i = 0; i < m; i++) out[i] ^= mul(carry, f[i]);
  }
  return out;
}

/** E^ℓ·u, i.e. zˡ·u in F16[z]/f(z). */
export function mulZPow(f: Uint8Array, u: Uint8Array, l: number): Uint8Array {
  let acc = u;
  for (let i = 0; i < l; i++) acc = mulZ(f, acc);
  return acc;
}

/** In-place: dst ^= zˡ·u. Used to accumulate y and the columns of A. */
export function addMulZPowInto(f: Uint8Array, dst: Uint8Array, u: Uint8Array, l: number): void {
  const shifted = mulZPow(f, u, l);
  for (let i = 0; i < dst.length; i++) dst[i] ^= shifted[i];
}

/** Materializes E^ℓ as an m×m matrix (for display and for rank tests). */
export function emulsifierMatrix(f: Uint8Array, l: number): Mat {
  const m = f.length - 1;
  const e = mat(m, m);
  const basis = new Uint8Array(m);
  for (let j = 0; j < m; j++) {
    basis.fill(0);
    basis[j] = 1;
    const col = mulZPow(f, basis, l);
    for (let i = 0; i < m; i++) e.d[i * m + j] = col[i];
  }
  return e;
}

/**
 * The (i, j) → ℓ numbering used by Sign and Verify: i ascending, j descending
 * from k−1 down to i. Also the numbering of the spec's Z(k×k) matrix, whose
 * entry [i][j] is z^ℓ(i,j).
 */
export function whipPairs(k: number): Array<{ i: number; j: number; l: number }> {
  const out: Array<{ i: number; j: number; l: number }> = [];
  let l = 0;
  for (let i = 0; i < k; i++) {
    for (let j = k - 1; j >= i; j--) out.push({ i, j, l: l++ });
  }
  return out;
}

/* ---------- polynomial arithmetic in F16[z], for structural checks ---------- */

function trim(p: number[]): number[] {
  while (p.length > 0 && p[p.length - 1] === 0) p.pop();
  return p;
}

function polyAdd(a: number[], b: number[]): number[] {
  const out = new Array<number>(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  return trim(out);
}

function polyMul(a: number[], b: number[]): number[] {
  if (a.length === 0 || b.length === 0) return [];
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] !== 0) out[i + j] ^= mul(a[i], b[j]);
    }
  }
  return trim(out);
}

/** Remainder of a divided by monic-or-not b, over F16. */
function polyMod(a: number[], b: number[]): number[] {
  const r = a.slice();
  const db = b.length - 1;
  const lead = b[db];
  const leadInv = invF16(lead);
  while (r.length > 0 && r.length - 1 >= db) {
    const shift = r.length - 1 - db;
    const c = mul(r[r.length - 1], leadInv);
    for (let i = 0; i <= db; i++) r[i + shift] ^= mul(c, b[i]);
    trim(r);
  }
  return r;
}

function invF16(a: number): number {
  for (let b = 1; b < 16; b++) if (mul(a, b) === 1) return b;
  throw new Error('invF16: 0 has no inverse');
}

function polyMulMod(a: number[], b: number[], f: number[]): number[] {
  return polyMod(polyMul(a, b), f);
}

function polyGcd(a: number[], b: number[]): number[] {
  let x = trim(a.slice());
  let y = trim(b.slice());
  while (y.length > 0) {
    const r = polyMod(x, y);
    x = y;
    y = r;
  }
  return x;
}

/** u^16 mod f, by four squarings. */
function pow16(u: number[], f: number[]): number[] {
  let acc = u;
  for (let i = 0; i < 4; i++) acc = polyMulMod(acc, acc, f);
  return acc;
}

/**
 * Is f irreducible over F16? Uses the standard criterion: z^(16^m) ≡ z (mod f),
 * and gcd(z^(16^d) − z, f) = 1 for every proper divisor d of m.
 */
export function isIrreducible(f: Uint8Array): boolean {
  const fp = Array.from(f);
  const m = fp.length - 1;
  const z = [0, 1];
  let cur = z;
  for (let d = 1; d <= m; d++) {
    cur = pow16(cur, fp);
    const diff = polyAdd(cur, z);
    if (d === m) {
      if (diff.length !== 0) return false;
    } else if (m % d === 0) {
      if (polyGcd(diff, fp).length - 1 > 0) return false;
    }
  }
  return true;
}

/**
 * The spec's other requirement on f: it must not divide det Z(k×k), where
 * Z[i][j] = z^ℓ(i,j). Equivalently — and this is what we check — Z is invertible
 * over F16[z]/f(z), so we run Gaussian elimination there and report whether the
 * determinant came out nonzero.
 */
export function detZNonzeroModF(f: Uint8Array, k: number): boolean {
  const fp = Array.from(f);
  const z: number[][][] = Array.from({ length: k }, () => Array.from({ length: k }, () => [] as number[]));
  for (const { i, j, l } of whipPairs(k)) {
    const zl = polyMod(
      Array.from({ length: l + 1 }, (_, idx) => (idx === l ? 1 : 0)),
      fp,
    );
    z[i][j] = zl;
    z[j][i] = zl;
  }
  for (let c = 0; c < k; c++) {
    let piv = -1;
    for (let r = c; r < k; r++) {
      if (z[r][c].length > 0) {
        piv = r;
        break;
      }
    }
    if (piv < 0) return false;
    if (piv !== c) {
      const t = z[c];
      z[c] = z[piv];
      z[piv] = t;
    }
    const pivInv = polyInvMod(z[c][c], fp);
    for (let r = c + 1; r < k; r++) {
      if (z[r][c].length === 0) continue;
      const factor = polyMulMod(z[r][c], pivInv, fp);
      for (let j = c; j < k; j++) {
        z[r][j] = polyAdd(z[r][j], polyMulMod(factor, z[c][j], fp));
      }
    }
  }
  return true;
}

/** Inverse in F16[z]/f(z), via the extended Euclidean algorithm. */
function polyInvMod(a: number[], f: number[]): number[] {
  let r0 = f.slice();
  let r1 = trim(a.slice());
  let s0: number[] = [];
  let s1: number[] = [1];
  while (r1.length > 0) {
    const { q, rem } = polyDivMod(r0, r1);
    r0 = r1;
    r1 = rem;
    const nextS = polyAdd(s0, polyMul(q, s1));
    s0 = s1;
    s1 = nextS;
  }
  if (r0.length !== 1) throw new Error('polyInvMod: not invertible');
  return polyMod(polyMul(s0, [invF16(r0[0])]), f);
}

function polyDivMod(a: number[], b: number[]): { q: number[]; rem: number[] } {
  const rem = a.slice();
  const db = b.length - 1;
  const leadInv = invF16(b[db]);
  const q = new Array<number>(Math.max(1, a.length - db)).fill(0);
  while (rem.length > 0 && rem.length - 1 >= db) {
    const shift = rem.length - 1 - db;
    const c = mul(rem[rem.length - 1], leadInv);
    q[shift] ^= c;
    for (let i = 0; i <= db; i++) rem[i + shift] ^= mul(c, b[i]);
    trim(rem);
  }
  return { q: trim(q), rem };
}
