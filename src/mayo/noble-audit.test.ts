/* What "audited" covers for the Noble packages this lab ships.
 *
 * The README described SHAKE256 and AES-128-CTR as coming "from @noble
 * (audited, synchronous ...)" and src/mayo/prf.ts said "Both come from @noble
 * (audited, dependency-free, synchronous)" — neither with a version. The two
 * libraries record different audits, both behind the pins here (^2.4.0 each):
 *
 *   @noble/hashes  — "at version 1.0.0, in Jan 2022, independently, by [Cure53]"
 *   @noble/ciphers — "at version 1.0.0, in Sep 2024, independently, by [cure53]"
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const flat = (text: string) => text.replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ');

const pkg = JSON.parse(read('../../package.json'));
const hashesReadme = read('../../node_modules/@noble/hashes/README.md');
const ciphersReadme = read('../../node_modules/@noble/ciphers/README.md');

describe('the Noble audit claims', () => {
  it('pins versions later than either library has audited', () => {
    expect(pkg.dependencies['@noble/hashes']).toBe('^2.4.0');
    expect(pkg.dependencies['@noble/ciphers']).toBe('^2.4.0');
    expect(hashesReadme).toMatch(/at version 1\.0\.0, in Jan 2022, independently, by \[Cure53\]/);
    expect(ciphersReadme).toMatch(/at version 1\.0\.0, in Sep 2024, independently, by \[cure53\]/);
    for (const readme of [hashesReadme, ciphersReadme]) {
      expect(readme).not.toMatch(/at version 2\.\d+\.\d+, in [A-Z]/);
    }
  });

  it('names the audited versions wherever the libraries are described', () => {
    for (const [name, text] of [
      ['README.md', flat(read('../../README.md'))],
      ['src/mayo/prf.ts', flat(read('./prf.ts'))],
    ] as const) {
      expect(text, name).not.toContain('(audited, synchronous');
      expect(text, name).not.toContain('(audited, dependency-free, synchronous)');
      expect(text, name).toContain('at version 1.0.0, in Jan 2022, independently, by [Cure53]');
      expect(text, name).toContain('at version 1.0.0, in Sep 2024, independently, by [cure53]');
    }
  });
});
