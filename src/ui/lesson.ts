/**
 * The shared lesson state: one parameter set and one message, chosen once and
 * followed through the exhibits.
 *
 * Before this, every panel made its own key, its own message and its own
 * signature. That is convenient to implement and it quietly costs the page its
 * story — a reader who signs in Exhibit 2 and verifies in Exhibit 3 has no reason
 * to believe those are the same bytes, because they were not.
 *
 * The mechanism is deliberately dumb: this module does not own the exhibits, it
 * drives their existing controls. Changing the lesson sets each panel's own
 * select or input and dispatches the event that panel already listens for, so
 * every exhibit reacts exactly as if the reader had changed it by hand. Nothing
 * in keygen, verify or forge had to learn about lessons, and there is no second
 * code path to keep in step with the first.
 *
 * Explore mode is the escape hatch chat.md asks for: the per-exhibit controls
 * come back and this panel stops driving them. The guided journey is a default,
 * not a cage.
 */
import { byId, el, verdict } from './dom';

/** Only the sets every exhibit on the journey can run. */
export type LessonParam = 'TOY' | 'MAYO1' | 'MAYO2';
export type LessonMode = 'guided' | 'explore';
export type Stage = 'problem' | 'whip' | 'solve' | 'verify' | 'break';

const STAGES: Array<{ id: Stage; label: string; hint: string }> = [
  { id: 'problem', label: 'Problem', hint: 'one copy is short of unknowns' },
  { id: 'whip', label: 'Whip', hint: 'k copies widen the system' },
  { id: 'solve', label: 'Solve', hint: 'elimination lands on t' },
  { id: 'verify', label: 'Verify', hint: 'the real verifier accepts it' },
  { id: 'break', label: 'Break', hint: 'tamper and watch it refuse' },
];

/** Every exhibit control the lesson drives, and the event it must announce with. */
const PARAM_TARGETS = ['kg-params', 'whip-params', 'vf-params', 'fg-params'];
const MESSAGE_TARGETS = ['whip-msg', 'vf-msg', 'fg-msg'];

let mode: LessonMode = 'guided';
const reached = new Set<Stage>();

/**
 * Marks a stage of the journey complete. Called from the exhibits as their real
 * computations finish, so the indicator can never run ahead of the evidence.
 */
export function markStage(stage: Stage): void {
  if (reached.has(stage)) return;
  reached.add(stage);
  drawStages();
}

function field(id: string): HTMLElement | null {
  return byId(id).closest('.field');
}

/** Point a panel's own control at the lesson's choice and let it react. */
function push(id: string, value: string, event: 'change' | 'input'): void {
  const control = byId<HTMLSelectElement | HTMLInputElement>(id);
  if (control.value === value) return;
  control.value = value;
  control.dispatchEvent(new Event(event, { bubbles: true }));
}

function drawStages(): void {
  const list = byId('lsn-stages');
  list.replaceChildren();
  for (const stage of STAGES) {
    const done = reached.has(stage.id);
    list.append(
      el('li', { class: 'journey__stage', 'data-state': done ? 'done' : 'idle' }, [
        el('span', { class: 'journey__tick', 'aria-hidden': 'true', text: done ? '✓' : '·' }),
        el('span', { class: 'journey__label', text: stage.label }),
        el('span', { class: 'journey__hint', text: stage.hint }),
        // The state is in text, not only in the tick and the tint.
        el('span', { class: 'sr-only', text: done ? ' — done' : ' — not yet' }),
      ]),
    );
  }
}

export function initLesson(): void {
  const params = byId<HTMLSelectElement>('lsn-params');
  const message = byId<HTMLInputElement>('lsn-msg');
  const modeBtn = byId<HTMLButtonElement>('lsn-mode');
  const note = byId('lsn-mode-note');
  const controls = byId('lsn-controls');

  const sync = (): void => {
    if (mode !== 'guided') return;
    for (const id of PARAM_TARGETS) push(id, params.value, 'change');
    for (const id of MESSAGE_TARGETS) push(id, message.value, 'input');
  };

  const applyMode = (): void => {
    const guided = mode === 'guided';
    controls.hidden = !guided;
    // In guided mode the panels take their inputs from here, so their own copies
    // of those inputs would be two controls claiming one value.
    for (const id of [...PARAM_TARGETS, ...MESSAGE_TARGETS]) {
      const wrapper = field(id);
      if (wrapper) wrapper.hidden = guided;
    }
    modeBtn.textContent = guided ? 'Explore independently' : 'Back to the guided journey';
    modeBtn.setAttribute('aria-pressed', String(!guided));
    note.textContent = guided
      ? 'Every exhibit below is running this parameter set and this message. Switch to explore mode to give each panel its own controls back.'
      : 'Each exhibit has its own parameter set and message again. The journey above still tracks what you have reached.';
    if (guided) sync();
  };

  params.addEventListener('change', sync);
  message.addEventListener('input', sync);
  modeBtn.addEventListener('click', () => {
    mode = mode === 'guided' ? 'explore' : 'guided';
    applyMode();
  });

  byId('lsn-reset').addEventListener('click', () => {
    reached.clear();
    drawStages();
    byId('lsn-out').replaceChildren(
      verdict('idle', 'Journey reset', 'The exhibits keep whatever they last computed; only the progress marks are cleared.'),
    );
  });

  drawStages();
  applyMode();
}
