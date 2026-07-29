/**
 * Exhibit 5 — replay a reference known-answer vector in the browser.
 *
 * The KAT harness in the MAYO submission seeds NIST's AES-256-CTR-DRBG with the
 * 48-byte `seed` from the .rsp file, then draws seedsk for keygen and R for
 * signing, in that order. We do exactly that and compare our bytes to theirs.
 */
import { bytesToHex, concatBytes, hexToBytes } from '../mayo/encode';
import { MAYO1, MAYO2, MAYO3, MAYO5, sizes, type MayoParams } from '../mayo/params';
import { compactKeyGen, expandPK, expandSK, sign, verify } from '../mayo/mayo';
import { NistCtrDrbg } from '../mayo/nist-drbg';
import katVectors from '../mayo/kat-vectors.json';
import { byId, clear, el, formatMs, hex, statList, verdict } from './dom';

type KatKey = keyof typeof katVectors;

const PARAMS: Record<KatKey, MayoParams> = {
  MAYO_1: MAYO1,
  MAYO_2: MAYO2,
  MAYO_3: MAYO3,
  MAYO_5: MAYO5,
};

export function initKat(): void {
  const select = byId<HTMLSelectElement>('kat-select');
  const out = byId('kat-out');

  for (const key of Object.keys(katVectors) as KatKey[]) {
    for (const vector of katVectors[key]) {
      select.append(
        el('option', {
          value: `${key}:${vector.count}`,
          text: `${PARAMS[key].name} — KAT count ${vector.count}, ${vector.mlen}-byte message (level ${PARAMS[key].securityLevel})`,
        }),
      );
    }
  }

  byId('kat-run').addEventListener('click', () => {
    const [key, count] = select.value.split(':') as [KatKey, string];
    clear(out);
    out.append(verdict('idle', 'Replaying…', 'Deriving the keypair and signature from the reference seed.'));
    // Yield once so the status above paints before the level-5 sets do their work.
    window.setTimeout(() => runVector(out, key, Number(count)), 0);
  });
}

function runVector(out: HTMLElement, key: KatKey, count: number): void {
  const p = PARAMS[key];
  const sz = sizes(p);
  const vector = katVectors[key].find((v) => v.count === count);
  if (!vector) return;

  const drbg = new NistCtrDrbg(hexToBytes(vector.seed));
  const seedSk = drbg.randomBytes(sz.skSeedBytes);

  const keygenStart = performance.now();
  const keys = compactKeyGen(p, seedSk);
  const keygenMs = performance.now() - keygenStart;

  const r = drbg.randomBytes(sz.rBytes);
  const message = hexToBytes(vector.msg);
  const sk = expandSK(p, keys.csk);

  const signStart = performance.now();
  const { sig } = sign(p, sk.esk, message, { r });
  const signMs = performance.now() - signStart;

  const verifyStart = performance.now();
  const result = verify(p, expandPK(p, keys.cpk), message, sig);
  const verifyMs = performance.now() - verifyStart;

  const sm = concatBytes(sig, message);
  const checks = [
    { label: 'secret key (seedsk) from the DRBG', ours: bytesToHex(seedSk), theirs: vector.sk.toLowerCase() },
    { label: 'public key', ours: bytesToHex(keys.cpk), theirs: vector.pk.toLowerCase() },
    { label: 'signed message (signature ‖ message)', ours: bytesToHex(sm), theirs: vector.sm.toLowerCase() },
  ];
  const allMatch = checks.every((c) => c.ours === c.theirs) && result.ok;

  clear(out);
  out.append(
    verdict(
      allMatch ? 'ok' : 'bad',
      allMatch
        ? `${p.name} KAT count ${count} reproduced byte for byte`
        : `${p.name} KAT count ${count} did NOT match the reference`,
      allMatch
        ? 'Keygen, signing and verification all agree with the reference implementation’s output for this vector.'
        : 'One of the three comparisons below differs. That is a bug in this page, not in the reference.',
    ),
    statList([
      { label: 'keygen', value: formatMs(keygenMs) },
      { label: 'sign', value: formatMs(signMs) },
      { label: 'verify', value: formatMs(verifyMs) },
      { label: 'public key', value: `${keys.cpk.length} B` },
      { label: 'signature', value: `${sig.length} B` },
      { label: 'verifier says', value: result.ok ? 'valid' : 'invalid' },
    ]),
  );

  const list = el('div', { class: 'grid grid--3' });
  for (const check of checks) {
    const same = check.ours === check.theirs;
    const card = el('div', { class: 'card' }, [
      el('h3', { text: check.label }),
      el('p', { text: same ? `✓ identical — all ${check.ours.length / 2} bytes` : '✗ different' }),
      el('p', { class: 'field-label', text: 'ours' }),
      el('pre', { class: 'hexblock', text: hex(hexToBytes(check.ours), 24) }),
      el('p', { class: 'field-label', text: 'reference' }),
      el('pre', { class: 'hexblock', text: hex(hexToBytes(check.theirs), 24) }),
    ]);
    if (!same) {
      const offset = firstDifference(check.ours, check.theirs);
      card.append(
        el('p', {
          class: 'note',
          text:
            offset === null
              ? 'The two differ in length.'
              : `First difference at byte ${offset}: ours ${check.ours.slice(offset * 2, offset * 2 + 2)}, reference ${check.theirs.slice(offset * 2, offset * 2 + 2)}.`,
        }),
      );
    }
    list.append(card);
  }
  out.append(list);
  out.append(
    el('p', {
      class: 'note',
      text: `Vectors come from KAT/PQCsignKAT_${sz.skSeedBytes}_${key}.rsp in the MAYO round-2 submission. Only the first one or two counts are bundled here; the full files hold 100 each.`,
    }),
  );
}

/** Byte offset of the first difference between two hex strings, or null. */
function firstDifference(a: string, b: string): number | null {
  if (a.length !== b.length) return null;
  for (let i = 0; i < a.length; i += 2) {
    if (a.slice(i, i + 2) !== b.slice(i, i + 2)) return i / 2;
  }
  return null;
}
