/**
 * The UOV ⇄ MAYO size ledger.
 *
 * MAYO's public key is one 16-byte seed plus the P⁽³⁾ block, and P⁽³⁾ is
 * m·o(o+1)/2 nibbles — quadratic in the oil dimension o. Everything else
 * (P⁽¹⁾, P⁽²⁾) is expanded publicly from the seed and never shipped.
 *
 * Classic Oil-and-Vinegar is the k = 1 corner of the same construction: with one
 * copy the signer must solve m equations in o unknowns, so o has to be at least
 * m. Put o = m into the very same size formula and the public key blows up. That
 * is the whole trade, and it is computed here rather than asserted.
 */
import { sizes, type MayoParams } from './params';

export interface SizeBreakdown {
  /** Bytes of public key actually shipped. */
  publicKey: number;
  /** Of that, the seed. */
  seed: number;
  /** Of that, the P⁽³⁾ block. */
  p3: number;
  /** Bytes the verifier expands from the seed instead of downloading. */
  expandedFromSeed: number;
  /** Signature size. */
  signature: number;
}

export function sizeBreakdown(p: MayoParams): SizeBreakdown {
  const sz = sizes(p);
  return {
    publicKey: sz.cpkBytes,
    seed: p.pkSeedBytes,
    p3: sz.p3Bytes,
    expandedFromSeed: sz.p1Bytes + sz.p2Bytes,
    signature: sz.sigBytes,
  };
}

export interface UovComparison {
  /** The MAYO set being compared. */
  mayo: { name: string; n: number; m: number; o: number; k: number; pk: number; sig: number };
  /**
   * The same map with the whipping switched off: k = 1 forces o = m, and n is
   * taken as m + o (the smallest n the spec's own n − o ≤ m criterion allows).
   */
  uov: { n: number; m: number; o: number; k: 1; pk: number; sig: number };
  /** How many times larger the unwhipped public key is. */
  pkRatio: number;
  /** How many times larger the MAYO signature is. */
  sigRatio: number;
}

/** Public-key size in bytes for a MAYO-shaped key: seed + m·o(o+1)/2 nibbles. */
export function publicKeyBytes(m: number, o: number, pkSeedBytes = 16): number {
  return pkSeedBytes + (m * ((o * (o + 1)) / 2)) / 2;
}

/** Signature size in bytes: ⌈n·k/2⌉ nibbles of s, plus the salt. */
export function signatureBytes(n: number, k: number, saltBytes: number): number {
  return Math.ceil((n * k) / 2) + saltBytes;
}

/**
 * The smallest whipping factor that leaves the signer room to spare: k·o > m.
 *
 * Every shipped MAYO parameter set uses exactly this k — the whipping is turned
 * up just far enough and not one copy further, since each extra copy costs n more
 * field elements of signature. The test suite asserts that for MAYO1, MAYO2,
 * MAYO3 and MAYO5.
 *
 * Note what this is *not*: k·o > m does not guarantee that any particular
 * signing attempt succeeds. It is the parameter-design condition that makes a
 * draw overwhelmingly likely to have full row rank — see whipBalance.
 */
export function smallestKWithRoom(m: number, o: number): number {
  return Math.floor(m / o) + 1;
}

/**
 * Probability that a uniformly random m×N matrix over GF(16) has rank m,
 * ∏_{i<m} (1 − 16^(i−N)). Returns 0 when N < m, where full row rank is
 * impossible.
 *
 * MAYO's signing matrix A is not literally uniform — it is built from the secret
 * key and the vinegar draw — but this random-matrix model is the one the spec's
 * own parameter choice reasons with, and it reproduces the restart probability
 * the round-2 submission quotes.
 */
export function fullRowRankProbability(m: number, n: number): number {
  if (n < m) return 0;
  let p = 1;
  for (let i = 0; i < m; i++) p *= 1 - 16 ** (i - n);
  return p;
}

/** −log₂ of the chance a draw comes out rank-deficient, so signing must retry. */
export function restartProbabilityBits(m: number, n: number): number {
  const fail = 1 - fullRowRankProbability(m, n);
  if (fail <= 0) return Number.POSITIVE_INFINITY;
  return -Math.log2(fail);
}

export type WhipStatus = 'short' | 'exact' | 'slack';

export interface WhipBalance {
  k: number;
  /** Oil unknowns available to the signer, k·o. */
  unknowns: number;
  /** Equations that must be satisfied, m. */
  equations: number;
  /** k·o − m: negative is short of the equations, positive is room to spare. */
  slack: number;
  /**
   * 'short'  — fewer unknowns than equations. A random target is usually out of
   *            reach, but not impossible: reachable with probability ≈ 16^slack.
   * 'exact'  — as many unknowns as equations. A full-rank draw has exactly one
   *            solution; MAYO does not sit here, it takes slack.
   * 'slack'  — room to spare. A full-row-rank draw has 16^slack solutions.
   */
  status: WhipStatus;
  /** For 'short': −log₂ of the chance a random target is hit at all. */
  unreachableBits: number | null;
  /** For 'exact'/'slack': −log₂ of the chance the draw is rank-deficient. */
  restartBits: number | null;
  /** Signature cost at this k, in bytes. */
  signatureBytes: number;
}

/**
 * The equations-versus-unknowns balance at a given whipping factor, with the
 * probabilities that make the claim honest rather than absolute.
 */
export function whipBalance(m: number, o: number, n: number, k: number, saltBytes: number): WhipBalance {
  const unknowns = k * o;
  const slack = unknowns - m;
  const status: WhipStatus = slack < 0 ? 'short' : slack === 0 ? 'exact' : 'slack';
  return {
    k,
    unknowns,
    equations: m,
    slack,
    status,
    // The image of a map into GF(16)^m from N < m unknowns covers at most a
    // 16^N slice of the 16^m targets.
    unreachableBits: status === 'short' ? 4 * (m - unknowns) : null,
    restartBits: status === 'short' ? null : restartProbabilityBits(m, unknowns),
    signatureBytes: signatureBytes(n, k, saltBytes),
  };
}

export function compareWithUov(p: MayoParams): UovComparison {
  const sz = sizes(p);
  const uovO = p.m; // one copy ⇒ the oil space must be big enough to invert
  const uovN = p.m + uovO;
  const uov = {
    n: uovN,
    m: p.m,
    o: uovO,
    k: 1 as const,
    pk: publicKeyBytes(p.m, uovO, p.pkSeedBytes),
    sig: signatureBytes(uovN, 1, p.saltBytes),
  };
  return {
    mayo: { name: p.name, n: p.n, m: p.m, o: p.o, k: p.k, pk: sz.cpkBytes, sig: sz.sigBytes },
    uov,
    pkRatio: uov.pk / sz.cpkBytes,
    sigRatio: sz.sigBytes / uov.sig,
  };
}

export interface TradeoffRow {
  n: number;
  m: number;
  o: number;
  k: number;
  /** Public key size printed in the spec table. */
  quotedPk: number;
  /** Signature size printed in the spec table. */
  quotedSig: number;
  /** Whether this row is one of the four implemented sets. */
  main: boolean;
}

/**
 * Spec Table 2.2, the NIST level-1 block: the same security level reached with
 * nine different (o, k) splits. Reading down the table, o grows, k shrinks, the
 * public key grows and the signature shrinks. The last row, k = 2, is nearly
 * classic UOV; the first, k = 10, is MAYO1.
 */
export const TRADEOFF_LEVEL1: TradeoffRow[] = [
  { n: 86, m: 78, o: 8, k: 10, quotedPk: 1420, quotedSig: 454, main: true },
  { n: 85, m: 76, o: 9, k: 9, quotedPk: 1726, quotedSig: 406, main: false },
  { n: 84, m: 74, o: 10, k: 8, quotedPk: 2051, quotedSig: 360, main: false },
  { n: 81, m: 70, o: 11, k: 7, quotedPk: 2326, quotedSig: 307, main: false },
  { n: 80, m: 68, o: 12, k: 6, quotedPk: 2668, quotedSig: 264, main: false },
  { n: 80, m: 66, o: 14, k: 5, quotedPk: 3481, quotedSig: 224, main: false },
  { n: 81, m: 64, o: 17, k: 4, quotedPk: 4912, quotedSig: 186, main: true },
  { n: 86, m: 64, o: 22, k: 3, quotedPk: 8112, quotedSig: 153, main: false },
  { n: 100, m: 64, o: 33, k: 2, quotedPk: 17968, quotedSig: 124, main: false },
];

export interface TradeoffComputed extends TradeoffRow {
  computedPk: number;
  computedSig: number;
  /** True when our formula and the printed table agree exactly. */
  pkMatches: boolean;
  sigMatches: boolean;
}

/**
 * Recomputes every row from the size formulas so the page can show both numbers
 * side by side. The two rows with odd n·k come out one byte above the printed
 * value: ⌈n·k/2⌉ nibbles cannot be stored in ⌊n·k/2⌋ bytes, so we report our
 * number and flag the difference instead of quietly matching the table.
 */
export function computeTradeoffs(saltBytes = 24, pkSeedBytes = 16): TradeoffComputed[] {
  return TRADEOFF_LEVEL1.map((row) => {
    const computedPk = publicKeyBytes(row.m, row.o, pkSeedBytes);
    const computedSig = signatureBytes(row.n, row.k, saltBytes);
    return {
      ...row,
      computedPk,
      computedSig,
      pkMatches: computedPk === row.quotedPk,
      sigMatches: computedSig === row.quotedSig,
    };
  });
}
