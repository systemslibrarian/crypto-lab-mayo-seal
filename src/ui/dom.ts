/** Small DOM helpers shared by the exhibits. No framework, no dependencies. */
import type { Mat } from '../mayo/gf16';

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/** One GF(16) element as a single hex digit. */
export function nibble(v: number): string {
  return v.toString(16);
}

export function hex(bytes: Uint8Array, maxBytes = Number.POSITIVE_INFINITY): string {
  const shown = bytes.subarray(0, Math.min(bytes.length, maxBytes));
  let out = '';
  for (let i = 0; i < shown.length; i++) {
    out += shown[i].toString(16).padStart(2, '0');
    if ((i + 1) % 2 === 0 && i + 1 < shown.length) out += ' ';
  }
  if (bytes.length > shown.length) out += ` … (+${bytes.length - shown.length} bytes)`;
  return out;
}

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/** 12 → "¹²", −3 → "⁻³", so exponents read as exponents in plain text. */
export function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => (d === '-' ? '⁻' : (SUPERSCRIPTS[Number(d)] ?? d)))
    .join('');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

export type VerdictKind = 'ok' | 'bad' | 'warn' | 'idle';

const VERDICT_ICON: Record<VerdictKind, string> = { ok: '✓', bad: '✗', warn: '!', idle: '·' };

/**
 * A status block that never relies on colour alone: an icon, a worded headline
 * and a colour, in that order of importance.
 */
export function verdict(kind: VerdictKind, headline: string, detail?: string | Node): HTMLElement {
  const body = el('div', { class: 'verdict__body' }, [el('strong', { text: headline })]);
  if (typeof detail === 'string') body.append(el('p', { text: detail }));
  else if (detail) body.append(detail);
  return el('div', { class: `verdict verdict--${kind}` }, [
    el('span', { class: 'verdict__icon', 'aria-hidden': 'true', text: VERDICT_ICON[kind] }),
    body,
  ]);
}

let captionSeq = 0;

/**
 * Puts a caption above a narrow table and links the two, for the same reason
 * matrixTable does it: a <caption> is only as wide as its table.
 */
export function tableFigure(captionText: string, ariaLabel: string, table: HTMLTableElement): HTMLElement {
  const captionId = `table-caption-${++captionSeq}`;
  table.setAttribute('aria-labelledby', captionId);
  return el('div', { class: 'matrix-figure' }, [
    el('p', { class: 'table-caption', id: captionId, text: captionText }),
    scroller(ariaLabel, table),
  ]);
}

/** Wraps wide content so it scrolls on its own and stays keyboard reachable. */
export function scroller(label: string, child: Node): HTMLElement {
  return el('div', { class: 'scroller', role: 'region', tabindex: '0', 'aria-label': label }, [child]);
}

export interface CellStyle {
  cls?: string;
  /** A text marker so state is never carried by colour alone. */
  marker?: string;
  title?: string;
}

export interface MatrixOptions {
  caption: string;
  ariaLabel: string;
  /** Column labels; defaults to 0…cols−1. */
  colLabels?: string[];
  rowLabels?: string[];
  /** Extra right-hand column, drawn after a divider (used for the y vector). */
  rhs?: { label: string; values: Uint8Array };
  cell?: (i: number, j: number, value: number) => CellStyle | undefined;
  rhsCell?: (i: number, value: number) => CellStyle | undefined;
  /** Cap on how much of a large matrix to draw. */
  maxRows?: number;
  maxCols?: number;
}

/**
 * Renders a GF(16) matrix as a real table, headers and all.
 *
 * The caption sits outside the table and is wired up with aria-labelledby: a
 * real <caption> inherits the table's own (narrow) width, which turns one
 * sentence into a column of single words next to a small matrix.
 */
export function matrixTable(m: Mat, opts: MatrixOptions): HTMLElement {
  const maxRows = Math.min(m.rows, opts.maxRows ?? m.rows);
  const maxCols = Math.min(m.cols, opts.maxCols ?? m.cols);
  const truncated = maxRows < m.rows || maxCols < m.cols;
  const captionId = `matrix-caption-${++captionSeq}`;
  const caption = el('p', {
    class: 'table-caption',
    id: captionId,
    text: truncated ? `${opts.caption} — showing the first ${maxRows}×${maxCols} block` : opts.caption,
  });
  const table = el('table', { class: 'matrix', 'aria-labelledby': captionId });

  const headRow = el('tr', {}, [el('th', { scope: 'col', text: '' })]);
  for (let j = 0; j < maxCols; j++) {
    headRow.append(el('th', { scope: 'col', text: opts.colLabels?.[j] ?? String(j) }));
  }
  if (opts.rhs) headRow.append(el('th', { scope: 'col', class: 'cell--rhs', text: opts.rhs.label }));
  table.append(el('thead', {}, [headRow]));

  const body = el('tbody');
  for (let i = 0; i < maxRows; i++) {
    const row = el('tr', {}, [el('th', { scope: 'row', text: opts.rowLabels?.[i] ?? String(i) })]);
    for (let j = 0; j < maxCols; j++) {
      const value = m.d[i * m.cols + j];
      const style = opts.cell?.(i, j, value) ?? {};
      const classes = ['cell', value === 0 ? 'cell--zero' : '', style.cls ?? ''].filter(Boolean).join(' ');
      const td = el('td', { class: classes, title: style.title });
      td.append(nibble(value));
      if (style.marker) td.append(el('span', { class: 'marker', text: ` ${style.marker}` }));
      row.append(td);
    }
    if (opts.rhs) {
      const value = opts.rhs.values[i];
      const style = opts.rhsCell?.(i, value) ?? {};
      const td = el('td', { class: ['cell', 'cell--rhs', style.cls ?? ''].filter(Boolean).join(' ') });
      td.append(nibble(value));
      if (style.marker) td.append(el('span', { class: 'marker', text: ` ${style.marker}` }));
      row.append(td);
    }
    body.append(row);
  }
  table.append(body);
  return el('div', { class: 'matrix-figure' }, [caption, scroller(opts.ariaLabel, table)]);
}

export interface VectorOptions {
  /**
   * Marks entries as oil / ok / bad. The class carries a colour *and* a border
   * style, and this function also drives the per-cell accessible name, so state
   * is never colour-only (WCAG 1.4.1).
   */
  cell?: (index: number, value: number) => string | undefined;
  ariaLabel: string;
  maxItems?: number;
}

const CELL_MEANING: Record<string, string> = {
  'is-ok': 'matches',
  'is-bad': 'differs',
  'is-oil': 'oil coordinate',
};

/** Renders a GF(16) vector as a labelled list of nibbles. */
export function vectorList(values: Uint8Array, opts: VectorOptions): HTMLElement {
  const limit = Math.min(values.length, opts.maxItems ?? values.length);
  const list = el('ul', { class: 'vec', role: 'list', 'aria-label': opts.ariaLabel });
  for (let i = 0; i < limit; i++) {
    const cls = opts.cell?.(i, values[i]);
    const meaning = cls ? CELL_MEANING[cls] : undefined;
    list.append(
      el('li', {
        role: 'listitem',
        class: cls ?? '',
        text: nibble(values[i]),
        'aria-label': meaning ? `coordinate ${i}: ${nibble(values[i])}, ${meaning}` : undefined,
        title: meaning ? `coordinate ${i} ${meaning}` : undefined,
      }),
    );
  }
  if (limit < values.length) {
    list.append(el('li', { role: 'listitem', text: `+${values.length - limit}` }));
  }
  return list;
}

/**
 * The legend that makes a compare strip readable without colour: matched and
 * differing cells also carry distinct border treatments.
 */
export function compareLegend(): HTMLElement {
  return el('ul', { class: 'legend', role: 'list' }, [
    el('li', { role: 'listitem' }, [el('span', { class: 'swatch swatch--ok', 'aria-hidden': 'true' }), 'matches (thin underline)']),
    el('li', { role: 'listitem' }, [el('span', { class: 'swatch swatch--bad', 'aria-hidden': 'true' }), 'differs (struck through)']),
  ]);
}

/**
 * A collapsed disclosure for the deeper readout of an exhibit. The summary says
 * what is inside so the default page stays short and an expert can go further
 * without the beginner paying for it.
 */
export function disclosure(summaryText: string, ...children: Node[]): HTMLElement {
  const details = el('details', {}, [el('summary', { text: summaryText })]);
  for (const child of children) details.append(child);
  return details;
}

export function statList(items: Array<{ label: string; value: string; title?: string }>): HTMLElement {
  // A plain <dl> with <div> wrappers — no list roles, which would strip the
  // description-list semantics that dt/dd depend on.
  const list = el('dl', { class: 'stat-row' });
  for (const item of items) {
    list.append(
      el('div', { class: 'stat', title: item.title }, [
        el('dt', { text: item.label }),
        el('dd', { text: item.value }),
      ]),
    );
  }
  return list;
}

/** A labelled proportional bar. `fraction` is clamped into [0.004, 1]. */
export function bar(fraction: number, caption: string, alt = false): HTMLElement {
  const pct = Math.max(0.4, Math.min(100, fraction * 100));
  return el('div', {}, [
    el('div', { class: 'bar' }, [
      el('span', {
        class: `bar__fill${alt ? ' bar__fill--alt' : ''}`,
        style: `width:${pct.toFixed(2)}%`,
      }),
    ]),
    el('p', { class: 'bar-caption', text: caption }),
  ]);
}

export function paragraph(text: string, cls = 'lede'): HTMLElement {
  return el('p', { class: cls, text });
}

export function heading(level: 3 | 4, text: string): HTMLElement {
  return el(level === 3 ? 'h3' : 'h4', { text });
}
