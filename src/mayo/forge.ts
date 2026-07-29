/**
 * Three honest ways to fail to forge a MAYO signature.
 *
 * Nothing here is a break, and nothing here is simulated: every attempt runs the
 * real MAYO.Sign / MAYO.Verify. The point is to let a learner *cause* the
 * failure and see exactly what the verifier says.
 *
 *   1. guessByChance      — pick s and the salt at random; count how close you get.
 *   2. signWithOilSpace   — hand the real signer a *wrong* oil space. The linear
 *                           algebra still succeeds; the signature still fails.
 *   3. the control        — the same code path with the real oil space verifies.
 *
 * [extension] point: new attacks belong here as further exported attempts that
 * return the same shape, so the UI can list them without special-casing.
 */
import { mat, matMul, transpose, type Mat } from './gf16';
import { concatBytes, encodeMatrices, encodeO } from './encode';
import { decodeVec } from './encode';
import { sizes, type MayoParams } from './params';
import { shake256 } from './prf';
import {
  assemblePublicMatrices,
  evalWhipped,
  sign,
  verify,
  type CompactKeys,
  type ExpandedPublicKey,
  type VerifyResult,
} from './mayo';

/** Deterministic-in-tests source of random bytes. */
export type RandomBytes = (n: number) => Uint8Array;

const browserRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export interface GuessResult {
  attempts: number;
  /** Best number of the m coordinates that a guess got right. */
  bestMatch: number;
  /** Which attempt achieved it. */
  bestAttempt: number;
  /** The best guess's P*(s) and the t it was aiming at, for display. */
  bestY: Uint8Array;
  bestT: Uint8Array;
  /** matchCounts[i] = how many guesses matched exactly i coordinates. */
  matchCounts: number[];
  /** True only if a guess actually verified — expected never to happen. */
  forged: boolean;
  /** log2 of the expected number of guesses needed: 4·m. */
  expectedWorkBits: number;
  elapsedMs: number;
}

/**
 * Forge by chance: choose s ∈ F16^{kn} and the salt at random, then check
 * whether P*(s) hits the t those choices imply. Each coordinate matches with
 * probability 1/16, so a full hit costs 16^m ≈ 2^(4m) guesses.
 */
export function guessByChance(
  p: MayoParams,
  pk: Pick<ExpandedPublicKey, 'p1' | 'p2' | 'p3'>,
  message: Uint8Array,
  attempts: number,
  random: RandomBytes = browserRandom,
): GuessResult {
  const sz = sizes(p);
  const pMats = assemblePublicMatrices(p, pk);
  const digest = shake256(message, p.digestBytes);
  const started = performance.now();

  const matchCounts = new Array<number>(p.m + 1).fill(0);
  let bestMatch = -1;
  let bestAttempt = 0;
  // Annotated because the assignments below come from helpers whose buffer type
  // is the wider ArrayBufferLike.
  let bestY: Uint8Array<ArrayBufferLike> = new Uint8Array(p.m);
  let bestT: Uint8Array<ArrayBufferLike> = new Uint8Array(p.m);
  let forged = false;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const salt = random(p.saltBytes);
    const s = random(p.k * p.n).map((v) => v & 0xf);
    const t = decodeVec(p.m, shake256(concatBytes(digest, salt), sz.mBytes));
    const y = evalWhipped(p, pMats, s);

    let matches = 0;
    for (let i = 0; i < p.m; i++) if (y[i] === t[i]) matches++;
    matchCounts[matches]++;
    if (matches > bestMatch) {
      bestMatch = matches;
      bestAttempt = attempt;
      bestY = y;
      bestT = t;
    }
    if (matches === p.m) forged = true;
  }

  return {
    attempts,
    bestMatch,
    bestAttempt,
    bestY,
    bestT,
    matchCounts,
    forged,
    expectedWorkBits: 4 * p.m,
    elapsedMs: performance.now() - started,
  };
}

/** How the oil space handed to the signer differs from the real one. */
export type OilSpaceMode = 'real' | 'random' | 'one-nibble';

export interface OilSpaceAttempt {
  mode: OilSpaceMode;
  /** The oil basis actually used by the signer. */
  oil: Mat;
  /** How many entries of O differ from the real one. */
  changedEntries: number;
  /** The signature the real MAYO.Sign produced from it. */
  sig: Uint8Array;
  /** Whether Sign found a solvable system at all (it essentially always does). */
  solvedLinearSystem: boolean;
  /** What the real verifier makes of the result. */
  result: VerifyResult;
}

/**
 * Rebuild the expanded secret key around an arbitrary oil basis and sign with
 * it. This is the real signer: the same L = (P⁽¹⁾ + P⁽¹⁾ᵀ)O + P⁽²⁾, the same
 * whipped system, the same Gaussian elimination. Only O is wrong — and O is the
 * entire trapdoor, so the algebra succeeds while the signature does not.
 */
export function signWithOilSpace(
  p: MayoParams,
  keys: CompactKeys,
  pk: Pick<ExpandedPublicKey, 'p1' | 'p2' | 'p3'>,
  message: Uint8Array,
  mode: OilSpaceMode,
  random: RandomBytes = browserRandom,
): OilSpaceAttempt {
  const v = p.n - p.o;
  const oil = oilSpaceFor(keys.o, mode, random);

  let changedEntries = 0;
  for (let i = 0; i < oil.d.length; i++) if (oil.d[i] !== keys.o.d[i]) changedEntries++;

  // Lᵢ = (P⁽¹⁾ᵢ + P⁽¹⁾ᵢᵀ)·O + P⁽²⁾ᵢ, exactly as ExpandSK computes it.
  const l: Mat[] = [];
  for (let i = 0; i < p.m; i++) {
    const sum = mat(v, v, keys.p1[i].d.slice());
    const t = transpose(keys.p1[i]);
    for (let j = 0; j < sum.d.length; j++) sum.d[j] ^= t.d[j];
    const li = matMul(sum, oil);
    for (let j = 0; j < li.d.length; j++) li.d[j] ^= keys.p2[i].d[j];
    l.push(li);
  }

  const esk = concatBytes(
    keys.csk,
    encodeO(oil),
    encodeMatrices(v, v, keys.p1, true),
    encodeMatrices(v, p.o, l, false),
  );

  const { sig, trace } = sign(p, esk, message);
  return {
    mode,
    oil,
    changedEntries,
    sig,
    solvedLinearSystem: trace.x.length === p.k * p.o,
    result: verify(p, pk, message, sig),
  };
}

function oilSpaceFor(real: Mat, mode: OilSpaceMode, random: RandomBytes): Mat {
  if (mode === 'real') return { rows: real.rows, cols: real.cols, d: real.d.slice() };
  if (mode === 'random') {
    return mat(real.rows, real.cols, random(real.d.length).map((x) => x & 0xf));
  }
  // one-nibble: change a single entry of O to a different value.
  const d = real.d.slice();
  const idx = random(2)[0] % d.length;
  const delta = 1 + (random(1)[0] % 15);
  d[idx] = (d[idx] ^ delta) & 0xf;
  if (d[idx] === real.d[idx]) d[idx] ^= 1;
  return mat(real.rows, real.cols, d);
}

export interface MalformedContext {
  p: MayoParams;
  /** A genuine signature over the message being verified. */
  sig: Uint8Array;
  /** A genuine signature made under a different parameter set. */
  otherParams: Uint8Array;
  /** A genuine signature from the same key over a different message. */
  otherMessage: Uint8Array;
}

export interface MalformedCase {
  id: string;
  label: string;
  /** What the demo should teach about this input. */
  explains: string;
  /** Build the bad input from the genuine material. */
  mutate: (ctx: MalformedContext) => Uint8Array;
}

/**
 * The malformed inputs the verifier must refuse. Length errors are refused
 * before any field arithmetic runs — MAYO.Verify throws rather than guessing at
 * a shape — which is the fail-closed behaviour the UI reports.
 */
export const MALFORMED_CASES: MalformedCase[] = [
  {
    id: 'truncated',
    label: 'Truncated signature',
    explains: 'One byte short. Parsing stops before any math: a length that cannot hold ⌈k·n/2⌉ nibbles plus the salt is refused outright.',
    mutate: ({ sig }) => sig.slice(0, sig.length - 1),
  },
  {
    id: 'foreign-params',
    label: 'Signature from another parameter set',
    explains: 'A valid signature, but made under different (n, m, o, k). Sizes differ, so it is refused on length — MAYO signatures are not portable between parameter sets.',
    mutate: ({ otherParams }) => otherParams.slice(),
  },
  {
    id: 'zero',
    label: 'All-zero signature',
    explains: 'Correct length, so the math runs: P*(0) = 0, which will not equal a hashed target. No special-casing, no shortcut.',
    mutate: ({ sig }) => new Uint8Array(sig.length),
  },
  {
    id: 'foreign-salt',
    label: 'Salt lifted from another signature by the same key',
    explains: 'The whole s block is genuine and so is the salt — they just come from two different signatures. Because t is derived from the salt, swapping it moves the target and s no longer hits it.',
    mutate: ({ p, sig, otherMessage }) => {
      const out = sig.slice();
      // The salt is exactly the last salt_bytes of a signature.
      out.set(otherMessage.subarray(otherMessage.length - p.saltBytes), out.length - p.saltBytes);
      return out;
    },
  },
];

export interface MalformedOutcome {
  id: string;
  label: string;
  explains: string;
  /** 'refused' when Verify threw on the shape, 'invalid' when the math rejected. */
  outcome: 'refused' | 'invalid' | 'accepted';
  detail: string;
}

/** Runs one malformed case against the real verifier and classifies the refusal. */
export function runMalformedCase(
  ctx: MalformedContext,
  pk: Pick<ExpandedPublicKey, 'p1' | 'p2' | 'p3'>,
  message: Uint8Array,
  testCase: MalformedCase,
): MalformedOutcome {
  const bad = testCase.mutate(ctx);
  const base = { id: testCase.id, label: testCase.label, explains: testCase.explains };
  try {
    const result = verify(ctx.p, pk, message, bad);
    if (result.ok) {
      return { ...base, outcome: 'accepted', detail: 'Accepted — that would be a bug worth reporting.' };
    }
    return {
      ...base,
      outcome: 'invalid',
      detail: `Rejected by the math: P*(s) ≠ t, first difference at coordinate ${result.firstMismatch}.`,
    };
  } catch (error) {
    return { ...base, outcome: 'refused', detail: `Refused while parsing: ${(error as Error).message}` };
  }
}
