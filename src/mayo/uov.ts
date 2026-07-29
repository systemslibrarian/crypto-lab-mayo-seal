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
