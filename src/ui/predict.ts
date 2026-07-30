/**
 * Prediction checks: three places where the page asks the reader to commit to an
 * answer before it shows one.
 *
 * The demo was very good at demonstrating and almost never asked the reader to
 * be wrong first. That is the gap this closes. A reader who has predicted "the
 * equations grow too" and been corrected remembers that m stays put; a reader who
 * only watched a correct animation of it usually does not.
 *
 * Every wrong option gets a real explanation rather than a buzz, because the
 * wrong answers here are the actual misconceptions — that the threshold is a
 * theorem, that whipping adds equations, that the salt moves both sides. Saying
 * why each one is wrong is the whole point of asking.
 *
 * Options are buttons rather than radios on purpose. A radio group is one Tab
 * stop with arrow keys inside it, which is correct native behaviour but means
 * only one option is reachable by Tab alone; the page's keyboard gate walks the
 * whole document with Tab and would rightly count the others as unreachable.
 * Buttons keep every option a first-class stop, and aria-pressed carries which
 * one is chosen. They stay enabled after answering so a reader can read the
 * reasoning behind the options they did not pick.
 */
import { byId, clear, el, verdict } from './dom';

interface PredictOption {
  text: string;
  correct: boolean;
  /** Shown whether or not this option was the right one. */
  why: string;
}

interface Prediction {
  /** Id of the empty mount point in index.html. */
  mount: string;
  question: string;
  options: PredictOption[];
}

const PREDICTIONS: Prediction[] = [
  {
    mount: 'pr-threshold',
    question:
      'At k = 1 a MAYO1 signer has 8 oil unknowns for 78 equations. Can it hit a random target t?',
    options: [
      {
        text: 'No — it is mathematically impossible.',
        correct: false,
        why:
          'Improbable, not impossible. Eight unknowns still reach a 16⁸ slice of the 16⁷⁸ possible targets, so a random t lands inside it about once in 16⁷⁰ draws. The threshold below is a parameter-design condition, not a theorem — which is why the figure says "usually out of reach" rather than "cannot".',
      },
      {
        text: 'Almost never — roughly once in 16⁷⁰ draws.',
        correct: true,
        why:
          'Right, and the "almost" is load-bearing. k·o > m is chosen to make a good draw overwhelmingly likely, not to make a bad one impossible. Turn the slider to k = 1 and the figure reports this same number.',
      },
      {
        text: 'Yes — the secret trapdoor reaches any target.',
        correct: false,
        why:
          'The trapdoor makes the system linear, which is what lets the signer solve by elimination at all. It does not manufacture unknowns. With 8 of them against 78 equations there is simply not enough freedom, trapdoor or no trapdoor.',
      },
    ],
  },
  {
    mount: 'pr-whip',
    question: 'Whipping k copies together changes which side of the equations-versus-unknowns count?',
    options: [
      {
        text: 'The equations — m grows with k.',
        correct: false,
        why:
          'm does not move. All k copies are stirred into one system that is still checked against the same m coordinates of the target t. Watch the row count in step 3: it is the same before and after whipping.',
      },
      {
        text: 'The unknowns — o becomes k·o.',
        correct: true,
        why:
          'That is the entire move. The system stays m rows tall and becomes k·o columns wide, and every copy keeps the same hidden oil space so the trapdoor survives the widening.',
      },
      {
        text: 'Both — the system grows in each direction.',
        correct: false,
        why:
          'Only the width. If each copy brought its own equations along with its own unknowns, whipping could never catch up — the signer would be running to stay in the same place.',
      },
    ],
  },
  {
    mount: 'pr-salt',
    question:
      'Verification recomputes t from the message and salt, then evaluates the public map on s. Flip one bit of the salt: which side moves?',
    options: [
      {
        text: 'The target t.',
        correct: true,
        why:
          'The salt is hashed together with the message digest to produce t, so t lands somewhere else entirely. The signature s is untouched, so P*(s) stays exactly where it was — and the two sides no longer meet.',
      },
      {
        text: 'The public map P*(s).',
        correct: false,
        why:
          'P*(s) is computed from the signature and the public key. The salt appears in neither, so this side does not move at all. Flip the salt below and compare the two vectors: the P*(s) row is unchanged.',
      },
      {
        text: 'Both, so the comparison still matches.',
        correct: false,
        why:
          'That would make the salt free to tamper with. Only t is derived from it; the signature side is computed without it, which is exactly why the check fails.',
      },
    ],
  },
];

let seq = 0;

export function initPredictions(): void {
  for (const p of PREDICTIONS) render(p);
}

function render(p: Prediction): void {
  const mount = byId(p.mount);
  const qId = `predict-q-${++seq}`;
  const out = el('div', { class: 'predict__out', role: 'status', 'aria-live': 'polite' });

  const buttons = p.options.map((opt, i) =>
    el('button', {
      class: 'predict__opt',
      type: 'button',
      id: `${p.mount}-${i}`,
      'aria-pressed': 'false',
    }, [document.createTextNode(opt.text)]),
  );

  buttons.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      const opt = p.options[i];
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === btn));
      clear(out);
      out.append(verdict(opt.correct ? 'ok' : 'bad', opt.correct ? 'Correct' : 'Not quite', opt.why));
    });
  });

  clear(mount);
  mount.append(
    el('p', { class: 'predict__kicker', text: 'Predict first' }),
    el('p', { class: 'predict__q', id: qId, text: p.question }),
    el('div', { class: 'predict__opts', role: 'group', 'aria-labelledby': qId }, buttons),
    out,
  );
}
