/**
 * Exhibit 6, second panel — recompute MAYO's structural preconditions here
 * rather than asserting them. Each row states the claim, what it computed, and
 * why the scheme fails without it.
 */
import { PARAM_SETS, sizes, type ParamSetName } from '../mayo/params';
import { checkPreconditions, type Precondition } from '../mayo/preconditions';
import { byId, clear, el, formatMs, verdict } from './dom';

export function initPreconditions(): void {
  const select = byId<HTMLSelectElement>('pc-params');
  const out = byId('pc-out');

  byId('pc-run').addEventListener('click', () => {
    const p = PARAM_SETS[select.value as ParamSetName];
    clear(out);
    out.append(
      verdict(
        'idle',
        `Checking ${p.name}…`,
        'Testing irreducibility, the determinant condition, E-matrix ranks and both vanishing properties.',
      ),
    );
    // Yield so the status paints before the level-5 checks run.
    window.setTimeout(() => {
      const seed = crypto.getRandomValues(new Uint8Array(sizes(p).skSeedBytes));
      const results = checkPreconditions(p, seed);
      clear(out);
      out.append(render(p.name, results));
    }, 0);
  });
}

function render(name: string, results: Precondition[]): HTMLElement {
  const failures = results.filter((r) => !r.holds);
  const total = results.reduce((acc, r) => acc + r.ms, 0);

  const list = el('ul', { class: 'checks', role: 'list' });
  for (const result of results) {
    list.append(
      el('li', { role: 'listitem', class: 'check' }, [
        el('span', { class: 'check__icon', 'aria-hidden': 'true', text: result.holds ? '✓' : '✗' }),
        el('div', {}, [
          el('strong', { text: `${result.claim} — ${result.holds ? 'holds' : 'FAILS'} (${formatMs(result.ms)})` }),
          el('p', { text: result.evidence }),
          el('p', { class: 'check__why', text: result.matters }),
        ]),
      ]),
    );
  }

  return el('div', {}, [
    verdict(
      failures.length === 0 ? 'ok' : 'bad',
      failures.length === 0
        ? `All ${results.length} preconditions hold for ${name}`
        : `${failures.length} of ${results.length} preconditions FAILED for ${name}`,
      failures.length === 0
        ? `Recomputed in ${formatMs(total)} on this machine, from the same code the test suite runs.`
        : `Failing: ${failures.map((f) => f.claim).join('; ')}. That is a bug in this page.`,
    ),
    list,
  ]);
}
