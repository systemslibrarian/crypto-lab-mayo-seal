import { describe, expect, it } from 'vitest';
import { matMul, matVecMul, transpose, vecEqual, type Mat } from './gf16';
import { bytesToHex, concatBytes, hexToBytes } from './encode';
import { MAYO1, MAYO2, MAYO3, MAYO5, sizes, TOY, type MayoParams } from './params';
import {
  assemblePublicMatrices,
  buildUnwhippedSystem,
  compactKeyGen,
  evalP,
  evalWhipped,
  expandPK,
  expandSK,
  keypair,
  parseExpandedPK,
  sign,
  tryUnwhipped,
  verify,
} from './mayo';
import { NistCtrDrbg } from './nist-drbg';
import katVectors from './kat-vectors.json';

const enc = new TextEncoder();

function seedFor(p: MayoParams, byte: number): Uint8Array {
  return Uint8Array.from({ length: sizes(p).skSeedBytes }, (_, i) => (byte + i * 3) & 0xff);
}

describe('key generation', () => {
  it.each([TOY, MAYO2])('$name: sizes match the spec formulas', (p) => {
    const sz = sizes(p);
    const keys = compactKeyGen(p, seedFor(p, 1));
    expect(keys.cpk.length).toBe(sz.cpkBytes);
    expect(keys.csk.length).toBe(sz.cskBytes);
    const sk = expandSK(p, keys.csk);
    expect(sk.esk.length).toBe(sz.eskBytes);
    const pk = expandPK(p, keys.cpk);
    expect(pk.epk.length).toBe(sz.epkBytes);
  });

  it.each([TOY, MAYO2])('$name: the public map vanishes on the oil space', (p) => {
    // This is the trapdoor. P⁽³⁾ is chosen exactly so that P(O·x) = 0.
    const { keys, pk } = keypair(p, seedFor(p, 7));
    const pMats = assemblePublicMatrices(p, pk);
    for (let trial = 0; trial < 5; trial++) {
      const x = Uint8Array.from({ length: p.o }, (_, i) => (trial * 5 + i * 3 + 1) % 16);
      const oilPoint = new Uint8Array(p.n);
      oilPoint.set(matVecMul(keys.o, x), 0);
      oilPoint.set(x, p.n - p.o);
      expect(Array.from(evalP(pMats, oilPoint))).toEqual(new Array(p.m).fill(0));
    }
  });

  it.each([TOY, MAYO2])('$name: the whipped map vanishes on O^k', (p) => {
    // P*(o₁,…,o_k) = 0 whenever every oᵢ lies in O — the reason a solution exists.
    const { keys, pk } = keypair(p, seedFor(p, 11));
    const pMats = assemblePublicMatrices(p, pk);
    const s = new Uint8Array(p.k * p.n);
    for (let i = 0; i < p.k; i++) {
      const x = Uint8Array.from({ length: p.o }, (_, c) => (i * 7 + c * 5 + 2) % 16);
      const base = i * p.n;
      s.set(matVecMul(keys.o, x), base);
      s.set(x, base + p.n - p.o);
    }
    expect(Array.from(evalWhipped(p, pMats, s))).toEqual(new Array(p.m).fill(0));
  });

  it('TOY: expandSK derives L from the same P the public key uses', () => {
    const p = TOY;
    const { keys, sk } = keypair(p, seedFor(p, 3));
    // Lᵢ = (P⁽¹⁾ᵢ + P⁽¹⁾ᵢᵀ)O + P⁽²⁾ᵢ
    for (let i = 0; i < p.m; i++) {
      const sum: Mat = { rows: keys.p1[i].rows, cols: keys.p1[i].cols, d: keys.p1[i].d.slice() };
      const t = transpose(keys.p1[i]);
      for (let j = 0; j < sum.d.length; j++) sum.d[j] ^= t.d[j];
      const expected = matMul(sum, keys.o);
      for (let j = 0; j < expected.d.length; j++) expected.d[j] ^= keys.p2[i].d[j];
      expect(Array.from(sk.l[i].d)).toEqual(Array.from(expected.d));
    }
  });

  it('derives the same public key from a seed every time', () => {
    const a = compactKeyGen(TOY, seedFor(TOY, 5));
    const b = compactKeyGen(TOY, seedFor(TOY, 5));
    expect(bytesToHex(a.cpk)).toBe(bytesToHex(b.cpk));
    const c = compactKeyGen(TOY, seedFor(TOY, 6));
    expect(bytesToHex(c.cpk)).not.toBe(bytesToHex(a.cpk));
  });

  it('rejects a wrong-length seed', () => {
    expect(() => compactKeyGen(TOY, new Uint8Array(3))).toThrow(/seedsk must be/);
  });
});

describe('the too-small oil space (why whipping exists)', () => {
  it('TOY: one unwhipped copy gives m equations in only o unknowns', () => {
    const p = TOY;
    const { sk } = keypair(p, seedFor(p, 21));
    const t = Uint8Array.from({ length: p.m }, (_, i) => (i * 5 + 1) % 16);
    const vinegar = Uint8Array.from({ length: p.n - p.o }, (_, i) => (i * 3 + 7) % 16);
    const { a } = buildUnwhippedSystem(p, sk, t, vinegar);
    expect(a.rows).toBe(p.m);
    expect(a.cols).toBe(p.o);
    expect(a.cols).toBeLessThan(a.rows);
  });

  it('TOY: the unwhipped system is unsolvable for almost every target', () => {
    const p = TOY;
    const { sk } = keypair(p, seedFor(p, 23));
    let solvable = 0;
    for (let trial = 0; trial < 40; trial++) {
      const t = Uint8Array.from({ length: p.m }, (_, i) => (trial * 11 + i * 7 + 3) % 16);
      const vinegar = Uint8Array.from({ length: p.n - p.o }, (_, i) => (trial * 5 + i * 3) % 16);
      const res = tryUnwhipped(p, sk, t, vinegar);
      if (res.x) solvable++;
      else expect(res.contradictionRow).not.toBeNull();
    }
    // m − o = 3 free equations: a solution should turn up with probability ~16⁻³.
    expect(solvable).toBe(0);
  });

  it('TOY: whipping k copies makes the same target reachable', () => {
    const p = TOY;
    const { sk, pk } = keypair(p, seedFor(p, 23));
    const { sig, trace } = sign(p, sk.esk, enc.encode('reachable'));
    expect(trace.system.a.rows).toBe(p.m);
    expect(trace.system.a.cols).toBe(p.k * p.o);
    expect(trace.system.a.cols).toBeGreaterThan(trace.system.a.rows);
    expect(verify(p, pk, enc.encode('reachable'), sig).ok).toBe(true);
  });
});

describe('sign and verify', () => {
  it.each([TOY, MAYO2, MAYO1])('$name: a fresh signature verifies', (p) => {
    const { sk, pk } = keypair(p, seedFor(p, 42));
    const msg = enc.encode(`hello ${p.name}`);
    const { sig } = sign(p, sk.esk, msg);
    expect(sig.length).toBe(sizes(p).sigBytes);
    const res = verify(p, pk, msg, sig);
    expect(res.ok).toBe(true);
    expect(res.firstMismatch).toBe(-1);
    expect(vecEqual(res.y, res.t)).toBe(true);
  });

  it.each([TOY, MAYO2])('$name: signing lands exactly on the target', (p) => {
    const { sk, pk } = keypair(p, seedFor(p, 43));
    const { trace } = sign(p, sk.esk, enc.encode('on target'));
    const y = evalWhipped(p, assemblePublicMatrices(p, pk), trace.s);
    expect(Array.from(y)).toEqual(Array.from(trace.t));
  });

  it.each([TOY, MAYO2])('$name: rejects a modified message', (p) => {
    const { sk, pk } = keypair(p, seedFor(p, 44));
    const { sig } = sign(p, sk.esk, enc.encode('pay alice 10'));
    expect(verify(p, pk, enc.encode('pay alice 20'), sig).ok).toBe(false);
  });

  it.each([TOY, MAYO2])('$name: rejects any single-nibble edit of the signature', (p) => {
    const { sk, pk } = keypair(p, seedFor(p, 45));
    const msg = enc.encode('tamper me');
    const { sig } = sign(p, sk.esk, msg);
    for (const idx of [0, 1, 7, sig.length - p.saltBytes - 1, sig.length - 1]) {
      const bad = sig.slice();
      bad[idx] ^= 0x01;
      expect(verify(p, pk, msg, bad).ok, `byte ${idx}`).toBe(false);
    }
  });

  it.each([TOY, MAYO2])('$name: rejects a signature made under a different key', (p) => {
    const alice = keypair(p, seedFor(p, 46));
    const bob = keypair(p, seedFor(p, 47));
    const msg = enc.encode('cross key');
    const { sig } = sign(p, alice.sk.esk, msg);
    expect(verify(p, alice.pk, msg, sig).ok).toBe(true);
    expect(verify(p, bob.pk, msg, sig).ok).toBe(false);
  });

  it('TOY: rejects an all-zero signature', () => {
    const p = TOY;
    const { pk } = keypair(p, seedFor(p, 48));
    expect(verify(p, pk, enc.encode('zero'), new Uint8Array(sizes(p).sigBytes)).ok).toBe(false);
  });

  it('rejects a wrong-length signature and a wrong-length epk', () => {
    const p = TOY;
    const { pk } = keypair(p, seedFor(p, 49));
    expect(() => verify(p, pk, enc.encode('x'), new Uint8Array(3))).toThrow(/signature must be/);
    expect(() => parseExpandedPK(p, new Uint8Array(3))).toThrow(/epk must be/);
  });

  it('TOY: the randomizer R changes the signature but not validity', () => {
    const p = TOY;
    const { sk, pk } = keypair(p, seedFor(p, 50));
    const msg = enc.encode('same message');
    const a = sign(p, sk.esk, msg);
    const b = sign(p, sk.esk, msg, { r: Uint8Array.from({ length: sizes(p).rBytes }, (_, i) => i + 1) });
    expect(bytesToHex(a.sig)).not.toBe(bytesToHex(b.sig));
    expect(verify(p, pk, msg, a.sig).ok).toBe(true);
    expect(verify(p, pk, msg, b.sig).ok).toBe(true);
  });

  it('TOY: signing with R = 0 is deterministic', () => {
    const p = TOY;
    const { sk } = keypair(p, seedFor(p, 51));
    const msg = enc.encode('deterministic');
    expect(bytesToHex(sign(p, sk.esk, msg).sig)).toBe(bytesToHex(sign(p, sk.esk, msg).sig));
  });

  it('TOY: verify parses an expanded public key from bytes alone', () => {
    const p = TOY;
    const { keys, sk } = keypair(p, seedFor(p, 52));
    const pk = expandPK(p, keys.cpk);
    const msg = enc.encode('bytes only');
    const { sig } = sign(p, sk.esk, msg);
    expect(verify(p, parseExpandedPK(p, pk.epk), msg, sig).ok).toBe(true);
  });

  it('rejects a wrong-length esk or R', () => {
    const p = TOY;
    const { sk } = keypair(p, seedFor(p, 53));
    expect(() => sign(p, new Uint8Array(10), enc.encode('x'))).toThrow(/esk must be/);
    expect(() => sign(p, sk.esk, enc.encode('x'), { r: new Uint8Array(1) })).toThrow(/R must be/);
  });
});

describe('reference known-answer tests (MAYO round-2 submission, KAT/*.rsp)', () => {
  const sets: Array<[MayoParams, keyof typeof katVectors]> = [
    [MAYO1, 'MAYO_1'],
    [MAYO2, 'MAYO_2'],
    [MAYO3, 'MAYO_3'],
    [MAYO5, 'MAYO_5'],
  ];

  for (const [p, key] of sets) {
    for (const vector of katVectors[key]) {
      it(`${key} count ${vector.count}: keypair, signature and verify match the reference`, () => {
        // The KAT harness seeds NIST's AES-256-CTR-DRBG with `seed`, then MAYO
        // draws seedsk (keypair) and R (sign) from it, in that order.
        const drbg = new NistCtrDrbg(hexToBytes(vector.seed));
        const seedSk = drbg.randomBytes(sizes(p).skSeedBytes);
        expect(bytesToHex(seedSk)).toBe(vector.sk.toLowerCase());

        const keys = compactKeyGen(p, seedSk);
        expect(bytesToHex(keys.cpk)).toBe(vector.pk.toLowerCase());

        const r = drbg.randomBytes(sizes(p).rBytes);
        const msg = hexToBytes(vector.msg);
        expect(msg.length).toBe(vector.mlen);

        const sk = expandSK(p, keys.csk);
        const { sig } = sign(p, sk.esk, msg, { r });
        const sm = concatBytes(sig, msg);
        expect(sm.length).toBe(vector.smlen);
        expect(bytesToHex(sm)).toBe(vector.sm.toLowerCase());

        expect(verify(p, expandPK(p, keys.cpk), msg, sig).ok).toBe(true);
      });
    }
  }
});
