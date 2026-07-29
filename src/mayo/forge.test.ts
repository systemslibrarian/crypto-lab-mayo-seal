import { describe, expect, it } from 'vitest';
import { MAYO2, sizes, TOY, type MayoParams } from './params';
import { compactKeyGen, expandPK, expandSK, sign, verify } from './mayo';
import {
  guessByChance,
  MALFORMED_CASES,
  runMalformedCase,
  signWithOilSpace,
  type RandomBytes,
} from './forge';

const enc = new TextEncoder();

/** A deterministic byte source, so these tests never flake. */
function seededRandom(seed: number): RandomBytes {
  let state = seed >>> 0;
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out[i] = (state >>> 24) & 0xff;
    }
    return out;
  };
}

function keysFor(p: MayoParams, seedByte: number) {
  const seed = Uint8Array.from({ length: sizes(p).skSeedBytes }, (_, i) => (seedByte + i * 5) & 0xff);
  const keys = compactKeyGen(p, seed);
  return { keys, pk: expandPK(p, keys.cpk), sk: expandSK(p, keys.csk) };
}

describe('forging by chance', () => {
  it('TOY: 400 random guesses never verify and never match all m coordinates', () => {
    const { pk } = keysFor(TOY, 3);
    const result = guessByChance(TOY, pk, enc.encode('forge me'), 400, seededRandom(12345));
    expect(result.forged).toBe(false);
    expect(result.bestMatch).toBeLessThan(TOY.m);
    expect(result.attempts).toBe(400);
    // 4 bits per coordinate: 16^m guesses expected for a full hit.
    expect(result.expectedWorkBits).toBe(4 * TOY.m);
  });

  it('TOY: the match distribution is consistent with 1-in-16 per coordinate', () => {
    const { pk } = keysFor(TOY, 4);
    const attempts = 2000;
    const result = guessByChance(TOY, pk, enc.encode('distribution'), attempts, seededRandom(999));
    const total = result.matchCounts.reduce((a, b) => a + b, 0);
    expect(total).toBe(attempts);
    const weighted = result.matchCounts.reduce((acc, count, matches) => acc + count * matches, 0);
    // Expected matches per guess = m/16 = 0.375 for the toy set.
    expect(weighted / attempts).toBeGreaterThan(0.15);
    expect(weighted / attempts).toBeLessThan(0.7);
    // Most guesses match nothing at all.
    expect(result.matchCounts[0] / attempts).toBeGreaterThan(0.5);
  });

  it('MAYO2: guessing gets nowhere against 64 coordinates', () => {
    const { pk } = keysFor(MAYO2, 5);
    const result = guessByChance(MAYO2, pk, enc.encode('real params'), 8, seededRandom(7));
    expect(result.forged).toBe(false);
    expect(result.bestMatch).toBeLessThan(MAYO2.m / 2);
    expect(result.expectedWorkBits).toBe(256);
  });
});

describe('signing with the wrong oil space', () => {
  it.each([TOY, MAYO2])('$name: a random oil space still solves, and still fails to verify', (p) => {
    for (let trial = 0; trial < 3; trial++) {
      const { keys, pk } = keysFor(p, 20 + trial);
      const attempt = signWithOilSpace(p, keys, pk, enc.encode(`wrong oil ${trial}`), 'random', seededRandom(500 + trial));
      // The signer really did produce a full-length signature from a solved system.
      expect(attempt.solvedLinearSystem).toBe(true);
      expect(attempt.sig.length).toBe(sizes(p).sigBytes);
      expect(attempt.changedEntries).toBeGreaterThan(0);
      // And the verifier rejects it, because P vanishes only on the real O.
      expect(attempt.result.ok).toBe(false);
      expect(attempt.result.firstMismatch).toBeGreaterThanOrEqual(0);
    }
  });

  it('TOY: changing a single nibble of the oil space is already fatal', () => {
    for (let trial = 0; trial < 5; trial++) {
      const { keys, pk } = keysFor(TOY, 40 + trial);
      const attempt = signWithOilSpace(
        TOY,
        keys,
        pk,
        enc.encode(`one nibble ${trial}`),
        'one-nibble',
        seededRandom(900 + trial),
      );
      expect(attempt.changedEntries).toBe(1);
      expect(attempt.result.ok).toBe(false);
    }
  });

  it.each([TOY, MAYO2])('$name: the same code path with the real oil space verifies', (p) => {
    const { keys, pk } = keysFor(p, 61);
    const attempt = signWithOilSpace(p, keys, pk, enc.encode('control'), 'real');
    expect(attempt.changedEntries).toBe(0);
    expect(attempt.result.ok).toBe(true);
    // And it matches what the ordinary expanded secret key produces.
    const sk = expandSK(p, keys.csk);
    const ordinary = sign(p, sk.esk, enc.encode('control')).sig;
    expect(Array.from(attempt.sig)).toEqual(Array.from(ordinary));
  });
});

describe('malformed input is refused fail-closed', () => {
  it('TOY: every malformed case is rejected, and length errors never reach the math', () => {
    const { keys, pk } = keysFor(TOY, 71);
    const sk = expandSK(TOY, keys.csk);
    const message = enc.encode('fail closed');
    const good = sign(TOY, sk.esk, message).sig;
    const otherMessage = sign(TOY, sk.esk, enc.encode('a different message')).sig;

    // A genuine signature under a different parameter set, for the portability case.
    const other = keysFor(MAYO2, 72);
    const otherParams = sign(MAYO2, other.sk.esk, message).sig;

    const ctx = { p: TOY, sig: good, otherParams, otherMessage };
    const outcomes = MALFORMED_CASES.map((testCase) => runMalformedCase(ctx, pk, message, testCase));
    expect(outcomes).toHaveLength(4);
    for (const outcome of outcomes) {
      expect(outcome.outcome, outcome.label).not.toBe('accepted');
    }
    expect(outcomes.find((o) => o.id === 'truncated')!.outcome).toBe('refused');
    expect(outcomes.find((o) => o.id === 'foreign-params')!.outcome).toBe('refused');
    expect(outcomes.find((o) => o.id === 'zero')!.outcome).toBe('invalid');
    expect(outcomes.find((o) => o.id === 'foreign-salt')!.outcome).toBe('invalid');

    // The good signature still verifies — the mutations did not touch it.
    expect(verify(TOY, pk, message, good).ok).toBe(true);
  });
});
