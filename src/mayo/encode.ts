/**
 * The MAYO wire encodings (spec §2.1.4). Field elements are nibbles, two to a
 * byte, low nibble first. Sequences of m matrices are *interleaved*: the m
 * top-left entries first, then the m entries at [0,1], and so on — which is why
 * decoding a public key needs the matrix shape, not just its length.
 */
import { mat, type Mat } from './gf16';

/** Encodes a vector over GF(16) as ⌈n/2⌉ bytes, low nibble first. */
export function encodeVec(x: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(x.length / 2));
  for (let i = 0; i < x.length; i += 2) {
    const lo = x[i] & 0xf;
    const hi = i + 1 < x.length ? x[i + 1] & 0xf : 0;
    out[i >> 1] = lo | (hi << 4);
  }
  return out;
}

/** Inverse of encodeVec for a known length n. */
export function decodeVec(n: number, bytes: Uint8Array): Uint8Array {
  if (bytes.length < Math.ceil(n / 2)) {
    throw new Error(`decodeVec: need ${Math.ceil(n / 2)} bytes for n=${n}, got ${bytes.length}`);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = bytes[i >> 1];
    out[i] = i % 2 === 0 ? b & 0xf : (b >> 4) & 0xf;
  }
  return out;
}

/** EncodeO: the secret oil basis, row-major, as one long vector. */
export function encodeO(o: Mat): Uint8Array {
  return encodeVec(o.d);
}

export function decodeO(rows: number, cols: number, bytes: Uint8Array): Mat {
  return mat(rows, cols, decodeVec(rows * cols, bytes));
}

/**
 * EncodeMatrices (spec Algorithm 3): interleave m matrices entry-by-entry,
 * skipping the strictly-lower triangle when they are upper triangular.
 */
export function encodeMatrices(rows: number, cols: number, mats: Mat[], isTriangular: boolean): Uint8Array {
  const m = mats.length;
  const nibbles: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (isTriangular && j < i) continue;
      for (let a = 0; a < m; a++) nibbles.push(mats[a].d[i * cols + j]);
    }
  }
  return encodeVec(Uint8Array.from(nibbles));
}

export function decodeMatrices(
  rows: number,
  cols: number,
  m: number,
  bytes: Uint8Array,
  isTriangular: boolean,
): Mat[] {
  const entries = isTriangular ? (rows * (rows + 1)) / 2 : rows * cols;
  const flat = decodeVec(entries * m, bytes);
  const out: Mat[] = [];
  for (let a = 0; a < m; a++) out.push(mat(rows, cols));
  let idx = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (isTriangular && j < i) continue;
      for (let a = 0; a < m; a++) out[a].d[i * cols + j] = flat[idx++];
    }
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new Error('hexToBytes: odd length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hexToBytes: not hex');
    out[i] = byte;
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
