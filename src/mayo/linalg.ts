/**
 * Linear algebra over GF(16): the echelon form of spec Algorithm 1 and the
 * SampleSolution of Algorithm 2, plus a general consistency solver used by the
 * teaching panel that shows the *unwhipped* system failing.
 */
import { inv, mat, MUL_TABLE, type Mat } from './gf16';

export interface EchelonResult {
  /** (A | y) in echelon form with leading ones. */
  b: Mat;
  /** Column index of the leading 1 of each row, or −1 for a zero row. */
  pivots: number[];
}

/** EF(B): echelon form with leading ones, exactly as spec Algorithm 1. */
export function echelonForm(input: Mat): EchelonResult {
  const b = { rows: input.rows, cols: input.cols, d: input.d.slice() };
  const { rows, cols } = b;
  let pivotRow = 0;
  let pivotCol = 0;
  while (pivotRow < rows && pivotCol < cols) {
    let nextPivotRow = -1;
    for (let i = pivotRow; i < rows; i++) {
      if (b.d[i * cols + pivotCol] !== 0) {
        nextPivotRow = i;
        break;
      }
    }
    if (nextPivotRow < 0) {
      pivotCol++;
      continue;
    }
    if (nextPivotRow !== pivotRow) swapRows(b, pivotRow, nextPivotRow);

    const scale = inv(b.d[pivotRow * cols + pivotCol]);
    const pOff = pivotRow * cols;
    for (let j = 0; j < cols; j++) b.d[pOff + j] = MUL_TABLE[scale * 16 + b.d[pOff + j]];

    for (let row = nextPivotRow + 1; row < rows; row++) {
      const off = row * cols;
      const factor = b.d[off + pivotCol];
      if (factor === 0) continue;
      const fRow = factor * 16;
      for (let j = 0; j < cols; j++) b.d[off + j] ^= MUL_TABLE[fRow + b.d[pOff + j]];
    }
    pivotRow++;
    pivotCol++;
  }
  return { b, pivots: leadingColumns(b) };
}

function swapRows(a: Mat, i: number, j: number): void {
  const { cols } = a;
  for (let c = 0; c < cols; c++) {
    const t = a.d[i * cols + c];
    a.d[i * cols + c] = a.d[j * cols + c];
    a.d[j * cols + c] = t;
  }
}

function leadingColumns(a: Mat): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.rows; i++) {
    let lead = -1;
    for (let j = 0; j < a.cols; j++) {
      if (a.d[i * a.cols + j] !== 0) {
        lead = j;
        break;
      }
    }
    out.push(lead);
  }
  return out;
}

export interface SampleSolutionResult {
  /** The solution x with A·x = y, or null when rank(A) < m. */
  x: Uint8Array | null;
  /** (A | y) after randomization and echelon reduction — what the UI shows. */
  echelon: Mat;
  /** True when the last row of the reduced A is all zero, i.e. rank < m. */
  rankDeficient: boolean;
}

/**
 * SampleSolution(A, y, r) from spec Algorithm 2. The randomizer r picks one of
 * the q^(ko−m) solutions uniformly; MAYO needs that so signatures do not leak
 * the oil space.
 */
export function sampleSolution(a: Mat, y: Uint8Array, r: Uint8Array): SampleSolutionResult {
  const m = a.rows;
  const ko = a.cols;
  if (ko < m) throw new Error('sampleSolution requires ko >= m');

  // Randomize: solve A·x' = y − A·r, then x = x' + r.
  const x = r.slice();
  const yr = y.slice();
  for (let i = 0; i < m; i++) {
    let acc = 0;
    const off = i * ko;
    for (let j = 0; j < ko; j++) acc ^= MUL_TABLE[a.d[off + j] * 16 + r[j]];
    yr[i] ^= acc;
  }

  const aug = mat(m, ko + 1);
  for (let i = 0; i < m; i++) {
    aug.d.set(a.d.subarray(i * ko, (i + 1) * ko), i * (ko + 1));
    aug.d[i * (ko + 1) + ko] = yr[i];
  }
  const { b } = echelonForm(aug);

  // rank(A) = m iff the last row of the reduced A part is nonzero.
  let lastRowZero = true;
  for (let j = 0; j < ko; j++) {
    if (b.d[(m - 1) * (ko + 1) + j] !== 0) {
      lastRowZero = false;
      break;
    }
  }
  if (lastRowZero) return { x: null, echelon: b, rankDeficient: true };

  // Back-substitution over the echelon form.
  const yy = new Uint8Array(m);
  for (let i = 0; i < m; i++) yy[i] = b.d[i * (ko + 1) + ko];
  for (let row = m - 1; row >= 0; row--) {
    let c = -1;
    for (let j = 0; j < ko; j++) {
      if (b.d[row * (ko + 1) + j] !== 0) {
        c = j;
        break;
      }
    }
    if (c < 0) continue;
    x[c] ^= yy[row];
    const factor = yy[row];
    if (factor !== 0) {
      const fRow = factor * 16;
      for (let i = 0; i < m; i++) yy[i] ^= MUL_TABLE[fRow + b.d[i * (ko + 1) + c]];
    }
  }
  return { x, echelon: b, rankDeficient: false };
}

export interface GeneralSolveResult {
  /** One solution, or null when the system is inconsistent. */
  x: Uint8Array | null;
  /** (A | y) in echelon form. */
  echelon: Mat;
  /** Index of a row that reads 0 = nonzero, proving inconsistency. */
  contradictionRow: number | null;
  rank: number;
}

/**
 * Solve A·x = y with no assumption about shape or rank — the honest answer for
 * the too-small oil space, where the system is over-determined and generically
 * has *no* solution at all. Not part of MAYO; used only to show what breaks.
 */
export function solveGeneral(a: Mat, y: Uint8Array): GeneralSolveResult {
  const rows = a.rows;
  const cols = a.cols;
  const aug = mat(rows, cols + 1);
  for (let i = 0; i < rows; i++) {
    aug.d.set(a.d.subarray(i * cols, (i + 1) * cols), i * (cols + 1));
    aug.d[i * (cols + 1) + cols] = y[i];
  }
  const { b, pivots } = echelonForm(aug);

  let contradictionRow: number | null = null;
  let rank = 0;
  for (let i = 0; i < rows; i++) {
    const lead = pivots[i];
    if (lead === cols) {
      // Leading 1 sits in the augmented column: 0 = 1.
      if (contradictionRow === null) contradictionRow = i;
    } else if (lead >= 0) {
      rank++;
    }
  }
  if (contradictionRow !== null) return { x: null, echelon: b, contradictionRow, rank };

  const x = new Uint8Array(cols);
  for (let i = rows - 1; i >= 0; i--) {
    const lead = pivots[i];
    if (lead < 0 || lead >= cols) continue;
    let acc = b.d[i * (cols + 1) + cols];
    for (let j = lead + 1; j < cols; j++) acc ^= MUL_TABLE[b.d[i * (cols + 1) + j] * 16 + x[j]];
    x[lead] = acc;
  }
  return { x, echelon: b, contradictionRow: null, rank };
}
