/**
 * Exhibit 2 — the headline mechanism, stepped.
 *
 * Everything shown here comes out of the real signing path: the trace returned
 * by MAYO.Sign, plus one extra call that attempts the *unwhipped* system so the
 * failure is demonstrated rather than described.
 */
import { rank, type Mat } from '../mayo/gf16';
import { TOY } from '../mayo/params';
import {
  assemblePublicMatrices,
  evalWhipped,
  keypair,
  sign,
  tryUnwhipped,
  type ExpandedPublicKey,
  type ExpandedSecretKey,
  type SignResult,
} from '../mayo/mayo';
import { emulsifierMatrix, whipPairs } from '../mayo/whip';
import { byId, el, hex, matrixTable, superscript, tableFigure, vectorList, verdict } from './dom';

const p = TOY;
const TOTAL_STEPS = 5;

interface State {
  message: string;
  keys: { sk: ExpandedSecretKey; pk: ExpandedPublicKey };
  seed: Uint8Array;
  result: SignResult;
  revealed: number;
}

let state: State | null = null;

export function initWhip(): void {
  const msgInput = byId<HTMLInputElement>('whip-msg');
  const next = byId<HTMLButtonElement>('whip-next');

  const ensure = (): State => {
    if (state && state.message === msgInput.value) return state;
    const seed = crypto.getRandomValues(new Uint8Array(p.saltBytes));
    const { sk, pk } = keypair(p, seed);
    state = {
      message: msgInput.value,
      keys: { sk, pk },
      seed,
      result: sign(p, sk.esk, new TextEncoder().encode(msgInput.value)),
      revealed: 0,
    };
    return state;
  };

  const draw = (): void => {
    const s = state;
    if (!s) return;
    for (let step = 1; step <= TOTAL_STEPS; step++) {
      const done = step <= s.revealed;
      byId(`whip-step-${step}`).dataset.state = done ? 'done' : 'idle';
      byId(`whip-state-${step}`).textContent = done ? 'Done' : 'Waiting';
    }
    next.textContent = s.revealed >= TOTAL_STEPS ? 'All steps shown' : 'Step forward';
    next.disabled = s.revealed >= TOTAL_STEPS;
  };

  const reveal = (upTo: number): void => {
    const s = ensure();
    for (let step = s.revealed + 1; step <= upTo; step++) {
      renderStep(step, s);
      s.revealed = step;
    }
    draw();
  };

  next.addEventListener('click', () => reveal((state?.revealed ?? 0) + 1));
  byId('whip-run').addEventListener('click', () => reveal(TOTAL_STEPS));
  byId('whip-reset').addEventListener('click', () => {
    state = null;
    for (let step = 1; step <= TOTAL_STEPS; step++) {
      const body = byId(`whip-body-${step}`);
      const dynamic = body.querySelector('[data-dynamic]');
      if (dynamic) dynamic.remove();
      byId(`whip-step-${step}`).dataset.state = 'idle';
      byId(`whip-state-${step}`).textContent = 'Waiting';
    }
    next.disabled = false;
    next.textContent = 'Step forward';
  });
  msgInput.addEventListener('input', () => {
    if (state && state.message !== msgInput.value) byId<HTMLButtonElement>('whip-reset').click();
  });
}

function stepTarget(step: number): HTMLElement {
  const body = byId(`whip-body-${step}`);
  const existing = body.querySelector('[data-dynamic]');
  if (existing) existing.remove();
  const holder = el('div', { 'data-dynamic': 'true', role: 'status', 'aria-live': 'polite' });
  body.append(holder);
  return holder;
}

function renderStep(step: number, s: State): void {
  const target = stepTarget(step);
  switch (step) {
    case 1:
      renderTarget(target, s);
      break;
    case 2:
      renderUnwhipped(target, s);
      break;
    case 3:
      renderWhip(target, s);
      break;
    case 4:
      renderSolve(target, s);
      break;
    default:
      renderAssemble(target, s);
  }
}

function renderTarget(target: HTMLElement, s: State): void {
  const { digest, salt, t } = s.result.trace;
  target.append(
    el('p', { class: 'field-label', text: `SHAKE256(message, ${p.digestBytes}) — digest` }),
    el('pre', { class: 'hexblock', text: hex(digest) }),
    el('p', { class: 'field-label', text: `salt = SHAKE256(digest ‖ R ‖ seedsk, ${p.saltBytes})` }),
    el('pre', { class: 'hexblock', text: hex(salt) }),
    el('p', { class: 'field-label', text: `t = the m = ${p.m} field elements the signature must hit` }),
    vectorList(t, { ariaLabel: 'target vector t' }),
  );
}

function renderUnwhipped(target: HTMLElement, s: State): void {
  const { t, vinegar } = s.result.trace;
  const attempt = tryUnwhipped(p, s.keys.sk, t, vinegar[0]);

  target.append(
    el('p', { class: 'field-label', text: `v₁ — the n − o = ${p.n - p.o} vinegar coordinates, drawn from SHAKE256` }),
    vectorList(vinegar[0], { ariaLabel: 'vinegar vector v1' }),
    matrixTable(attempt.a, {
      caption: `A₁ · x = y — ${attempt.a.rows} equations in ${attempt.a.cols} unknowns. Row j is v₁ᵀ·Lⱼ, and the unknowns are the o oil coordinates.`,
      ariaLabel: 'the unwhipped linear system',
      rhs: { label: 'y', values: attempt.y },
    }),
  );

  if (attempt.x === null) {
    const row = attempt.contradictionRow!;
    const aCols = attempt.a.cols;
    target.append(
      matrixTable(attempt.echelon, {
        caption:
          'Echelon form of (A₁ | y). One row has run out of unknowns while its right-hand side is still non-zero — that row says 0 = something, so there is nothing to solve.',
        ariaLabel: 'echelon form of the unwhipped system',
        colLabels: [...Array.from({ length: aCols }, (_, j) => String(j)), 'y'],
        cell: (i, j) => {
          if (i !== row) return j === aCols ? { cls: 'cell--rhs' } : undefined;
          return j === aCols
            ? { cls: 'cell--bad cell--rhs', marker: '✗', title: 'non-zero right-hand side' }
            : { cls: 'cell--bad', title: 'all-zero row' };
        },
      }),
      verdict(
        'warn',
        `No solution — row ${row} reads 0 = ${attempt.echelon.d[row * (attempt.a.cols + 1) + attempt.a.cols].toString(16)}`,
        `${p.m} equations, ${p.o} unknowns. There are ${p.m - p.o} equations too many, so a random target is out of reach with probability about 1 − 16⁻³. Classic Oil-and-Vinegar avoids this by making o ≥ m — and pays for it in public key size.`,
      ),
    );
  } else {
    target.append(
      verdict(
        'warn',
        'This vinegar happened to work — that is the 1-in-4096 case',
        'With m − o = 3 spare equations a random target is reachable about once in 16³ tries. Press Reset and change the message to see the usual outcome.',
      ),
    );
  }
}

function renderWhip(target: HTMLElement, s: State): void {
  const { vinegar } = s.result.trace;
  const pairs = whipPairs(p.k);

  const vinegarBlock = el('div', {}, [
    el('p', { class: 'field-label', text: `k = ${p.k} independent vinegar vectors` }),
  ]);
  vinegar.forEach((v, i) => {
    vinegarBlock.append(el('p', { class: 'bar-caption', text: `v${i + 1}` }));
    vinegarBlock.append(vectorList(v, { ariaLabel: `vinegar vector v${i + 1}` }));
  });
  target.append(vinegarBlock);

  const table = el('table', { class: 'matrix' });
  const head = el('tr', {}, [el('th', { scope: 'col', text: 'i \\ j' })]);
  for (let j = 0; j < p.k; j++) head.append(el('th', { scope: 'col', text: `x${j + 1}` }));
  table.append(el('thead', {}, [head]));
  const body = el('tbody');
  for (let i = 0; i < p.k; i++) {
    const row = el('tr', {}, [el('th', { scope: 'row', text: `x${i + 1}` })]);
    for (let j = 0; j < p.k; j++) {
      const pair = pairs.find((x) => x.i === Math.min(i, j) && x.j === Math.max(i, j))!;
      row.append(
        el('td', {
          class: i === j ? 'cell--pivot' : '',
          title: i === j ? `diagonal: z^${pair.l}·P(x${i + 1})` : `cross term: z^${pair.l}·P′(x${i + 1},x${j + 1})`,
          text: `z^${pair.l}`,
        }),
      );
    }
    body.append(row);
  }
  table.append(body);
  target.append(
    tableFigure(
      `Z(${p.k}×${p.k}) — the power of z applied to each pair of copies. P*(x₁,…,x_k) = Σ z^ℓ·P′(xᵢ,xⱼ), with the diagonal carrying the plain P(xᵢ) terms.`,
      'the emulsifier exponent for each pair of copies',
      table,
    ),
  );

  target.append(
    el('p', {
      class: 'lede',
      text: `Because the E matrices are multiplication by z^ℓ in the field F16[z]/${p.fName}, no non-trivial combination of them can lose rank — that is what stops the k copies from cancelling each other out.`,
    }),
  );

  const e1 = emulsifierMatrix(p.f, 1);
  const details = el('details', {}, [
    el('summary', { text: 'Show the emulsifier matrix E¹ and its rank' }),
    matrixTable(e1, {
      caption: `E¹ — multiplication by z in F16[z]/${p.fName}, written out as an ${p.m}×${p.m} matrix.`,
      ariaLabel: 'the emulsifier matrix E to the power 1',
    }),
    el('p', { text: `rank(E¹) = ${rank(e1)} = m, so E¹ is invertible.` }),
  ]);
  target.append(details);
}

function renderSolve(target: HTMLElement, s: State): void {
  const { system, echelon, x, attempts } = s.result.trace;
  const pivotCols = pivotColumns(echelon, system.a.cols);

  target.append(
    matrixTable(system.a, {
      caption: `A · x = y — still ${system.a.rows} equations, now ${system.a.cols} unknowns (${p.k} blocks of o = ${p.o}).`,
      ariaLabel: 'the whipped linear system',
      rhs: { label: 'y', values: system.y },
      colLabels: Array.from({ length: system.a.cols }, (_, j) => `${Math.floor(j / p.o) + 1}.${j % p.o}`),
    }),
    matrixTable(echelon, {
      caption: 'Echelon form of (A | y) with leading ones. Every row found a pivot, so the system has solutions.',
      ariaLabel: 'echelon form of the whipped system',
      colLabels: [...Array.from({ length: system.a.cols }, (_, j) => String(j)), 'y'],
      cell: (i, j) => {
        if (pivotCols[i] === j) return { cls: 'cell--pivot', marker: '*', title: 'pivot' };
        return j === system.a.cols ? { cls: 'cell--rhs' } : undefined;
      },
    }),
    el('ul', { class: 'legend', role: 'list' }, [
      el('li', { role: 'listitem' }, [
        el('span', { class: 'swatch swatch--pivot', 'aria-hidden': 'true' }),
        'pivot, also marked *',
      ]),
    ]),
    el('p', {
      class: 'field-label',
      text: `x — the ${system.a.cols} oil coordinates, one block per copy (the randomiser r picks which of the 16${superscript(system.a.cols - system.a.rows)} solutions we take)`,
    }),
    vectorList(x, { ariaLabel: 'oil solution x', cell: () => 'is-oil' }),
    verdict(
      'ok',
      `Solved on attempt ctr = ${s.result.trace.ctr}`,
      attempts.length === 1
        ? 'The first vinegar draw gave a full-rank system, which is the usual case.'
        : `${attempts.length} draws were needed: the earlier ones produced a rank-deficient A, which MAYO handles by re-drawing the vinegar.`,
    ),
  );
}

function renderAssemble(target: HTMLElement, s: State): void {
  const { trace, sig } = s.result;
  const pMats = assemblePublicMatrices(p, s.keys.pk);
  const y = evalWhipped(p, pMats, trace.s);
  const matches = y.every((value, i) => value === trace.t[i]);

  for (let i = 0; i < p.k; i++) {
    const block = trace.s.subarray(i * p.n, (i + 1) * p.n);
    target.append(el('p', { class: 'bar-caption', text: `s${i + 1} = (v${i + 1} + O·x${i + 1} ‖ x${i + 1})` }));
    target.append(
      vectorList(block, {
        ariaLabel: `signature block s${i + 1}`,
        cell: (idx) => (idx >= p.n - p.o ? 'is-oil' : undefined),
      }),
    );
  }

  target.append(
    el('p', { class: 'field-label', text: 'P*(s) — the public whipped map, evaluated on the signature' }),
    vectorList(y, {
      ariaLabel: 'the whipped map evaluated on the signature',
      cell: (i, value) => (value === trace.t[i] ? 'is-ok' : 'is-bad'),
    }),
    el('p', { class: 'field-label', text: 't — recomputed from the message and salt' }),
    vectorList(trace.t, { ariaLabel: 'target vector t' }),
    verdict(
      matches ? 'ok' : 'bad',
      matches ? 'P*(s) = t — the signature lands exactly on the target' : 'Mismatch — this would be a bug',
      matches
        ? `The whole ${sig.length}-byte signature is ⌈k·n/2⌉ = ${Math.ceil((p.k * p.n) / 2)} bytes of s plus the ${p.saltBytes}-byte salt.`
        : 'Signing and verification disagree; please report this.',
    ),
    el('p', { class: 'field-label', text: 'The signature on the wire' }),
    el('pre', { class: 'hexblock', text: hex(sig) }),
  );
}

function pivotColumns(m: Mat, aCols: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.rows; i++) {
    let lead = -1;
    for (let j = 0; j < aCols; j++) {
      if (m.d[i * m.cols + j] !== 0) {
        lead = j;
        break;
      }
    }
    out.push(lead);
  }
  return out;
}
