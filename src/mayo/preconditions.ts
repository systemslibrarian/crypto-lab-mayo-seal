/**
 * The structural facts MAYO needs to be true before any of it works, checked
 * rather than assumed.
 *
 * The test suite asserts all of these in CI. This module exists so the page can
 * re-run them in the reader's own browser: a demo that says "f is irreducible"
 * is asking to be trusted, and a demo that computes it is not.
 */
import { mat, matVecMul, mul, rank, type Mat } from './gf16';
import { sizes, type MayoParams } from './params';
import { detZNonzeroModF, emulsifierMatrix, isIrreducible, whipPairs } from './whip';
import { assemblePublicMatrices, compactKeyGen, evalP, evalWhipped, expandPK } from './mayo';

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/** Local copy so this module stays free of UI imports. */
function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPTS[Number(d)] ?? d)
    .join('');
}

export interface Precondition {
  id: string;
  /** What is being checked. */
  claim: string;
  /** Why MAYO falls apart without it. */
  matters: string;
  /** What the check actually computed. */
  evidence: string;
  holds: boolean;
  ms: number;
}

function timed(fn: () => { holds: boolean; evidence: string }): { holds: boolean; evidence: string; ms: number } {
  const started = performance.now();
  const result = fn();
  return { ...result, ms: performance.now() - started };
}

/**
 * Runs every precondition for one parameter set. Needs a keypair for the two
 * trapdoor checks, so it derives one from the supplied seed.
 */
export function checkPreconditions(p: MayoParams, seed: Uint8Array): Precondition[] {
  const out: Precondition[] = [];

  out.push({
    id: 'irreducible',
    claim: `${p.fName} is irreducible over F16`,
    matters:
      'The E matrices are multiplication by powers of z in F16[z]/f(z). If f factored, that ring would have zero divisors and some combination of the E matrices would be singular — whipped copies could then cancel each other out.',
    ...timed(() => ({
      holds: isIrreducible(p.f),
      evidence: `z^(16${superscript(p.m)}) ≡ z (mod f), and gcd(z^(16ᵈ) − z, f) = 1 for every proper divisor d of ${p.m}.`,
    })),
  });

  out.push({
    id: 'detz',
    claim: `${p.fName} does not divide det Z(${p.k}×${p.k})`,
    matters:
      "The spec's second requirement on f. Equivalently the matrix of z^ℓ entries is invertible over F16[z]/f(z), which is what the whipping argument needs.",
    ...timed(() => ({
      holds: detZNonzeroModF(p.f, p.k),
      evidence: `Gaussian elimination on Z over F16[z]/f(z) reached a non-zero determinant for all ${p.k} pivots.`,
    })),
  });

  out.push({
    id: 'erank',
    claim: 'Non-trivial combinations of the E matrices have full rank m',
    matters:
      'The property the spec footnote demands. A rank-deficient combination would let the k whipped copies collapse into fewer than m independent equations.',
    ...timed(() => {
      const count = (p.k * (p.k + 1)) / 2;
      const combo = mat(p.m, p.m);
      let tested = 0;
      // Three pseudo-random non-trivial combinations, enough to be convincing in
      // a page; the exhaustive argument is the field-theoretic one above.
      for (let trial = 1; trial <= 3; trial++) {
        combo.d.fill(0);
        for (let l = 0; l < count; l++) {
          const c = (trial * 5 + l * 3) % 16;
          if (c === 0) continue;
          const e = emulsifierMatrix(p.f, l);
          for (let i = 0; i < combo.d.length; i++) combo.d[i] ^= mul(c, e.d[i]);
        }
        if (rank(combo) !== p.m) return { holds: false, evidence: `A combination came out with rank < ${p.m}.` };
        tested++;
      }
      return { holds: true, evidence: `${tested} random combinations of the ${count} E powers, each rank ${p.m}.` };
    }),
  });

  const keys = compactKeyGen(p, seed);
  const pk = expandPK(p, keys.cpk);
  const pMats = assemblePublicMatrices(p, pk);

  out.push({
    id: 'vanishes',
    claim: 'The public map vanishes on the oil space O',
    matters:
      'This is the trapdoor. Without it the signer has no shortcut and signing is as hard as forging.',
    ...timed(() => {
      const value = evalP(pMats, oilPoint(p, keys.o, 7));
      return {
        holds: value.every((v) => v === 0),
        evidence: `P evaluated at a point of O returned ${p.m} zeros.`,
      };
    }),
  });

  out.push({
    id: 'vanishes-whipped',
    claim: 'The whipped map vanishes on Oᵏ',
    matters:
      'Whipping has to preserve the trapdoor, or the extra unknowns would buy nothing. This is what makes the k·o-unknown system solvable.',
    ...timed(() => {
      const s = new Uint8Array(p.k * p.n);
      for (let i = 0; i < p.k; i++) s.set(oilPoint(p, keys.o, 11 + i), i * p.n);
      const value = evalWhipped(p, pMats, s);
      return {
        holds: value.every((v) => v === 0),
        evidence: `P* evaluated at a point of Oᵏ returned ${p.m} zeros.`,
      };
    }),
  });

  out.push({
    id: 'sizes',
    claim: 'The key and signature sizes match spec Table 2.1',
    matters:
      'A size formula that disagrees with the table means the wire encoding is wrong somewhere, even if signing and verification agree with each other.',
    ...timed(() => {
      const sz = sizes(p);
      if (!p.quoted) {
        return { holds: true, evidence: 'Toy set: not in the table, so nothing to compare.' };
      }
      const holds = sz.cpkBytes === p.quoted.pk && sz.sigBytes === p.quoted.sig;
      return {
        holds,
        evidence: `public key ${sz.cpkBytes} B versus ${p.quoted.pk} B quoted; signature ${sz.sigBytes} B versus ${p.quoted.sig} B quoted.`,
      };
    }),
  });

  out.push({
    id: 'pairs',
    claim: `The ℓ numbering covers each of the ${(p.k * (p.k + 1)) / 2} pairs exactly once`,
    matters:
      'Sign and Verify walk the pairs in the same order and must agree on which power of z belongs to which pair, or a signature will never verify.',
    ...timed(() => {
      const pairs = whipPairs(p.k);
      const keysSeen = new Set(pairs.map(({ i, j }) => `${i}:${j}`));
      const sequential = pairs.every((entry, idx) => entry.l === idx);
      return {
        holds: keysSeen.size === pairs.length && sequential && pairs.length === (p.k * (p.k + 1)) / 2,
        evidence: `${pairs.length} pairs, ℓ running 0…${pairs.length - 1} with no repeats.`,
      };
    }),
  });

  return out;
}

function oilPoint(p: MayoParams, o: Mat, salt: number): Uint8Array {
  const x = Uint8Array.from({ length: p.o }, (_, i) => (salt * 5 + i * 3 + 1) % 16);
  const point = new Uint8Array(p.n);
  point.set(matVecMul(o, x), 0);
  point.set(x, p.n - p.o);
  return point;
}
