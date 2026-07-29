/** Exhibit 4 — the size ledger. Every figure is either computed or labelled as quoted. */
import { MAYO1, MAYO2, MAYO3, MAYO5, type MayoParams } from '../mayo/params';
import { compareWithUov, computeTradeoffs } from '../mayo/uov';
import { byId, el, formatBytes, scroller } from './dom';

const SETS: MayoParams[] = [MAYO1, MAYO2, MAYO3, MAYO5];

export function initLedger(): void {
  byId('ledger-uov').append(renderUovTable());
  byId('ledger-tradeoff').append(renderTradeoffTable(), renderTradeoffNote());
}

function renderUovTable(): HTMLElement {
  const table = el('table');
  table.append(
    el('caption', {
      text: 'Public key and signature sizes for each shipped MAYO set, next to the same map with the whipping removed (k = 1, which forces o = m and n = m + o).',
    }),
  );
  const head = el('tr');
  for (const label of [
    'Parameter set',
    '(n, m, o, k)',
    'MAYO public key',
    'Unwhipped public key',
    'Key factor',
    'MAYO signature',
    'Unwhipped signature',
    'Signature factor',
  ]) {
    head.append(el('th', { scope: 'col', text: label }));
  }
  table.append(el('thead', {}, [head]));

  const body = el('tbody');
  for (const p of SETS) {
    const c = compareWithUov(p);
    const row = el('tr', {}, [
      el('th', { scope: 'row', text: `${p.name} (level ${p.securityLevel})` }),
      el('td', { class: 'numeric', text: `${p.n}, ${p.m}, ${p.o}, ${p.k}` }),
      el('td', { class: 'numeric', text: formatBytes(c.mayo.pk) }),
      el('td', { class: 'numeric', text: formatBytes(c.uov.pk) }),
      el('td', { class: 'numeric', text: `${c.pkRatio.toFixed(1)}× smaller` }),
      el('td', { class: 'numeric', text: formatBytes(c.mayo.sig) }),
      el('td', { class: 'numeric', text: formatBytes(c.uov.sig) }),
      el('td', { class: 'numeric', text: `${c.sigRatio.toFixed(1)}× larger` }),
    ]);
    body.append(row);
  }
  table.append(body);

  const note = el('p', {
    class: 'note',
    text: 'The unwhipped column is MAYO’s own size formula with o = m, not a quote from the UOV submission — it isolates the cost of the whipping and nothing else. The MAYO spec makes the same point for the (81, 64, 17, 4) set: about a 14-fold smaller public key than compressed Oil-and-Vinegar at the same security level, for roughly twice the signature.',
  });
  return el('div', {}, [scroller('MAYO versus the unwhipped map', table), note]);
}

function renderTradeoffTable(): HTMLElement {
  const table = el('table');
  table.append(
    el('caption', {
      text: 'NIST level 1, spec Table 2.2. "Computed" columns are recalculated in your browser from the size formulas; "in spec" columns are the printed values.',
    }),
  );
  const head = el('tr');
  for (const label of ['(n, m, o, k)', 'Public key, computed', 'Public key, in spec', 'Signature, computed', 'Signature, in spec', 'Agreement']) {
    head.append(el('th', { scope: 'col', text: label }));
  }
  table.append(el('thead', {}, [head]));

  const body = el('tbody');
  for (const row of computeTradeoffs()) {
    const agreement = row.pkMatches && row.sigMatches ? '✓ exact' : row.pkMatches ? '✓ key, signature +1 B' : '✗ mismatch';
    body.append(
      el('tr', {}, [
        el('th', { scope: 'row', class: 'numeric', text: `${row.n}, ${row.m}, ${row.o}, ${row.k}${row.main ? ' ★' : ''}` }),
        el('td', { class: 'numeric', text: `${row.computedPk} B` }),
        el('td', { class: 'numeric', text: `${row.quotedPk} B` }),
        el('td', { class: 'numeric', text: `${row.computedSig} B` }),
        el('td', { class: 'numeric', text: `${row.quotedSig} B` }),
        el('td', { text: agreement }),
      ]),
    );
  }
  table.append(body);
  return scroller('the level-1 public key versus signature trade-off', table);
}

function renderTradeoffNote(): HTMLElement {
  const odd = computeTradeoffs().filter((row) => !row.sigMatches);
  return el('p', {
    class: 'note',
    text:
      `★ marks the two sets that are actually implemented (MAYO1 and MAYO2). ` +
      `${odd.length} rows differ from the printed signature size by one byte: their n·k is odd, and ⌈n·k/2⌉ nibbles will not fit in ⌊n·k/2⌋ bytes. ` +
      `We show our own figure rather than quietly matching the table.`,
  });
}
