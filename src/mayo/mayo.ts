/**
 * MAYO — keygen, sign, verify (spec §2.1.5, Algorithms 4–8), unmodified.
 *
 * Nothing here is simulated: the same code path runs the toy parameters and the
 * real MAYO1/MAYO2 sets, and it reproduces the reference KAT byte for byte.
 * Where the spec offers an optimisation ("accumulate in one polynomial", "reuse
 * vᵢᵀP(1)"), we take the readable option and only cache what is free, because
 * this code is meant to be read next to the algorithm listings.
 */
import {
  mat,
  matMul,
  matVecMul,
  transpose,
  upper,
  vecMatMul,
  MUL_TABLE,
  type Mat,
} from './gf16';
import { concatBytes, decodeMatrices, decodeO, decodeVec, encodeMatrices, encodeO, encodeVec } from './encode';
import { sizes, type MayoParams } from './params';
import { aes128ctr, shake256 } from './prf';
import { sampleSolution, solveGeneral, type GeneralSolveResult } from './linalg';
import { addMulZPowInto, mulZPow, whipPairs } from './whip';

/* ---------- key material ---------- */

export interface CompactKeys {
  csk: Uint8Array;
  cpk: Uint8Array;
  /** The secret oil basis O ∈ F16^{(n−o)×o}. */
  o: Mat;
  seedPk: Uint8Array;
  p1: Mat[];
  p2: Mat[];
  p3: Mat[];
}

export interface ExpandedSecretKey {
  esk: Uint8Array;
  seedSk: Uint8Array;
  o: Mat;
  p1: Mat[];
  /** Lᵢ = (P⁽¹⁾ᵢ + P⁽¹⁾ᵢᵀ)·O + P⁽²⁾ᵢ — the differential of P along the oil space. */
  l: Mat[];
}

export interface ExpandedPublicKey {
  epk: Uint8Array;
  p1: Mat[];
  p2: Mat[];
  p3: Mat[];
}

/** MAYO.CompactKeyGen (Algorithm 4), with seedsk supplied by the caller. */
export function compactKeyGen(p: MayoParams, seedSk: Uint8Array): CompactKeys {
  const sz = sizes(p);
  if (seedSk.length !== sz.skSeedBytes) {
    throw new Error(`seedsk must be ${sz.skSeedBytes} bytes for ${p.name}`);
  }
  const v = p.n - p.o;

  const s = shake256(seedSk, p.pkSeedBytes + sz.oBytes);
  const seedPk = s.slice(0, p.pkSeedBytes);
  const o = decodeO(v, p.o, s.subarray(p.pkSeedBytes, p.pkSeedBytes + sz.oBytes));

  const pBytes = aes128ctr(seedPk, sz.p1Bytes + sz.p2Bytes);
  const p1 = decodeMatrices(v, v, p.m, pBytes.subarray(0, sz.p1Bytes), true);
  const p2 = decodeMatrices(v, p.o, p.m, pBytes.subarray(sz.p1Bytes), false);

  // P⁽³⁾ᵢ = Upper(−OᵀP⁽¹⁾ᵢO − OᵀP⁽²⁾ᵢ). In characteristic 2, −x = x.
  const ot = transpose(o);
  const p3: Mat[] = [];
  for (let i = 0; i < p.m; i++) {
    const term = matMul(matMul(ot, p1[i]), o);
    const term2 = matMul(ot, p2[i]);
    for (let j = 0; j < term.d.length; j++) term.d[j] ^= term2.d[j];
    p3.push(upper(term));
  }

  const cpk = concatBytes(seedPk, encodeMatrices(p.o, p.o, p3, true));
  return { csk: seedSk.slice(), cpk, o, seedPk, p1, p2, p3 };
}

/** MAYO.ExpandSK (Algorithm 5). */
export function expandSK(p: MayoParams, csk: Uint8Array): ExpandedSecretKey {
  const sz = sizes(p);
  const v = p.n - p.o;
  const seedSk = csk.subarray(0, sz.skSeedBytes);

  const s = shake256(seedSk, p.pkSeedBytes + sz.oBytes);
  const seedPk = s.subarray(0, p.pkSeedBytes);
  const oBytestring = s.subarray(p.pkSeedBytes, p.pkSeedBytes + sz.oBytes);
  const o = decodeO(v, p.o, oBytestring);

  const pBytes = aes128ctr(seedPk, sz.p1Bytes + sz.p2Bytes);
  const p1Bytestring = pBytes.subarray(0, sz.p1Bytes);
  const p1 = decodeMatrices(v, v, p.m, p1Bytestring, true);
  const p2 = decodeMatrices(v, p.o, p.m, pBytes.subarray(sz.p1Bytes), false);

  const l: Mat[] = [];
  for (let i = 0; i < p.m; i++) {
    const sum = mat(v, v, p1[i].d.slice());
    const t = transpose(p1[i]);
    for (let j = 0; j < sum.d.length; j++) sum.d[j] ^= t.d[j];
    const li = matMul(sum, o);
    for (let j = 0; j < li.d.length; j++) li.d[j] ^= p2[i].d[j];
    l.push(li);
  }

  const esk = concatBytes(seedSk, oBytestring, p1Bytestring, encodeMatrices(v, p.o, l, false));
  return { esk, seedSk: seedSk.slice(), o, p1, l };
}

/** MAYO.ExpandPK (Algorithm 6). */
export function expandPK(p: MayoParams, cpk: Uint8Array): ExpandedPublicKey {
  const sz = sizes(p);
  const v = p.n - p.o;
  const seedPk = cpk.subarray(0, p.pkSeedBytes);
  const p12 = aes128ctr(seedPk, sz.p1Bytes + sz.p2Bytes);
  const p3Bytes = cpk.subarray(p.pkSeedBytes, p.pkSeedBytes + sz.p3Bytes);
  const epk = concatBytes(p12, p3Bytes);
  return {
    epk,
    p1: decodeMatrices(v, v, p.m, p12.subarray(0, sz.p1Bytes), true),
    p2: decodeMatrices(v, p.o, p.m, p12.subarray(sz.p1Bytes), false),
    p3: decodeMatrices(p.o, p.o, p.m, p3Bytes, true),
  };
}

/** Parse an expanded public key straight from bytes (what Verify actually gets). */
export function parseExpandedPK(p: MayoParams, epk: Uint8Array): ExpandedPublicKey {
  const sz = sizes(p);
  const v = p.n - p.o;
  if (epk.length !== sz.epkBytes) throw new Error(`epk must be ${sz.epkBytes} bytes for ${p.name}`);
  return {
    epk,
    p1: decodeMatrices(v, v, p.m, epk.subarray(0, sz.p1Bytes), true),
    p2: decodeMatrices(v, p.o, p.m, epk.subarray(sz.p1Bytes, sz.p1Bytes + sz.p2Bytes), false),
    p3: decodeMatrices(p.o, p.o, p.m, epk.subarray(sz.p1Bytes + sz.p2Bytes), true),
  };
}

/* ---------- the public map ---------- */

/**
 * The n×n matrices of the public quadratic map:
 *   Pᵢ = [ P⁽¹⁾ᵢ  P⁽²⁾ᵢ ]
 *        [   0    P⁽³⁾ᵢ ]
 * The zero block is why the map is "oil and vinegar": no oil×oil term survives,
 * so P vanishes on the oil space O.
 */
export function assemblePublicMatrices(p: MayoParams, pk: Pick<ExpandedPublicKey, 'p1' | 'p2' | 'p3'>): Mat[] {
  const v = p.n - p.o;
  const out: Mat[] = [];
  for (let a = 0; a < p.m; a++) {
    const full = mat(p.n, p.n);
    for (let i = 0; i < v; i++) {
      full.d.set(pk.p1[a].d.subarray(i * v, (i + 1) * v), i * p.n);
      full.d.set(pk.p2[a].d.subarray(i * p.o, (i + 1) * p.o), i * p.n + v);
    }
    for (let i = 0; i < p.o; i++) {
      full.d.set(pk.p3[a].d.subarray(i * p.o, (i + 1) * p.o), (v + i) * p.n + v);
    }
    out.push(full);
  }
  return out;
}

/** Evaluates the unwhipped public map P(x) ∈ F16^m. */
export function evalP(pMats: Mat[], x: Uint8Array): Uint8Array {
  const out = new Uint8Array(pMats.length);
  for (let a = 0; a < pMats.length; a++) {
    const row = vecMatMul(x, pMats[a]);
    let acc = 0;
    for (let i = 0; i < x.length; i++) acc ^= MUL_TABLE[row[i] * 16 + x[i]];
    out[a] = acc;
  }
  return out;
}

/**
 * The whipped map P*(s₁,…,s_k) = Σ E^ℓ·P(sᵢ) + Σ E^ℓ·P′(sᵢ,sⱼ), evaluated the
 * way Verify does it. This is the function a signature must hit.
 */
export function evalWhipped(p: MayoParams, pMats: Mat[], s: Uint8Array): Uint8Array {
  const y = new Uint8Array(p.m);
  const sBlocks: Uint8Array[] = [];
  for (let i = 0; i < p.k; i++) sBlocks.push(s.subarray(i * p.n, (i + 1) * p.n));

  // sPi[i][a] = sᵢᵀ·Pₐ, reused across the pair loop (spec remark, §2.1.5).
  const sPi: Uint8Array[][] = [];
  for (let i = 0; i < p.k; i++) {
    const row: Uint8Array[] = [];
    for (let a = 0; a < p.m; a++) row.push(vecMatMul(sBlocks[i], pMats[a]));
    sPi.push(row);
  }

  const u = new Uint8Array(p.m);
  for (const { i, j, l } of whipPairs(p.k)) {
    for (let a = 0; a < p.m; a++) {
      let acc = 0;
      const si = sBlocks[i];
      const sj = sBlocks[j];
      const rowI = sPi[i][a];
      for (let c = 0; c < p.n; c++) acc ^= MUL_TABLE[rowI[c] * 16 + sj[c]];
      if (i !== j) {
        const rowJ = sPi[j][a];
        for (let c = 0; c < p.n; c++) acc ^= MUL_TABLE[rowJ[c] * 16 + si[c]];
      }
      u[a] = acc;
    }
    addMulZPowInto(p.f, y, u, l);
  }
  return y;
}

/* ---------- the signing system ---------- */

export interface WhippedSystem {
  /** The m × ko coefficient matrix A. */
  a: Mat;
  /** Right-hand side y = t − (vinegar-only part). */
  y: Uint8Array;
  /** Mᵢ ∈ F16^{m×o}, row j = vᵢᵀ·L_j. */
  mMats: Mat[];
}

function buildMMats(p: MayoParams, l: Mat[], vinegar: Uint8Array[]): Mat[] {
  const out: Mat[] = [];
  for (let i = 0; i < vinegar.length; i++) {
    const mi = mat(p.m, p.o);
    for (let j = 0; j < p.m; j++) {
      mi.d.set(vecMatMul(vinegar[i], l[j]), j * p.o);
    }
    out.push(mi);
  }
  return out;
}

/** vP1[i][a] = vᵢᵀ·P⁽¹⁾ₐ, the value both the pair terms and Verify reuse. */
function buildVP1(p: MayoParams, p1: Mat[], vinegar: Uint8Array[]): Uint8Array[][] {
  const out: Uint8Array[][] = [];
  for (let i = 0; i < vinegar.length; i++) {
    const row: Uint8Array[] = [];
    for (let a = 0; a < p.m; a++) row.push(vecMatMul(vinegar[i], p1[a]));
    out.push(row);
  }
  return out;
}

/**
 * Builds the linear system MAYO.Sign solves (Algorithm 7, lines 21–35): m
 * equations in ko unknowns, whose unknowns are the oil coordinates of all k
 * copies at once. This is the whole trick — one copy gives m equations in only
 * o unknowns, and k copies share the same m equations.
 */
export function buildWhippedSystem(
  p: MayoParams,
  sk: Pick<ExpandedSecretKey, 'p1' | 'l'>,
  t: Uint8Array,
  vinegar: Uint8Array[],
): WhippedSystem {
  const a = mat(p.m, p.k * p.o);
  const y = t.slice();
  const mMats = buildMMats(p, sk.l, vinegar);
  const vP1 = buildVP1(p, sk.p1, vinegar);
  const u = new Uint8Array(p.m);

  for (const { i, j, l } of whipPairs(p.k)) {
    for (let idx = 0; idx < p.m; idx++) {
      let acc = 0;
      const rowI = vP1[i][idx];
      const vj = vinegar[j];
      for (let c = 0; c < vj.length; c++) acc ^= MUL_TABLE[rowI[c] * 16 + vj[c]];
      if (i !== j) {
        const rowJ = vP1[j][idx];
        const vi = vinegar[i];
        for (let c = 0; c < vi.length; c++) acc ^= MUL_TABLE[rowJ[c] * 16 + vi[c]];
      }
      u[idx] = acc;
    }
    addMulZPowInto(p.f, y, u, l);
    addEllBlockInto(p, a, i * p.o, mMats[j], l);
    if (i !== j) addEllBlockInto(p, a, j * p.o, mMats[i], l);
  }
  return { a, y, mMats };
}

/** A[:, col … col+o) ^= E^ℓ·M, column by column. */
function addEllBlockInto(p: MayoParams, a: Mat, col: number, m: Mat, l: number): void {
  const column = new Uint8Array(p.m);
  for (let c = 0; c < p.o; c++) {
    for (let r = 0; r < p.m; r++) column[r] = m.d[r * p.o + c];
    const shifted = mulZPow(p.f, column, l);
    for (let r = 0; r < p.m; r++) a.d[r * a.cols + col + c] ^= shifted[r];
  }
}

/**
 * The system a signer would face *without* whipping: P(v + O·x) = t is m
 * equations in only o unknowns, because P vanishes on the oil space. Not part of
 * MAYO — it is the failure the whipping construction exists to repair.
 */
export function buildUnwhippedSystem(
  p: MayoParams,
  sk: Pick<ExpandedSecretKey, 'p1' | 'l'>,
  t: Uint8Array,
  vinegar: Uint8Array,
): { a: Mat; y: Uint8Array } {
  const mMats = buildMMats(p, sk.l, [vinegar]);
  const vP1 = buildVP1(p, sk.p1, [vinegar]);
  const y = t.slice();
  for (let idx = 0; idx < p.m; idx++) {
    let acc = 0;
    const rowI = vP1[0][idx];
    for (let c = 0; c < vinegar.length; c++) acc ^= MUL_TABLE[rowI[c] * 16 + vinegar[c]];
    y[idx] ^= acc;
  }
  return { a: mMats[0], y };
}

/** Solves the unwhipped system honestly — usually reporting "no solution". */
export function tryUnwhipped(
  p: MayoParams,
  sk: Pick<ExpandedSecretKey, 'p1' | 'l'>,
  t: Uint8Array,
  vinegar: Uint8Array,
): GeneralSolveResult & { a: Mat; y: Uint8Array } {
  const { a, y } = buildUnwhippedSystem(p, sk, t, vinegar);
  return { ...solveGeneral(a, y), a, y };
}

/* ---------- sign ---------- */

export interface SignOptions {
  /**
   * The optional randomizer R (spec Algorithm 7 line 9). Defaults to all zeros,
   * which makes signing deterministic — that is what the reference KAT uses
   * after seeding R from its DRBG, and what makes this page reproducible.
   *
   * [extension] point: a hedged-randomness mode (R from a CSPRNG mixed with a
   * counter) belongs here, so the KAT path can keep passing R explicitly while
   * the UI opts into fresh randomness.
   */
  r?: Uint8Array;
}

export interface SignTrace {
  /** SHAKE256(M) — the message digest the salt and target both hang off. */
  digest: Uint8Array;
  salt: Uint8Array;
  /** The target t ∈ F16^m the whipped map must hit. */
  t: Uint8Array;
  /** Which ctr value succeeded, and what happened before it. */
  ctr: number;
  attempts: Array<{ ctr: number; rankDeficient: boolean }>;
  vinegar: Uint8Array[];
  /** The randomizer r ∈ F16^{ko} that picks which solution we take. */
  r: Uint8Array;
  system: WhippedSystem;
  /** (A | y) in echelon form — the actual Gaussian elimination that ran. */
  echelon: Mat;
  /** The oil coordinates x ∈ F16^{ko}. */
  x: Uint8Array;
  /** The full signature vector s ∈ F16^{kn}. */
  s: Uint8Array;
}

export interface SignResult {
  sig: Uint8Array;
  trace: SignTrace;
}

/** MAYO.Sign (Algorithm 7). */
export function sign(p: MayoParams, esk: Uint8Array, message: Uint8Array, opts: SignOptions = {}): SignResult {
  const sz = sizes(p);
  const v = p.n - p.o;
  if (esk.length !== sz.eskBytes) throw new Error(`esk must be ${sz.eskBytes} bytes for ${p.name}`);

  const seedSk = esk.subarray(0, sz.skSeedBytes);
  const o = decodeO(v, p.o, esk.subarray(sz.skSeedBytes, sz.skSeedBytes + sz.oBytes));
  const p1Off = sz.skSeedBytes + sz.oBytes;
  const p1 = decodeMatrices(v, v, p.m, esk.subarray(p1Off, p1Off + sz.p1Bytes), true);
  const l = decodeMatrices(v, p.o, p.m, esk.subarray(p1Off + sz.p1Bytes), false);

  const digest = shake256(message, p.digestBytes);
  const r = opts.r ?? new Uint8Array(sz.rBytes);
  if (r.length !== sz.rBytes) throw new Error(`R must be ${sz.rBytes} bytes for ${p.name}`);
  const salt = shake256(concatBytes(digest, r, seedSk), p.saltBytes);
  const t = decodeVec(p.m, shake256(concatBytes(digest, salt), sz.mBytes));

  const attempts: Array<{ ctr: number; rankDeficient: boolean }> = [];
  const oilBytes = Math.ceil((p.k * p.o) / 2);

  for (let ctr = 0; ctr < 256; ctr++) {
    const vBytesTotal = p.k * sz.vBytes;
    const vExpanded = shake256(
      concatBytes(digest, salt, seedSk, Uint8Array.of(ctr)),
      vBytesTotal + oilBytes,
    );
    const vinegar: Uint8Array[] = [];
    for (let i = 0; i < p.k; i++) {
      vinegar.push(decodeVec(v, vExpanded.subarray(i * sz.vBytes, (i + 1) * sz.vBytes)));
    }
    const rVec = decodeVec(p.k * p.o, vExpanded.subarray(vBytesTotal, vBytesTotal + oilBytes));

    const system = buildWhippedSystem(p, { p1, l }, t, vinegar);
    const solved = sampleSolution(system.a, system.y, rVec);
    attempts.push({ ctr, rankDeficient: solved.rankDeficient });
    if (!solved.x) continue;

    const x = solved.x;
    const s = new Uint8Array(p.k * p.n);
    for (let i = 0; i < p.k; i++) {
      const xi = x.subarray(i * p.o, (i + 1) * p.o);
      const ox = matVecMul(o, xi);
      const base = i * p.n;
      for (let c = 0; c < v; c++) s[base + c] = vinegar[i][c] ^ ox[c];
      for (let c = 0; c < p.o; c++) s[base + v + c] = xi[c];
    }
    const sig = concatBytes(encodeVec(s), salt);
    return {
      sig,
      trace: { digest, salt, t, ctr, attempts, vinegar, r: rVec, system, echelon: solved.echelon, x, s },
    };
  }
  throw new Error('MAYO.Sign: no solvable system after 256 attempts (should be astronomically unlikely)');
}

/* ---------- verify ---------- */

export interface VerifyResult {
  /** True exactly when P*(s) = t. */
  ok: boolean;
  /** P*(s), recomputed from the signature and the public key. */
  y: Uint8Array;
  /** t, recomputed from the message and the salt in the signature. */
  t: Uint8Array;
  s: Uint8Array;
  salt: Uint8Array;
  /** Index of the first coordinate where y and t disagree, or −1. */
  firstMismatch: number;
  /**
   * True when the signature is the right length but not a canonical encoding:
   * the trailing padding nibble carries something other than zero.
   *
   * A signature holds n·k field elements in ⌈n·k/2⌉ bytes, so when n·k is odd
   * the final high nibble is padding. EncodeVec writes zero there and DecodeVec
   * never reads it back, which means that without this check two *different*
   * byte strings decode to the same s and both verify — signature malleability,
   * for free, with no key involved. Only the toy set is affected: n·k is even
   * for MAYO1, MAYO2, MAYO3 and MAYO5, so none of them has a padding nibble at
   * all and the check cannot change their behaviour or their KAT conformance.
   */
  nonCanonical: boolean;
}

/** MAYO.Verify (Algorithm 8). Returns ok = true for spec result 0. */
export function verify(
  p: MayoParams,
  pk: Pick<ExpandedPublicKey, 'p1' | 'p2' | 'p3'>,
  message: Uint8Array,
  sig: Uint8Array,
): VerifyResult {
  const sz = sizes(p);
  if (sig.length !== sz.sigBytes) throw new Error(`signature must be ${sz.sigBytes} bytes for ${p.name}`);
  const sBytes = Math.ceil((p.n * p.k) / 2);
  const salt = sig.subarray(sBytes, sBytes + p.saltBytes);
  const s = decodeVec(p.k * p.n, sig);

  const digest = shake256(message, p.digestBytes);
  const t = decodeVec(p.m, shake256(concatBytes(digest, salt), sz.mBytes));

  const y = evalWhipped(p, assemblePublicMatrices(p, pk), s);

  let firstMismatch = -1;
  for (let i = 0; i < p.m; i++) {
    if (y[i] !== t[i]) {
      firstMismatch = i;
      break;
    }
  }
  // Reject a non-canonical encoding rather than ignoring the spare nibble.
  const nonCanonical = (p.n * p.k) % 2 === 1 && (sig[sBytes - 1] >> 4) !== 0;

  return {
    ok: firstMismatch === -1 && !nonCanonical,
    y,
    t,
    s,
    salt: salt.slice(),
    firstMismatch,
    nonCanonical,
  };
}

/** Convenience: keygen → expand → sign → verify, in one call. */
export function keypair(p: MayoParams, seedSk: Uint8Array): { keys: CompactKeys; sk: ExpandedSecretKey; pk: ExpandedPublicKey } {
  const keys = compactKeyGen(p, seedSk);
  return { keys, sk: expandSK(p, keys.csk), pk: expandPK(p, keys.cpk) };
}

export { encodeO };
