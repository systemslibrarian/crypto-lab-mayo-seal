/**
 * MAYO parameter sets — round-2 submission, Table 2.1 (pqmayo.org).
 *
 * MAYO1 and MAYO2 are the real NIST security level 1 sets and run unmodified in
 * this page. TOY is a deliberately tiny, non-secure set whose matrices fit on
 * screen; it exists so the whipping step can be *watched*, not asserted.
 */

/** A polynomial in F16[z] given as { degree: coefficient }, monic term implied. */
type PolyTerms = Record<number, number>;

export interface MayoParams {
  /** Machine name, also the label used in the UI. */
  readonly name: string;
  /** Number of variables in the public map P. */
  readonly n: number;
  /** Number of quadratic equations in P. */
  readonly m: number;
  /** Dimension of the secret oil space O. */
  readonly o: number;
  /** Whipping parameter: how many copies of P get emulsified together. */
  readonly k: number;
  /** Field size — fixed at 16 throughout MAYO. */
  readonly q: 16;
  readonly saltBytes: number;
  readonly digestBytes: number;
  readonly pkSeedBytes: number;
  /** Coefficients of f(z), length m + 1, index = degree, f[m] = 1. */
  readonly f: Uint8Array;
  /** Human-readable name of f(z), e.g. "f78(z)". */
  readonly fName: string;
  /** NIST security level, or null for the toy set. */
  readonly securityLevel: number | null;
  /** Public-key / signature sizes quoted in Table 2.1, for cross-checking. */
  readonly quoted?: { pk: number; sig: number };
}

export interface MayoSizes {
  skSeedBytes: number;
  rBytes: number;
  oBytes: number;
  vBytes: number;
  mBytes: number;
  p1Bytes: number;
  p2Bytes: number;
  p3Bytes: number;
  lBytes: number;
  cskBytes: number;
  eskBytes: number;
  cpkBytes: number;
  epkBytes: number;
  sigBytes: number;
}

function poly(m: number, terms: PolyTerms): Uint8Array {
  const f = new Uint8Array(m + 1);
  f[m] = 1;
  for (const [deg, coeff] of Object.entries(terms)) f[Number(deg)] ^= coeff;
  return f;
}

// The four irreducible polynomials from spec §2.1.7.1. x = 2, x² = 4, x³ = 8.
//   f64(z)  = z⁶⁴  + x³z³ + xz² + x³
//   f78(z)  = z⁷⁸  + z² + z + x³
//   f108(z) = z¹⁰⁸ + (x²+x+1)z³ + z² + x³
//   f142(z) = z¹⁴² + z³ + x³z² + x²
const f64 = poly(64, { 3: 8, 2: 2, 0: 8 });
const f78 = poly(78, { 2: 1, 1: 1, 0: 8 });
const f108 = poly(108, { 3: 7, 2: 1, 0: 8 });
const f142 = poly(142, { 3: 1, 2: 8, 0: 4 });

// Not from the spec: a degree-6 irreducible polynomial for the toy set, found by
// exhaustive search and re-verified by test (irreducible, and f ∤ det Z).
//   f6(z) = z⁶ + (x³+1)z² + z + 1
const f6 = poly(6, { 2: 9, 1: 1, 0: 1 });

export const MAYO1: MayoParams = {
  name: 'MAYO1',
  n: 86,
  m: 78,
  o: 8,
  k: 10,
  q: 16,
  saltBytes: 24,
  digestBytes: 32,
  pkSeedBytes: 16,
  f: f78,
  fName: 'f78(z)',
  securityLevel: 1,
  quoted: { pk: 1420, sig: 454 },
};

export const MAYO2: MayoParams = {
  name: 'MAYO2',
  n: 81,
  m: 64,
  o: 17,
  k: 4,
  q: 16,
  saltBytes: 24,
  digestBytes: 32,
  pkSeedBytes: 16,
  f: f64,
  fName: 'f64(z)',
  securityLevel: 1,
  quoted: { pk: 4912, sig: 186 },
};

export const MAYO3: MayoParams = {
  name: 'MAYO3',
  n: 118,
  m: 108,
  o: 10,
  k: 11,
  q: 16,
  saltBytes: 32,
  digestBytes: 48,
  pkSeedBytes: 16,
  f: f108,
  fName: 'f108(z)',
  securityLevel: 3,
  quoted: { pk: 2986, sig: 681 },
};

export const MAYO5: MayoParams = {
  name: 'MAYO5',
  n: 154,
  m: 142,
  o: 12,
  k: 12,
  q: 16,
  saltBytes: 40,
  digestBytes: 64,
  pkSeedBytes: 16,
  f: f142,
  fName: 'f142(z)',
  securityLevel: 5,
  quoted: { pk: 5554, sig: 964 },
};

/**
 * TOY — NOT SECURE, not a MAYO parameter set. Chosen so that every constraint
 * the spec places on (n, m, o, k) still holds:
 *   k(k+1)/2 = 6 ≤ m,  ko = 9 > m = 6,  k = 3 < n − o = 6,  o = 3 ≤ n − m = 3.
 * With o = 3 < m = 6 the unwhipped oil space really is too small to invert, so
 * the demo can show the failure and then the fix.
 */
export const TOY: MayoParams = {
  name: 'TOY',
  n: 9,
  m: 6,
  o: 3,
  k: 3,
  q: 16,
  saltBytes: 8,
  digestBytes: 16,
  pkSeedBytes: 16,
  f: f6,
  fName: 'f6(z)',
  securityLevel: null,
};

export const PARAM_SETS = { TOY, MAYO1, MAYO2, MAYO3, MAYO5 } as const;
export type ParamSetName = keyof typeof PARAM_SETS;

/** All sizes derived from (n, m, o, k) exactly as listed in spec §2.1.1. */
export function sizes(p: MayoParams): MayoSizes {
  const v = p.n - p.o;
  const oBytes = Math.ceil((v * p.o) / 2);
  const p1Bytes = (p.m * ((v * (v + 1)) / 2)) / 2;
  const p2Bytes = (p.m * v * p.o) / 2;
  const p3Bytes = (p.m * ((p.o * (p.o + 1)) / 2)) / 2;
  const skSeedBytes = p.saltBytes;
  return {
    skSeedBytes,
    rBytes: p.saltBytes,
    oBytes,
    vBytes: Math.ceil(v / 2),
    mBytes: Math.ceil(p.m / 2),
    p1Bytes,
    p2Bytes,
    p3Bytes,
    lBytes: p2Bytes,
    cskBytes: skSeedBytes,
    eskBytes: skSeedBytes + oBytes + p1Bytes + p2Bytes,
    cpkBytes: p.pkSeedBytes + p3Bytes,
    epkBytes: p1Bytes + p2Bytes + p3Bytes,
    sigBytes: Math.ceil((p.n * p.k) / 2) + p.saltBytes,
  };
}
