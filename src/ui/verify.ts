/**
 * Exhibit 3 — verification, computed on both sides, plus three ways to break it.
 *
 * Every "reject" on this page comes from the real MAYO.Verify: the page never
 * decides an answer itself, it only displays the two vectors and their diff.
 */
import { PARAM_SETS, sizes, type MayoParams, type ParamSetName } from '../mayo/params';
import { keypair, sign, verify, type ExpandedPublicKey, type ExpandedSecretKey } from '../mayo/mayo';
import { byId, clear, compareLegend, el, formatMs, hex, statList, vectorList, verdict } from './dom';
import { markStage } from './lesson';
import { walkthroughArtifact } from './whip';

interface State {
  p: MayoParams;
  /** Null for a signature adopted from Exhibit 2 — verification needs no secret. */
  sk: ExpandedSecretKey | null;
  pk: ExpandedPublicKey;
  /** The message the signature was made over. */
  signedMessage: string;
  /** The message the verifier is given — the two can be made to differ. */
  claimedMessage: string;
  sig: Uint8Array;
  changes: string[];
}

let state: State | null = null;

export function initVerify(): void {
  const select = byId<HTMLSelectElement>('vf-params');
  const msgInput = byId<HTMLInputElement>('vf-msg');
  const out = byId('vf-out');

  const requireState = (): State | null => {
    if (!state) {
      clear(out);
      out.append(verdict('idle', 'Nothing signed yet', 'Press "Sign this message" first.'));
      return null;
    }
    return state;
  };

  const doSign = (): void => {
    const p = PARAM_SETS[select.value as ParamSetName];
    const seed = crypto.getRandomValues(new Uint8Array(sizes(p).skSeedBytes));
    const { sk, pk } = keypair(p, seed);
    const message = msgInput.value;
    const started = performance.now();
    const { sig } = sign(p, sk.esk, new TextEncoder().encode(message));
    const signMs = performance.now() - started;
    state = { p, sk, pk, signedMessage: message, claimedMessage: message, sig, changes: [] };
    clear(out);
    out.append(
      verdict('ok', `Signed with a fresh ${p.name} key in ${formatMs(signMs)}`, `${sig.length}-byte signature. Now verify it, or break it.`),
      renderStats(state),
      el('p', { class: 'field-label', text: 'Signature (s ‖ salt)' }),
      el('pre', { class: 'hexblock', text: hex(sig, 64) }),
    );
  };

  const doVerify = (): void => {
    const s = requireState();
    if (!s) return;
    const started = performance.now();
    const result = verify(s.p, s.pk, new TextEncoder().encode(s.claimedMessage), s.sig);
    const verifyMs = performance.now() - started;

    // Both journey stages are recorded from the real verifier's answer: accepting
    // an untampered signature is "verify", and a rejection that follows an edit
    // the reader made is "break". A rejection with no edits behind it is neither.
    if (result.ok) markStage('verify');
    else if (s.changes.length > 0) markStage('break');

    clear(out);
    const mismatches = countMismatches(result.y, result.t);
    out.append(
      verdict(
        result.ok ? 'ok' : 'bad',
        result.ok
          ? 'VALID — P*(s) = t'
          : result.nonCanonical
            ? 'REJECTED — the signature is not a canonical encoding'
            : `REJECTED — P*(s) ≠ t, first difference at coordinate ${result.firstMismatch}`,
        result.ok
          ? `All ${s.p.m} coordinates agree. Checked in ${formatMs(verifyMs)}.`
          : result.nonCanonical
            ? `${s.p.n}·${s.p.k} = ${s.p.n * s.p.k} field elements is an odd count, so the last nibble of s is padding and must be zero. This one is not. Without that check it would decode to the same s as the untouched signature and verify — two different byte strings for one signature.`
            : `${mismatches} of ${s.p.m} coordinates differ. Checked in ${formatMs(verifyMs)}.`,
      ),
      renderStats(s),
    );

    if (s.changes.length > 0) {
      const list = el('ul', { role: 'list' });
      for (const change of s.changes) list.append(el('li', { role: 'listitem', text: change }));
      out.append(el('div', { class: 'card' }, [el('h3', { text: 'What you changed' }), list]));
    }

    const limit = s.p.m > 80 ? 80 : s.p.m;
    out.append(
      el('p', { class: 'field-label', text: 'P*(s) — computed from the signature and the public key' }),
      vectorList(result.y, {
        ariaLabel: 'the whipped map evaluated on the signature',
        maxItems: limit,
        cell: (i, value) => (value === result.t[i] ? 'is-ok' : 'is-bad'),
      }),
      el('p', { class: 'field-label', text: 't — computed from the message and the salt' }),
      vectorList(result.t, { ariaLabel: 'target vector t', maxItems: limit }),
      compareLegend(),
      el('p', {
        class: 'note',
        text: result.ok
          ? 'Both sides are shown so nothing has to be taken on trust: these are the two vectors MAYO.Verify compares.'
          : 'A single changed nibble anywhere in s, in the salt, or in the message moves the whole target. There is no partial credit.',
      }),
    );
  };

  const tamper = (label: string, mutate: (s: State) => void): void => {
    const s = requireState();
    if (!s) return;
    mutate(s);
    s.changes.push(label);
    doVerify();
  };

  select.addEventListener('change', () => {
    state = null;
    clear(out);
    out.append(
      verdict('idle', `${select.value} selected`, 'Press "Sign this message" to make a signature under this parameter set.'),
    );
  });
  msgInput.addEventListener('input', () => {
    if (state) state.claimedMessage = msgInput.value;
  });

  byId('vf-sign').addEventListener('click', doSign);
  byId('vf-verify').addEventListener('click', doVerify);

  // Continuity: rather than making yet another key, adopt the artifact Exhibit 2
  // just built, so "is this the same signature I watched being made?" has an
  // answer.
  byId('vf-adopt').addEventListener('click', () => {
    const artifact = walkthroughArtifact();
    if (!artifact) {
      clear(out);
      out.append(
        verdict(
          'idle',
          'Exhibit 2 has not produced a signature yet',
          'Run the walkthrough above — even one step forward is enough — and then come back.',
        ),
      );
      return;
    }
    select.value = artifact.p.name;
    msgInput.value = artifact.message;
    state = {
      p: artifact.p,
      // Verification never needs the secret key; this panel only holds one so it
      // can sign again on demand.
      sk: null,
      pk: artifact.pk,
      signedMessage: artifact.message,
      claimedMessage: artifact.message,
      sig: artifact.sig.slice(),
      changes: [],
    };
    clear(out);
    out.append(
      verdict(
        'idle',
        `Adopted the ${artifact.p.name} signature from Exhibit 2`,
        'Same key, same message, same bytes you watched being assembled. Verify it, then break it.',
      ),
      renderStats(state),
      el('p', { class: 'field-label', text: 'Signature (s ‖ salt)' }),
      el('pre', { class: 'hexblock', text: hex(state.sig, 64) }),
    );
  });

  byId('vf-tamper-sig').addEventListener('click', () =>
    tamper('Flipped one nibble inside s.', (s) => {
      const sBytes = Math.ceil((s.p.n * s.p.k) / 2);
      const idx = Math.floor(Math.random() * sBytes);
      s.sig[idx] ^= 0x01;
    }),
  );

  byId('vf-tamper-salt').addEventListener('click', () =>
    tamper('Flipped one bit of the salt.', (s) => {
      const sBytes = Math.ceil((s.p.n * s.p.k) / 2);
      s.sig[sBytes] ^= 0x80;
    }),
  );

  byId('vf-tamper-msg').addEventListener('click', () =>
    tamper('Changed the message the verifier is given, keeping the old signature.', (s) => {
      s.claimedMessage = `${s.claimedMessage} (edited)`;
      msgInput.value = s.claimedMessage;
    }),
  );
}

function renderStats(s: State): HTMLElement {
  return statList([
    { label: 'parameter set', value: s.p.name },
    { label: 'signature', value: `${s.sig.length} B` },
    { label: 'coordinates', value: `m = ${s.p.m}` },
    { label: 'signed over', value: truncate(s.signedMessage) },
    { label: 'verifying against', value: truncate(s.claimedMessage) },
  ]);
}

function truncate(text: string): string {
  return text.length > 22 ? `${text.slice(0, 21)}…` : text || '(empty)';
}

function countMismatches(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}
