import { describe, expect, it } from 'vitest';
import { mat, upper } from './gf16';
import {
  bytesToHex,
  decodeMatrices,
  decodeO,
  decodeVec,
  encodeMatrices,
  encodeO,
  encodeVec,
  hexToBytes,
} from './encode';
import { MAYO1, MAYO2, MAYO3, MAYO5, maxWhippingFactor, sizes, TOY } from './params';

describe('spec encodings (§2.1.4)', () => {
  it('packs two nibbles per byte, low nibble first', () => {
    // EncodeF16 puts (a0,a1,a2,a3) LSB-first, and the first element goes low.
    expect(bytesToHex(encodeVec(Uint8Array.from([0x1, 0x2])))).toBe('21');
    expect(bytesToHex(encodeVec(Uint8Array.from([0xf, 0x0])))).toBe('0f');
  });

  it('pads an odd-length vector with a zero nibble', () => {
    const v = Uint8Array.from([1, 2, 3]);
    const enc = encodeVec(v);
    expect(enc.length).toBe(2);
    expect(bytesToHex(enc)).toBe('2103');
    expect(Array.from(decodeVec(3, enc))).toEqual([1, 2, 3]);
  });

  it('round-trips vectors of every length up to 40', () => {
    for (let n = 1; n <= 40; n++) {
      const v = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 16);
      expect(Array.from(decodeVec(n, encodeVec(v)))).toEqual(Array.from(v));
    }
  });

  it('round-trips the oil basis O', () => {
    const o = mat(6, 3, Uint8Array.from({ length: 18 }, (_, i) => (i * 5 + 1) % 16));
    const dec = decodeO(6, 3, encodeO(o));
    expect(Array.from(dec.d)).toEqual(Array.from(o.d));
  });

  it('interleaves a sequence of m matrices entry by entry', () => {
    // Two 1x2 matrices: encoding order is A0[0,0], A1[0,0], A0[0,1], A1[0,1].
    const a0 = mat(1, 2, Uint8Array.from([1, 3]));
    const a1 = mat(1, 2, Uint8Array.from([2, 4]));
    expect(bytesToHex(encodeMatrices(1, 2, [a0, a1], false))).toBe('2143');
  });

  it('round-trips upper-triangular and full matrix sequences', () => {
    const m = 6;
    const tri = Array.from({ length: m }, (_, a) =>
      upper(mat(4, 4, Uint8Array.from({ length: 16 }, (_, i) => (i * (a + 2) + a) % 16))),
    );
    const decTri = decodeMatrices(4, 4, m, encodeMatrices(4, 4, tri, true), true);
    decTri.forEach((d, a) => expect(Array.from(d.d)).toEqual(Array.from(tri[a].d)));

    const full = Array.from({ length: m }, (_, a) =>
      mat(4, 3, Uint8Array.from({ length: 12 }, (_, i) => (i * (a + 3) + 1) % 16)),
    );
    const decFull = decodeMatrices(4, 3, m, encodeMatrices(4, 3, full, false), false);
    decFull.forEach((d, a) => expect(Array.from(d.d)).toEqual(Array.from(full[a].d)));
  });

  it('rejects short input and bad hex', () => {
    expect(() => decodeVec(10, new Uint8Array(4))).toThrow(/need 5 bytes/);
    expect(() => hexToBytes('abc')).toThrow(/odd length/);
    expect(() => hexToBytes('zz')).toThrow(/not hex/);
  });
});

describe('derived sizes match spec Table 2.1', () => {
  it.each([MAYO1, MAYO2, MAYO3, MAYO5])('$name public key and signature sizes', (p) => {
    const sz = sizes(p);
    expect(sz.cpkBytes).toBe(p.quoted!.pk);
    expect(sz.sigBytes).toBe(p.quoted!.sig);
    expect(sz.cskBytes).toBe(p.securityLevel === 1 ? 24 : p.securityLevel === 3 ? 32 : 40);
  });

  it('keeps every derived size a whole number of bytes', () => {
    for (const p of [TOY, MAYO1, MAYO2, MAYO3, MAYO5]) {
      for (const [name, value] of Object.entries(sizes(p))) {
        expect(Number.isInteger(value), `${p.name}.${name} = ${value}`).toBe(true);
      }
    }
  });

  it('never offers a whipping factor the spec forbids', () => {
    // The figure's slider used to run to k + 2 unconditionally, which for the toy
    // set offered k = 4 and 5 — configurations MAYO cannot build, because whipping
    // needs k(k+1)/2 distinct E matrices and only m of them exist.
    for (const p of [TOY, MAYO1, MAYO2, MAYO3, MAYO5]) {
      const max = maxWhippingFactor(p);
      expect(max, `${p.name}: shipped k must be reachable`).toBeGreaterThanOrEqual(p.k);
      expect((max * (max + 1)) / 2, `${p.name}: k(k+1)/2 <= m`).toBeLessThanOrEqual(p.m);
      expect(max, `${p.name}: k < n - o`).toBeLessThan(p.n - p.o);
      // And one more copy would break a constraint.
      const over = max + 1;
      expect((over * (over + 1)) / 2 > p.m || over >= p.n - p.o).toBe(true);
    }
    // Concretely, for the toy set that cap is the shipped k itself.
    expect(maxWhippingFactor(TOY)).toBe(3);
  });

  it('satisfies the spec constraints on (n, m, o, k)', () => {
    for (const p of [TOY, MAYO1, MAYO2, MAYO3, MAYO5]) {
      expect(p.m % 2, `${p.name}: m must be even`).toBe(0);
      expect((p.k * (p.k + 1)) / 2, `${p.name}: k(k+1)/2 <= m`).toBeLessThanOrEqual(p.m);
      expect(p.k * p.o, `${p.name}: ko > m`).toBeGreaterThan(p.m);
      expect(p.k, `${p.name}: k < n - o`).toBeLessThan(p.n - p.o);
      expect(p.o, `${p.name}: o <= n - m`).toBeLessThanOrEqual(p.n - p.m);
      expect(p.f.length - 1, `${p.name}: deg f = m`).toBe(p.m);
    }
  });
});
