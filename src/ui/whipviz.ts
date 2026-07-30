/**
 * The whole idea in one picture.
 *
 * The signing system is m rows tall and k·o columns wide. It is solvable exactly
 * when it is *wider than it is tall* — when the k copies together supply more
 * unknowns than there are equations. So the diagram draws the system's width
 * against that threshold and lets you turn k with a slider. Nothing is stylised:
 * the widths are the real k·o and m for the selected parameter set, and the
 * verdict is the real inequality the signer faces.
 *
 * The picture is never the only channel — the same numbers are printed beside it
 * and the SVG carries a live text description.
 */
import { PARAM_SETS, type MayoParams, type ParamSetName } from '../mayo/params';
import { smallestSolvableK, whipBalance } from '../mayo/uov';
import { byId, clear, el, superscript } from './dom';

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

  const configure = (p: MayoParams): void => {
    // Show one copy short of solvable through two past the shipped choice.
    const max = Math.max(p.k + 2, 4);
    slider.min = '1';
    slider.max = String(max);
    slider.value = String(p.k);
    slider.setAttribute('aria-valuetext', `k = ${p.k}`);
  };

  const draw = (): void => {
    const p = PARAM_SETS[select.value as ParamSetName];
    const k = Number(slider.value);
    const balance = whipBalance(p.m, p.o, p.n, k, p.saltBytes);
    const smallest = smallestSolvableK(p.m, p.o);

    kValue.textContent = String(k);
    slider.setAttribute('aria-valuetext', `k = ${k}`);
    clear(figure);
    figure.append(renderFigure(p, k, balance.solvable));

    clear(readout);
    readout.append(
      el('dl', { class: 'stat-row' }, [
        stat('unknowns (k·o)', String(balance.unknowns)),
        stat('equations (m)', String(balance.equations)),
        stat(balance.slack >= 0 ? 'room to spare' : 'short by', String(Math.abs(balance.slack))),
        stat('signature', `${balance.signatureBytes} B`),
      ]),
      el('p', { class: `wv-verdict ${balance.solvable ? 'is-ok' : 'is-bad'}` }, [
        el('span', { class: 'wv-verdict__icon', 'aria-hidden': 'true', text: balance.solvable ? '✓' : '✗' }),
        document.createTextNode(
          balance.solvable
            ? `Solvable: ${balance.unknowns} unknowns against ${balance.equations} equations. The signer has ${balance.slack} coordinates of freedom, so 16${superscript(balance.slack)} signatures exist for this message.`
            : `Not solvable: ${balance.unknowns} unknowns cannot satisfy ${balance.equations} equations. A random target is out of reach — this is the wall MAYO's small oil space runs into.`,
        ),
      ]),
      el('p', {
        class: 'note',
        text:
          k === smallest
            ? `k = ${smallest} is the smallest whipping factor with k·o > m, and it is exactly the k that ${p.name} ships. Every extra copy would add n = ${p.n} more field elements to the signature for no benefit.`
            : k < smallest
              ? `${p.name} needs at least k = ${smallest} for k·o > m. Below that the signer cannot sign at all.`
              : `This works, but it is wasteful: ${p.name} ships k = ${smallest}, and each copy beyond it costs another ⌈n/2⌉ = ${Math.ceil(p.n / 2)} bytes of signature.`,
      }),
    );
  };

  select.addEventListener('change', () => {
    configure(PARAM_SETS[select.value as ParamSetName]);
    draw();
  });
  slider.addEventListener('input', draw);

  configure(PARAM_SETS[select.value as ParamSetName]);
  draw();
}

function stat(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat' }, [el('dt', { text: label }), el('dd', { text: value })]);
}

/**
 * Draws the k copies as o-wide blocks, the assembled system as one k·o-wide
 * block, and the m-tall threshold the width has to clear.
 */
function renderFigure(p: MayoParams, k: number, solvable: boolean): SVGSVGElement {
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
    'aria-label': `Diagram: ${k} whipped ${k === 1 ? 'copy' : 'copies'} of the map contribute ${k * p.o} unknown${k * p.o === 1 ? '' : 's'} in total, against ${p.m} equations. ${solvable ? 'The system is wide enough to solve.' : 'The system is too narrow to solve.'}`,
  });
  root.classList.add('wv-svg');

  const title = svg('title');
  title.textContent = `k = ${k}: ${k * p.o} unknowns versus ${p.m} equations`;
  root.append(title);

  // --- top row: the k copies, each contributing o oil columns ---
  root.append(text(pad, rowY - 12, `${k} ${k === 1 ? 'copy' : 'copies'} of the map, each contributing o = ${p.o} oil unknowns`, 'wv-label'));

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
      root.append(text(x + w / 2, rowY + rowH / 2 + 5, `z${superscript(i)}`, 'wv-copy-label', 'middle'));
    }
  }

  // --- bottom row: the assembled system against the m threshold ---
  const assembledW = Math.max(2, k * p.o * scale);
  const thresholdX = pad + p.m * scale;

  root.append(text(pad, barY - 12, `assembled system: ${k}·${p.o} = ${k * p.o} columns wide, ${p.m} rows tall`, 'wv-label'));

  const assembled = svg('rect', { x: pad, y: barY, width: assembledW, height: barH, rx: 4 });
  assembled.classList.add('wv-assembled', solvable ? 'is-ok' : 'is-bad');
  root.append(assembled);

  // The threshold: the width the system must exceed to have solutions.
  const line = svg('line', { x1: thresholdX, y1: barY - 22, x2: thresholdX, y2: barY + barH + 14 });
  line.classList.add('wv-threshold');
  root.append(line);
  root.append(text(thresholdX + 6, barY + barH + 26, `m = ${p.m} equations`, 'wv-threshold-label'));

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
    brace.classList.add(solvable ? 'wv-slack' : 'wv-short');
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
