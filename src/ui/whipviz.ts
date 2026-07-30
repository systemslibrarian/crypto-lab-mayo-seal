/**
 * The whole idea in one picture.
 *
 * The signing system is m rows tall and k·o columns wide, and MAYO's parameter
 * choice is about the ratio: enough columns that a draw is overwhelmingly likely
 * to have full row rank, with solutions to spare. So the diagram draws the
 * system's width against that threshold and lets you turn k with a slider.
 *
 * The readout is careful about what the threshold does and does not promise.
 * Below it a random target is improbable, not impossible; above it a particular
 * vinegar draw can still come out rank-deficient, which MAYO detects and retries.
 * Both probabilities are computed, not asserted.
 *
 * The picture is never the only channel — the same numbers are printed beside it
 * and the SVG carries a live text description.
 */
import { maxWhippingFactor, PARAM_SETS, type MayoParams, type ParamSetName } from '../mayo/params';
import { compareWithUov, smallestKWithRoom, whipBalance, type WhipBalance } from '../mayo/uov';
import { byId, clear, el, formatBytes, power, stat, statRow, subscript } from './dom';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export function initWhipViz(): void {
  const select = byId<HTMLSelectElement>('wv-params');
  const slider = byId<HTMLInputElement>('wv-k');
  const kValue = byId('wv-k-value');
  const figure = byId('wv-figure');
  const readout = byId('wv-readout');
  const trade = byId('wv-trade');

  const configure = (p: MayoParams): void => {
    // One copy short of having room, through two past the shipped choice — but
    // never past what the spec allows, or the slider would offer a configuration
    // MAYO cannot build.
    const max = Math.min(Math.max(p.k + 2, 4), maxWhippingFactor(p));
    slider.min = '1';
    slider.max = String(max);
    slider.value = String(p.k);
    slider.setAttribute('aria-valuetext', `k = ${p.k}`);
  };

  const draw = (): void => {
    const p = PARAM_SETS[select.value as ParamSetName];
    const k = Number(slider.value);
    const balance = whipBalance(p.m, p.o, p.n, k, p.saltBytes);
    const smallest = smallestKWithRoom(p.m, p.o);

    kValue.textContent = String(k);
    slider.setAttribute('aria-valuetext', `k = ${k}`);
    clear(figure);
    figure.append(renderFigure(p, k, balance.status === 'slack'));

    clear(readout);
    readout.append(
      statRow([
        stat('unknowns (k·o)', String(balance.unknowns)),
        stat('equations (m)', String(balance.equations)),
        stat(balance.slack >= 0 ? 'room to spare' : 'short by', String(Math.abs(balance.slack))),
        stat('signature', `${balance.signatureBytes} B`),
      ]),
      renderBalanceVerdict(balance),
      el('p', {
        class: 'note',
        text:
          k === maxWhippingFactor(p) && k > smallest
            ? `k = ${k} is as far as ${p.name} can go: whipping needs k(k+1)/2 = ${(k * (k + 1)) / 2} distinct E matrices, and only m = ${p.m} exist.`
            : k === smallest
            ? `k = ${smallest} is the smallest whipping factor with k·o > m, and it is exactly the k that ${p.name} ships. Every extra copy would add n = ${p.n} more field elements to the signature for no extra room.`
            : k < smallest
              ? `${p.name} ships k = ${smallest}, the smallest k with k·o > m. Below that the signer is not blocked by a theorem — it is blocked by the odds.`
              : `This works, but it is wasteful: ${p.name} ships k = ${smallest}, and each copy beyond it costs another ⌈n/2⌉ = ${Math.ceil(p.n / 2)} bytes of signature.`,
      }),
    );

    clear(trade);
    trade.append(renderTrade(p, k, balance));
  };

  select.addEventListener('change', () => {
    configure(PARAM_SETS[select.value as ParamSetName]);
    draw();
  });
  slider.addEventListener('input', draw);

  configure(PARAM_SETS[select.value as ParamSetName]);
  draw();
}

/** "84.6×" for small ratios, "85×" once the decimal stops carrying information. */
function times(ratio: number): string {
  return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×`;
}

/**
 * The two halves of the bargain, side by side at the first interaction.
 *
 * The slider alone only shows what k costs — the signature grows as you turn it.
 * That is half a trade, and the wrong half to see first: it makes whipping look
 * like a tax. The saving is on the other side of the page, in the ledger, and a
 * reader who never scrolls that far never learns why MAYO pays it.
 *
 * The baseline is classic UOV reaching the same m, which forces o = m because a
 * single copy has to supply every oil variable itself. Both numbers come from the
 * same size formulas the ledger uses, so this is a computed comparison rather
 * than a quoted one. Only the signature half moves with k; the public key is set
 * by o, and saying so is the point.
 */
function renderTrade(p: MayoParams, k: number, balance: WhipBalance): HTMLElement {
  const c = compareWithUov(p);
  const perCopy = Math.ceil(p.n / 2);

  return el('div', { class: 'wv-trade__inner' }, [
    el('p', { class: 'wv-trade__lead', text: `What that buys, against classic UOV at the same m = ${p.m}:` }),
    el('div', { class: 'wv-trade__cols' }, [
      el('div', { class: 'wv-trade__cell is-win' }, [
        el('p', { class: 'stat-label', text: 'public key' }),
        el('p', { class: 'stat-value', text: formatBytes(c.mayo.pk) }),
        el('p', {
          class: 'wv-trade__note',
          text:
            `${times(c.pkRatio)} smaller than UOV's ${formatBytes(c.uov.pk)}, which needs o = m = ${p.m} ` +
            `to sign with one copy. Set by o = ${p.o}: turning k does not move this number.`,
        }),
      ]),
      el('div', { class: 'wv-trade__cell is-cost' }, [
        el('p', { class: 'stat-label', text: 'signature' }),
        el('p', { class: 'stat-value', text: formatBytes(balance.signatureBytes) }),
        el('p', {
          class: 'wv-trade__note',
          text:
            `${times(balance.signatureBytes / c.uov.sig)} UOV's ${formatBytes(c.uov.sig)}. ` +
            `Set by k = ${k}: every extra copy adds ⌈n/2⌉ = ${perCopy} B.`,
        }),
      ]),
    ]),
  ]);
}

/**
 * Three states, not two. "Solvable / not solvable" was wrong in both directions:
 * below the threshold a target is improbable rather than impossible, and above it
 * a particular draw can still come out rank-deficient and be retried.
 */
function renderBalanceVerdict(balance: WhipBalance): HTMLElement {
  const kind = balance.status === 'slack' ? 'is-ok' : balance.status === 'exact' ? 'is-warn' : 'is-bad';
  const icon = balance.status === 'slack' ? '✓' : balance.status === 'exact' ? '!' : '✗';

  const line = el('p', { class: `wv-verdict ${kind}` }, [
    el('span', { class: 'wv-verdict__icon', 'aria-hidden': 'true', text: icon }),
  ]);
  // One wrapper: the clauses must flow as a sentence, not become flex items.
  const sentence = el('span');
  line.append(sentence);

  if (balance.status === 'short') {
    sentence.append(
      document.createTextNode(
        `Usually out of reach: ${balance.unknowns} unknowns for ${balance.equations} equations. A random target is hit about once in `,
      ),
      power(16, balance.slack),
      document.createTextNode(' draws — improbable, not impossible.'),
    );
  } else if (balance.status === 'exact') {
    sentence.append(
      document.createTextNode(
        `Exactly enough: ${balance.unknowns} unknowns for ${balance.equations} equations. A full-rank draw has one solution, but about one draw in `,
      ),
      restartTerm(balance.restartBits!),
      document.createTextNode(' is rank-deficient and has to be retried. MAYO takes slack instead of balancing here.'),
    );
  } else {
    sentence.append(
      document.createTextNode(`Room to spare: ${balance.unknowns} unknowns for ${balance.equations} equations. A full-row-rank draw has `),
      power(16, balance.slack),
      document.createTextNode(' solutions to choose from; roughly one draw in '),
      restartTerm(balance.restartBits!),
      document.createTextNode(' still comes out rank-deficient, and Sign re-draws the vinegar when it does.'),
    );
  }
  return line;
}

/** The retry figure, or an honest words-only fallback if it underflows. */
function restartTerm(bits: number): Node {
  if (!Number.isFinite(bits)) return document.createTextNode('a number too small for this page to print');
  return power(2, Math.round(bits));
}

/**
 * Draws the k copies as o-wide blocks, the assembled system as one k·o-wide
 * block, and the m-tall threshold the width has to clear.
 */
function renderFigure(p: MayoParams, k: number, hasRoom: boolean): SVGSVGElement {
  const width = 720;
  const height = 260;
  const pad = 16;
  const rowY = 34;
  const rowH = 58;
  const barY = 150;
  const barH = 66;

  // One scale for both rows: whichever is wider, the copies strip or the
  // threshold, defines the pixels-per-unknown.
  const maxUnits = Math.max(k * p.o, p.m) * 1.15;
  const scale = (width - pad * 2) / maxUnits;

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    role: 'img',
    'aria-label': `Diagram: ${k} whipped ${k === 1 ? 'copy' : 'copies'} of the map contribute ${k * p.o} unknown${k * p.o === 1 ? '' : 's'} in total, against ${p.m} equations. ${hasRoom ? 'The system is wider than it is tall, so a full-rank draw has solutions to spare.' : 'The system is narrower than it is tall, so a random target is usually out of reach.'}`,
  });
  root.classList.add('wv-svg');

  const title = svg('title');
  title.textContent = `k = ${k}: ${k * p.o} unknowns versus ${p.m} equations`;
  root.append(title);

  // --- top row: the k copies, each contributing o oil columns ---
  root.append(
    text(
      pad,
      rowY - 12,
      `${k} ${k === 1 ? 'copy' : 'copies'} of the map, each contributing o = ${p.o} oil unknowns`,
      'wv-label',
    ),
  );

  for (let i = 0; i < k; i++) {
    const x = pad + i * p.o * scale;
    const w = p.o * scale;
    const block = svg('rect', {
      x: x + 1,
      y: rowY,
      width: Math.max(2, w - 2),
      height: rowH,
      rx: 4,
    });
    block.classList.add('wv-copy');
    root.append(block);
    if (w > 34) {
      root.append(text(x + w / 2, rowY + rowH / 2 + 5, `x${subscript(i + 1)}`, 'wv-copy-label', 'middle'));
    }
  }

  // --- bottom row: the assembled system against the m threshold ---
  const assembledW = Math.max(2, k * p.o * scale);
  const thresholdX = pad + p.m * scale;

  root.append(text(pad, barY - 12, `assembled system: ${k}·${p.o} = ${k * p.o} columns wide, ${p.m} rows tall`, 'wv-label'));

  const assembled = svg('rect', { x: pad, y: barY, width: assembledW, height: barH, rx: 4 });
  assembled.classList.add('wv-assembled', hasRoom ? 'is-ok' : 'is-bad');
  root.append(assembled);

  // The threshold: the width the system must exceed to have solutions.
  const line = svg('line', { x1: thresholdX, y1: barY - 22, x2: thresholdX, y2: barY + barH + 14 });
  line.classList.add('wv-threshold');
  root.append(line);
  root.append(text(thresholdX + 6, barY + barH + 26, `m = ${p.m} equations`, 'wv-threshold-label'));
  root.append(
    text(
      pad,
      height - 6,
      'Each copy also gets its own power of z when the copies are stirred together — step 3 shows which.',
      'wv-threshold-label',
    ),
  );

  // Slack / shortfall bracket between the two.
  const slackStart = Math.min(pad + assembledW, thresholdX);
  const slackEnd = Math.max(pad + assembledW, thresholdX);
  if (slackEnd - slackStart > 4) {
    const brace = svg('rect', {
      x: slackStart,
      y: barY + barH + 2,
      width: slackEnd - slackStart,
      height: 6,
      rx: 3,
    });
    brace.classList.add(hasRoom ? 'wv-slack' : 'wv-short');
    root.append(brace);
  }

  return root;
}

function text(x: number, y: number, content: string, cls: string, anchor = 'start'): SVGTextElement {
  const node = svg('text', { x, y, 'text-anchor': anchor });
  node.classList.add(cls);
  node.textContent = content;
  return node;
}
