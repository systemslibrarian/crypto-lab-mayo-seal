/**
 * GF(16) = F2[x]/(x^4 + x + 1) — hand-rolled, per MAYO spec §2.1.2.
 *
 * A field element is a plain number 0..15 whose bits (LSB first) are the
 * coefficients (a0, a1, a2, a3) of a0 + a1·x + a2·x² + a3·x³. This is the same
 * nibble convention the spec's EncodeF16 uses, so field elements and their
 * wire encoding are the *same* integers — nothing to convert.
 *
 * Everything here is table-driven and inspectable on purpose: the field is the
 * teaching subject, so it is not delegated to a library.
 */

/** x^4 + x + 1 as a bit pattern (0b1_0011). */
export const MODULUS = 0b10011;

/** Flat 16x16 multiplication table: MUL_TABLE[a * 16 + b] = a·b. */
export const MUL_TABLE: Uint8Array = buildMulTable();

/** INV_TABLE[a] = a⁻¹ for a != 0; INV_TABLE[0] = 0 (0 has no inverse). */
export const INV_TABLE: Uint8Array = buildInvTable();

function carrylessMul(a: number, b: number): number {
  let acc = 0;
  for (let i = 0; i < 4; i++) {
    if ((b >> i) & 1) acc ^= a << i;
  }
  return acc;
}

function reduce(v: number): number {
  // Fold bits 6..4 down using x^4 = x + 1.
  for (let bit = 6; bit >= 4; bit--) {
    if ((v >> bit) & 1) v ^= MODULUS << (bit - 4);
  }
  return v & 0xf;
}

function buildMulTable(): Uint8Array {
  const t = new Uint8Array(256);
  for (let a = 0; a < 16; a++) {
    for (let b = 0; b < 16; b++) t[a * 16 + b] = reduce(carrylessMul(a, b));
  }
  return t;
}

function buildInvTable(): Uint8Array {
  const t = new Uint8Array(16);
  for (let a = 1; a < 16; a++) {
    for (let b = 1; b < 16; b++) {
      if (MUL_TABLE[a * 16 + b] === 1) {
        t[a] = b;
        break;
      }
    }
  }
  return t;
}

/** Addition in GF(16) is XOR — and so is subtraction (characteristic 2). */
export function add(a: number, b: number): number {
  return a ^ b;
}

export function mul(a: number, b: number): number {
  return MUL_TABLE[a * 16 + b];
}

export function inv(a: number): number {
  if (a === 0) throw new Error('GF(16): 0 has no multiplicative inverse');
  return INV_TABLE[a];
}

/** Formats an element as its polynomial in x, e.g. 0b1011 -> "x³+x+1". */
export function polyString(a: number): string {
  if (a === 0) return '0';
  const terms: string[] = [];
  const names = ['1', 'x', 'x²', 'x³'];
  for (let i = 3; i >= 0; i--) if ((a >> i) & 1) terms.push(names[i]);
  return terms.join('+');
}

/* ---------- vectors ---------- */

/** dst ^= src (component-wise addition of vectors over GF(16)). */
export function vecAddInto(dst: Uint8Array, src: Uint8Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] ^= src[i];
}

/** dst ^= c·src */
export function vecScaleAddInto(dst: Uint8Array, src: Uint8Array, c: number): void {
  if (c === 0) return;
  const row = c * 16;
  for (let i = 0; i < dst.length; i++) dst[i] ^= MUL_TABLE[row + src[i]];
}

export function vecEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function dot(a: Uint8Array, b: Uint8Array): number {
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc ^= MUL_TABLE[a[i] * 16 + b[i]];
  return acc;
}

/* ---------- matrices ---------- */

/**
 * Row-major dense matrix over GF(16). Kept as a flat Uint8Array plus its shape
 * so the UI can render any slice of it directly.
 */
export interface Mat {
  rows: number;
  cols: number;
  d: Uint8Array;
}

export function mat(rows: number, cols: number, d?: Uint8Array): Mat {
  return { rows, cols, d: d ?? new Uint8Array(rows * cols) };
}

export function matGet(a: Mat, i: number, j: number): number {
  return a.d[i * a.cols + j];
}

export function matSet(a: Mat, i: number, j: number, v: number): void {
  a.d[i * a.cols + j] = v;
}

export function matClone(a: Mat): Mat {
  return { rows: a.rows, cols: a.cols, d: a.d.slice() };
}

/** C = A·B */
export function matMul(a: Mat, b: Mat): Mat {
  if (a.cols !== b.rows) throw new Error(`matMul shape: ${a.cols} vs ${b.rows}`);
  const c = mat(a.rows, b.cols);
  for (let i = 0; i < a.rows; i++) {
    for (let l = 0; l < a.cols; l++) {
      const ail = a.d[i * a.cols + l];
      if (ail === 0) continue;
      const row = ail * 16;
      const cOff = i * c.cols;
      const bOff = l * b.cols;
      for (let j = 0; j < b.cols; j++) c.d[cOff + j] ^= MUL_TABLE[row + b.d[bOff + j]];
    }
  }
  return c;
}

/** yᵀ = xᵀ·A for a row vector x of length A.rows. */
export function vecMatMul(x: Uint8Array, a: Mat): Uint8Array {
  const out = new Uint8Array(a.cols);
  for (let i = 0; i < a.rows; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = xi * 16;
    const off = i * a.cols;
    for (let j = 0; j < a.cols; j++) out[j] ^= MUL_TABLE[row + a.d[off + j]];
  }
  return out;
}

/** y = A·x for a column vector x of length A.cols. */
export function matVecMul(a: Mat, x: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.rows);
  for (let i = 0; i < a.rows; i++) {
    let acc = 0;
    const off = i * a.cols;
    for (let j = 0; j < a.cols; j++) acc ^= MUL_TABLE[a.d[off + j] * 16 + x[j]];
    out[i] = acc;
  }
  return out;
}

export function transpose(a: Mat): Mat {
  const t = mat(a.cols, a.rows);
  for (let i = 0; i < a.rows; i++) {
    for (let j = 0; j < a.cols; j++) t.d[j * a.rows + i] = a.d[i * a.cols + j];
  }
  return t;
}

/** A ^= B, in place. */
export function matAddInto(a: Mat, b: Mat): void {
  for (let i = 0; i < a.d.length; i++) a.d[i] ^= b.d[i];
}

/**
 * Upper(M) from the spec: keep the diagonal, fold the lower triangle into the
 * upper one. Two matrices with the same Upper() define the same quadratic form,
 * which is why MAYO can ship only the upper triangle.
 */
export function upper(m: Mat): Mat {
  if (m.rows !== m.cols) throw new Error('upper(): matrix must be square');
  const n = m.rows;
  const out = mat(n, n);
  for (let i = 0; i < n; i++) {
    out.d[i * n + i] = m.d[i * n + i];
    for (let j = i + 1; j < n; j++) out.d[i * n + j] = m.d[i * n + j] ^ m.d[j * n + i];
  }
  return out;
}

/** Rank over GF(16), via Gaussian elimination on a copy. */
export function rank(a: Mat): number {
  const b = a.d.slice();
  const { rows, cols } = a;
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let piv = -1;
    for (let i = r; i < rows; i++) {
      if (b[i * cols + c] !== 0) {
        piv = i;
        break;
      }
    }
    if (piv < 0) continue;
    if (piv !== r) {
      for (let j = 0; j < cols; j++) {
        const t = b[r * cols + j];
        b[r * cols + j] = b[piv * cols + j];
        b[piv * cols + j] = t;
      }
    }
    const invPiv = inv(b[r * cols + c]);
    for (let j = c; j < cols; j++) b[r * cols + j] = mul(b[r * cols + j], invPiv);
    for (let i = r + 1; i < rows; i++) {
      const f = b[i * cols + c];
      if (f === 0) continue;
      const row = f * 16;
      for (let j = c; j < cols; j++) b[i * cols + j] ^= MUL_TABLE[row + b[r * cols + j]];
    }
    r++;
  }
  return r;
}
