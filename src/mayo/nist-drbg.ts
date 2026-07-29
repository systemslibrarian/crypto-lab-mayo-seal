/**
 * The NIST AES-256-CTR-DRBG that the PQC KAT harness uses as `randombytes`.
 *
 * This is *not* part of MAYO and is not used by the page — it exists only so the
 * test suite can replay the reference KAT files exactly: the harness seeds this
 * DRBG from the 48-byte `seed` in the .rsp file, then MAYO's keypair() draws
 * seedsk from it and sign() draws the randomizer R from it.
 */
import { ecb } from '@noble/ciphers/aes';

export class NistCtrDrbg {
  private key = new Uint8Array(32);
  private v = new Uint8Array(16);

  constructor(entropy48: Uint8Array) {
    if (entropy48.length !== 48) throw new Error('NistCtrDrbg: seed must be 48 bytes');
    this.update(entropy48);
  }

  private aes256(block: Uint8Array): Uint8Array {
    return ecb(this.key, { disablePadding: true }).encrypt(block);
  }

  private incV(): void {
    for (let j = 15; j >= 0; j--) {
      if (this.v[j] === 0xff) this.v[j] = 0x00;
      else {
        this.v[j]++;
        break;
      }
    }
  }

  private update(providedData: Uint8Array | null): void {
    const temp = new Uint8Array(48);
    for (let i = 0; i < 3; i++) {
      this.incV();
      temp.set(this.aes256(this.v), 16 * i);
    }
    if (providedData) {
      for (let i = 0; i < 48; i++) temp[i] ^= providedData[i];
    }
    this.key = temp.slice(0, 32);
    this.v = temp.slice(32, 48);
  }

  randomBytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let i = 0;
    let remaining = n;
    while (remaining > 0) {
      this.incV();
      const block = this.aes256(this.v);
      const take = Math.min(16, remaining);
      out.set(block.subarray(0, take), i);
      i += take;
      remaining -= take;
    }
    this.update(null);
    return out;
  }
}
