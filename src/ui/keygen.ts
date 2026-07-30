/** Exhibit 1 — keygen, and where the public key's bytes actually go. */
import { matVecMul } from '../mayo/gf16';
import { bytesToHex, hexToBytes } from '../mayo/encode';
import { PARAM_SETS, sizes, type MayoParams, type ParamSetName } from '../mayo/params';
import { assemblePublicMatrices, compactKeyGen, evalP, evalWhipped, expandPK } from '../mayo/mayo';
import { compareWithUov, sizeBreakdown } from '../mayo/uov';
import {
  bar,
  byId,
  clear,
  disclosure,
  el,
  formatBytes,
  formatMs,
  hex,
  matrixTable,
  statList,
  vectorList,
  verdict,
} from './dom';

export function initKeygen(): void {
  const select = byId<HTMLSelectElement>('kg-params');
  const seedInput = byId<HTMLInputElement>('kg-seed');
  const out = byId('kg-out');

  const run = (): void => {
    const p = PARAM_SETS[select.value as ParamSetName];
    const sz = sizes(p);
    let seed: Uint8Array;
    const typed = seedInput.value.trim();
    if (typed === '') {
      seed = crypto.getRandomValues(new Uint8Array(sz.skSeedBytes));
      seedInput.value = bytesToHex(seed);
    } else {
      try {
        seed = hexToBytes(typed);
      } catch (error) {
        clear(out);
        out.append(verdict('bad', 'That seed is not hex', (error as Error).message));
        return;
      }
      if (seed.length !== sz.skSeedBytes) {
        clear(out);
        out.append(
          verdict(
            'bad',
            `${p.name} needs a ${sz.skSeedBytes}-byte seed`,
            `You gave ${seed.length} bytes. Clear the field to get a random one.`,
          ),
        );
        return;
      }
    }
    render(out, p, seed);
  };

  select.addEventListener('change', () => {
    seedInput.value = '';
    clear(out);
    out.append(
      verdict('idle', `${select.value} selected`, 'Press "Generate keypair" to derive a key for this parameter set.'),
    );
  });
  byId('kg-run').addEventListener('click', run);
}

function render(out: HTMLElement, p: MayoParams, seed: Uint8Array): void {
  const started = performance.now();
  const keys = compactKeyGen(p, seed);
  const keygenMs = performance.now() - started;
  const pk = expandPK(p, keys.cpk);
  const sz = sizes(p);
  const breakdown = sizeBreakdown(p);
  const comparison = compareWithUov(p);

  clear(out);

  out.append(
    verdict(
      'ok',
      `${p.name} keypair derived in ${formatMs(keygenMs)}`,
      p.securityLevel === null
        ? 'The same algorithm as the shipped sets, only with insecure dimensions — not a simulation. Small enough to read, and breakable by hand.'
        : `NIST security level ${p.securityLevel} parameters, exactly as shipped in the round-2 submission.`,
    ),
  );

  out.append(
    statList([
      { label: 'n, m, o, k', value: `${p.n}, ${p.m}, ${p.o}, ${p.k}` },
      { label: 'secret key', value: formatBytes(sz.cskBytes), title: 'Just the seed' },
      { label: 'public key', value: formatBytes(sz.cpkBytes), title: 'Seed + P⁽³⁾' },
      { label: 'expanded sk', value: formatBytes(sz.eskBytes) },
      { label: 'expanded pk', value: formatBytes(sz.epkBytes) },
      { label: 'signature', value: formatBytes(sz.sigBytes) },
    ]),
  );

  const keyCard = el('div', { class: 'card' }, [
    el('h3', { text: 'What actually ships' }),
    el('p', {
      text: `The secret key is the ${sz.cskBytes}-byte seed and nothing else. The public key is a ${p.pkSeedBytes}-byte seed plus the ${formatBytes(breakdown.p3)} P⁽³⁾ block.`,
    }),
    el('p', { class: 'field-label', text: 'Secret key (seed)' }),
    el('pre', { class: 'hexblock', text: hex(keys.csk) }),
    el('p', { class: 'field-label', text: 'Compact public key' }),
    el('pre', { class: 'hexblock', text: hex(keys.cpk, 48) }),
  ]);

  const maxBar = Math.max(breakdown.expandedFromSeed, comparison.uov.pk);
  const sizeCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Seed expansion versus download' }),
    bar(
      breakdown.expandedFromSeed / maxBar,
      `P⁽¹⁾ + P⁽²⁾ expanded from the seed by AES-128-CTR: ${formatBytes(breakdown.expandedFromSeed)} — never transmitted`,
    ),
    bar(breakdown.publicKey / maxBar, `MAYO public key on the wire: ${formatBytes(breakdown.publicKey)}`),
    bar(
      comparison.uov.pk / maxBar,
      `The same map unwhipped (k = 1, so o = m = ${comparison.uov.o}): ${formatBytes(comparison.uov.pk)}`,
      true,
    ),
    el('p', {
      text: `Dropping the whip multiplies the key by ${comparison.pkRatio.toFixed(1)}×, because P⁽³⁾ grows with o². The price MAYO pays is a signature ${comparison.sigRatio.toFixed(1)}× larger.`,
    }),
  ]);

  out.append(el('div', { class: 'grid grid--2' }, [keyCard, sizeCard]));

  if (p.name === 'TOY') {
    out.append(renderTrapdoor(p, keys.o, pk));
  } else {
    out.append(
      el('p', { class: 'note' }, [
        document.createTextNode(
          `The matrices for ${p.name} are ${p.m} of size ${p.n}×${p.n} — far too large to draw. Switch to TOY to see the trapdoor itself, or read the identical numbers back from Exhibit 5.`,
        ),
      ]),
    );
  }
}

/**
 * The trapdoor, computed rather than asserted: pick an oil point, evaluate the
 * real public map on it, show that every one of the m outputs is zero.
 */
function renderTrapdoor(p: MayoParams, o: ReturnType<typeof compactKeyGen>['o'], pk: ReturnType<typeof expandPK>): HTMLElement {
  const pMats = assemblePublicMatrices(p, pk);
  const x = crypto.getRandomValues(new Uint8Array(p.o)).map((v) => v & 0xf);
  const oilPoint = new Uint8Array(p.n);
  oilPoint.set(matVecMul(o, x), 0);
  oilPoint.set(x, p.n - p.o);
  const value = evalP(pMats, oilPoint);
  const allZero = value.every((v) => v === 0);

  // The same property one level up: P* vanishes on Oᵏ, which is what guarantees
  // the whipped system has solutions at all.
  const whippedPoint = new Uint8Array(p.k * p.n);
  for (let i = 0; i < p.k; i++) {
    const xi = crypto.getRandomValues(new Uint8Array(p.o)).map((v) => v & 0xf);
    whippedPoint.set(matVecMul(o, xi), i * p.n);
    whippedPoint.set(xi, i * p.n + p.n - p.o);
  }
  const whippedValue = evalWhipped(p, pMats, whippedPoint);
  const whippedZero = whippedValue.every((v) => v === 0);

  const card = el('div', { class: 'card' }, [
    el('h3', { text: 'The trapdoor: the map vanishes on the oil space' }),
    el('p', {
      text: `P⁽³⁾ is built as Upper(−OᵀP⁽¹⁾O − OᵀP⁽²⁾) precisely so that the oil-oil part of every equation cancels. Take a random oil vector x, map it into the n = ${p.n} variables as O·x ‖ x, and evaluate the real public map.`,
    }),
    el('p', { class: 'field-label', text: 'x — random oil coordinates' }),
    vectorList(x, { ariaLabel: 'random oil coordinates', cell: () => 'is-oil' }),
    el('p', { class: 'field-label', text: 'The point in n variables: O·x ‖ x' }),
    vectorList(oilPoint, {
      ariaLabel: 'the oil point in n variables',
      cell: (i) => (i >= p.n - p.o ? 'is-oil' : undefined),
    }),
    el('p', { class: 'field-label', text: 'P(O·x ‖ x) — all m outputs' }),
    vectorList(value, {
      ariaLabel: 'the public map evaluated at the oil point',
      cell: (_i, v) => (v === 0 ? 'is-ok' : 'is-bad'),
    }),
    verdict(
      allZero ? 'ok' : 'bad',
      allZero ? 'All m outputs are zero — the shortcut is real' : 'Non-zero output — this would be a bug',
      allZero
        ? 'Because P vanishes on O, a signer who knows O can move along it freely, which turns signing into a linear problem.'
        : 'Report this: the oil space must always be in the kernel of the public map.',
    ),
    el('p', { class: 'field-label', text: `P*(o₁,…,o_k) for k = ${p.k} independent oil points` }),
    vectorList(whippedValue, {
      ariaLabel: 'the whipped map evaluated on an oil-space point',
      cell: (_i, v) => (v === 0 ? 'is-ok' : 'is-bad'),
    }),
    verdict(
      whippedZero ? 'ok' : 'bad',
      whippedZero
        ? 'The whipped map vanishes on Oᵏ too — which is why a solution exists to find'
        : 'Non-zero output — this would be a bug',
      whippedZero
        ? 'Whipping preserves the trapdoor. That is the whole design constraint: P* must stay zero on Oᵏ while gaining k times the unknowns.'
        : 'Report this: whipping must preserve the vanishing property.',
    ),
  ]);

  const paTable = matrixTable(pMats[0], {
    caption: 'P₀ — the first of the m public matrices. The bottom-left block is zero: no oil coordinate ever multiplies another.',
    ariaLabel: 'first public matrix',
    cell: (i, j) => {
      const v = p.n - p.o;
      if (i >= v && j >= v) return { cls: 'cell--oilblock', title: 'oil × oil (P⁽³⁾)' };
      if (i >= v) return { title: 'structurally zero: oil × vinegar below the diagonal' };
      return undefined;
    },
  });

  card.append(
    disclosure(
      'Show the public matrix that makes it work',
      paTable,
      el('ul', { class: 'legend', role: 'list' }, [
        el('li', { role: 'listitem' }, [
          el('span', { class: 'swatch swatch--oil', 'aria-hidden': 'true' }),
          'oil × oil block (P⁽³⁾)',
        ]),
      ]),
    ),
  );
  return card;
}
