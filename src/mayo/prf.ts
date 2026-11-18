/**
 * The two symmetric primitives MAYO needs (spec §2.1.3):
 *   - SHAKE256 for hashing and secret expansion,
 *   - AES-128-CTR for expanding the public seed into P(1), P(2).
 *
 * Both come from @noble (dependency-free, synchronous). Pinned ^2.4.0, which is
 * later than either library's audit — @noble/hashes records "at version 1.0.0,
 * in Jan 2022, independently, by [Cure53]" and @noble/ciphers "at version 1.0.0,
 * in Sep 2024, independently, by [cure53]". The reference vectors below are what
 * this lab actually checks. WebCrypto is
 * not usable here: keygen needs AES output *synchronously*, and WebCrypto has
 * no SHAKE at all. The multivariate math — the part this demo teaches — is
 * hand-rolled; these two are standard building blocks, so a library is right.
 */
import { shake256 as nobleShake256 } from '@noble/hashes/sha3.js';
import { ctr, ecb } from '@noble/ciphers/aes.js';

export function shake256(input: Uint8Array, outLen: number): Uint8Array {
  return nobleShake256(input, { dkLen: outLen });
}

/**
 * AES-128-CTR(seed, l): the concatenated AES-128 encryptions of the 16-byte
 * counter blocks 0, 1, 2, … under `seed`. Encrypting zeros in CTR mode with an
 * all-zero initial counter yields exactly that keystream.
 */
export function aes128ctr(seed: Uint8Array, outLen: number): Uint8Array {
  if (seed.length !== 16) throw new Error('aes128ctr: seed must be 16 bytes');
  const blocks = Math.ceil(outLen / 16) * 16;
  const stream = ctr(seed, new Uint8Array(16)).encrypt(new Uint8Array(blocks));
  return stream.subarray(0, outLen);
}

// Round-3 Lambda expansion uses AES on IV XOR a big-endian block index.
export function lambdaStream(key: Uint8Array, iv: Uint8Array, length: number): Uint8Array {
  const blocks = new Uint8Array(Math.ceil(length / 16) * 16);
  for (let offset = 0; offset < blocks.length; offset += 16) {
    blocks.set(iv, offset);
    const index = offset / 16;
    for (let byte = 0; byte < 4; byte++) {
      blocks[offset + 15 - byte] ^= (index >>> (8 * byte)) & 255;
    }
  }
  return ecb(key, { disablePadding: true }).encrypt(blocks).subarray(0, length);
}
