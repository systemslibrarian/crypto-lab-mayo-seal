import { describe, expect, it } from 'vitest';
import readme from '../../README.md?raw';
import indexHtml from '../../index.html?raw';

/**
 * Standards reviewed 15 November 2026.
 *
 * Two different MAYO documents are in circulation, and this lab cited the wrong
 * one as "round 3".
 *
 *  - The round-3 specification is the one in NIST's round-3 submission package,
 *    headed "Round 3 Version". Its Table 2.1 gives MAYO1 as
 *    n = 88, m = 80, o = 8, k = 10, a 1456 B public key and a 464 B signature.
 *  - The PDF served at pqmayo.org/assets/specs/mayo.pdf carries no round label
 *    and no changelog, and its MAYO1 is n = 66, m = 64, o = 8, k = 9 with a
 *    1168 B key and a 321 B signature — the ROUND-1 table. The README had
 *    quoted those four values as "the round-3 parameter tables", which is the
 *    round-1 submission wearing a round-3 label.
 *
 * The sibling crypto-lab-multivariate records the same round-1 figures
 * (1168 B / 321 B) in src/data.test.ts, which is the independent cross-check.
 *
 * These assertions pin the document identification, because the parameter
 * labels this lab runs (round-3, asserted in params.ts and mayo.test.ts) are
 * only defensible if the round they are NOT is named correctly.
 */
describe('the round-3 MAYO specification is identified correctly', () => {
  it('names the round-3 MAYO1 parameters from the submission package', () => {
    expect(readme).toMatch(/\| MAYO1 \| 88 \| 80 \| 8 \| 10 \| 1456 \| 464 \|/);
    expect(readme).toMatch(/1456-byte public key/);
    expect(readme).toMatch(/464-byte signature/);
  });

  it('cites the submission-package PDF, not the unlabelled pqmayo.org one, for round 3', () => {
    expect(readme).toContain(
      'https://csrc.nist.gov/csrc/media/Projects/pqc-dig-sig/documents/mayo_specification.pdf',
    );
    expect(readme).toMatch(/Round 3 Version/);
  });

  it('does not present the round-1 parameters as the round-3 tables', () => {
    // The round-1 values may appear, but only labelled as round 1.
    const roundOne = /n = 66, m = 64, o = 8, k = 9/;
    expect(readme).toMatch(roundOne);
    expect(readme).toMatch(/is the round-1 table/);
    expect(readme).not.toMatch(/now carries the round-3 parameter tables/);
  });

  it('keeps the round-3 label on the parameters this lab actually implements', () => {
    expect(readme).toMatch(/This lab implements the round-3 sets/);
  });
});

/**
 * NIST IR 8610 (May 2026) closed the second round on 14 May 2026 and selected
 * nine candidates for the third round: FAEST, HAWK, MAYO, MQOM, QR-UOV, SDitH,
 * SNOVA, SQIsign and UOV. "On-ramp candidate" alone no longer dates itself.
 */
describe('status lines name the round MAYO reached', () => {
  it('Real-World Usage gives the advancement date and the rationale source', () => {
    expect(readme).toMatch(/advanced to round 3[\s\S]{0,120}14 May 2026/);
    expect(readme).toMatch(/NIST IR 8610/);
  });

  it('the "under evaluation" caveat carries the round and its date', () => {
    expect(readme).toMatch(
      /on-ramp candidate still under evaluation[\s\S]{0,80}round 3 on 14 May 2026/,
    );
  });

  it('the out-of-scope card says QR-UOV and SNOVA also reached round 3', () => {
    expect(indexHtml).toMatch(/QR-UOV and SNOVA[\s\S]{0,200}advanced\s+to round 3/);
    expect(indexHtml).toMatch(/QR-UOV and SNOVA[\s\S]{0,260}14 May 2026 \(NIST IR 8610\)/);
  });
});
