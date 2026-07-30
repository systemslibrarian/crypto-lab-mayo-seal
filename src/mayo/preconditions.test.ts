import { describe, expect, it } from 'vitest';
import { MAYO1, MAYO2, MAYO3, MAYO5, sizes, TOY, type MayoParams } from './params';
import { checkPreconditions } from './preconditions';

function seedFor(p: MayoParams): Uint8Array {
  return Uint8Array.from({ length: sizes(p).skSeedBytes }, (_, i) => (i * 7 + 13) & 0xff);
}

describe('structural preconditions', () => {
  it.each([TOY, MAYO1, MAYO2, MAYO3, MAYO5])('$name: every precondition holds', (p) => {
    const results = checkPreconditions(p, seedFor(p));
    expect(results.length).toBe(7);
    for (const result of results) {
      expect(result.holds, `${p.name}: ${result.claim} — ${result.evidence}`).toBe(true);
      expect(result.evidence).not.toBe('');
      expect(result.matters).not.toBe('');
    }
  });

  it('reports the toy set as untabulated rather than claiming a match', () => {
    const sizesCheck = checkPreconditions(TOY, seedFor(TOY)).find((r) => r.id === 'sizes')!;
    expect(sizesCheck.evidence).toMatch(/not in the table/);
  });

  it('quotes the real table figures for a shipped set', () => {
    const sizesCheck = checkPreconditions(MAYO1, seedFor(MAYO1)).find((r) => r.id === 'sizes')!;
    expect(sizesCheck.evidence).toContain('1420 B');
    expect(sizesCheck.evidence).toContain('454 B');
  });
});
