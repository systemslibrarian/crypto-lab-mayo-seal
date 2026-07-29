# MAYO Seal

**MAYO · NIST PQC On-Ramp** — signs and verifies with the MAYO multivariate signature scheme, whose "whipped" Oil-and-Vinegar map keeps UOV's small signatures while shrinking its notoriously large public key.

**Live demo:** https://systemslibrarian.github.io/crypto-lab-mayo-seal/

---

## What It Is

MAYO is a multivariate quadratic signature scheme submitted to NIST's [additional signatures on-ramp](https://csrc.nist.gov/projects/pqc-dig-sig). This page implements it: the finite field GF(16), the spec's wire encodings, echelon form and `SampleSolution`, the whipping construction, and `MAYO.CompactKeyGen` / `ExpandSK` / `ExpandPK` / `Sign` / `Verify` from the round-2 specification (pqmayo.org). Keygen, signing and verification all run in the browser, for the real **MAYO1, MAYO2, MAYO3 and MAYO5** parameter sets and for a deliberately tiny toy set whose matrices fit on screen.

The problem MAYO solves: in Unbalanced Oil-and-Vinegar the signer's shortcut is a hidden linear subspace, the *oil space* **O**, on which every public equation vanishes. Signing means fixing the *vinegar* coordinates at random and then solving for the oil coordinates — a linear system of **m** equations in **o** unknowns. That only works when `o ≥ m`, and the public key grows with `o²`, so classic UOV pays for its trapdoor in kilobytes.

MAYO shrinks **o** far below **m**, which breaks the shortcut, and then repairs it publicly: it *whips* **k** copies of the same map into one map

```
P*(x₁,…,x_k) = Σᵢ Eℓ·P(xᵢ) + Σᵢ<ⱼ Eℓ·P′(xᵢ,xⱼ)
```

where the `E` matrices are multiplication by `z⁰, z¹, …` in `F16[z]/f(z)`. `P*` still has **m** outputs but **k·n** inputs, and it still vanishes on `Oᵏ` — so the signer solves **m** equations in **k·o** unknowns, and parameters are chosen with `k·o > m`. MAYO1 reaches NIST level 1 with a **1420-byte** public key and a **454-byte** signature; MAYO2 trades the other way, **4912 bytes** of key for a **186-byte** signature.

**Security model:** EUF-CMA under the Oil-and-Vinegar assumption plus the hardness of solving generic multivariate quadratic systems. **This is not production crypto** — it is a teaching demo. The implementation is not constant-time and makes no side-channel claims.

## Exhibits

1. **Keygen: a needle small enough to shrink the haystack** — derive a keypair from a seed you choose, for the toy set or for any of MAYO1, MAYO2, MAYO3 and MAYO5. Shows what actually ships (a 16-byte seed plus the P⁽³⁾ block), what the verifier expands from that seed instead of downloading, and how much larger the same key would be with the whipping removed. For the toy set it also *computes* the trapdoor: a random oil point, mapped through the real public map, coming out all zeros.
2. **Sign: watch the too-small oil space become solvable** — the headline mechanism, stepped. Hash the message to a target `t`; fix the vinegar and try one unwhipped copy (6 equations, 3 unknowns — echelon form ends in a row reading `0 = c`, and the page says so); whip `k = 3` copies, showing the spec's `Z` matrix of `z^ℓ` exponents; solve the same 6 equations in 9 unknowns; assemble `sᵢ = (vᵢ + O·xᵢ ‖ xᵢ)` and confirm `P*(s) = t`.
3. **Verify: compute both sides, then try to fool it** — sign under any parameter set, then watch verification recompute `t` from the message and salt, evaluate `P*` on the signature, and print both vectors coordinate by coordinate. Three tamper buttons (flip a nibble in `s`, flip a bit in the salt, change the message under the signature) feed the *real* verifier and report which coordinate first disagrees.
4. **UOV versus MAYO, by the byte** — the `k = 1` corner of MAYO's own size formula (`o = m`) next to each shipped set, computed in the page rather than quoted; then spec Table 2.2's nine level-1 `(o, k)` splits, with every size recomputed and any disagreement with the printed table flagged.
5. **The real thing: reference vectors, replayed in your browser** — seeds NIST's AES-256-CTR-DRBG exactly as the KAT harness does, derives the keypair and the signature, and compares its own bytes against the reference hex for MAYO1, MAYO2, MAYO3 and MAYO5.

## When to Use It

- **Use MAYO** when verification speed and signature size matter more than key size, and you want a post-quantum signature whose hardness assumption is not lattice-based — diversification against a lattice break is much of the on-ramp's point.
- **Use MAYO2 over MAYO1** when the signature travels often and the key rarely (186 B versus 454 B, for 4912 B versus 1420 B of key).
- **Do NOT use this code.** It is a teaching implementation: not constant-time, not reviewed, and not hardened. Use the reference implementation at [PQCMayo/MAYO-C](https://github.com/PQCMayo/MAYO-C).
- **Do NOT use MAYO where ML-DSA already fits.** ML-DSA (FIPS 204) is standardised; MAYO is an on-ramp candidate still under evaluation, and the multivariate family has a history of parameter-level breaks.

## What Can Go Wrong

- **A too-small oil space with no whipping.** Exhibit 2 shows it directly: `m` equations in `o < m` unknowns is inconsistent with probability about `1 − 16^-(m-o)`. This is why `k·o > m` is a hard constraint, checked in the test suite for every parameter set.
- **Emulsifier matrices that lose rank.** If some non-trivial combination of the `E` matrices were singular, whipped copies could cancel and the construction would collapse. MAYO avoids it by making the `E` powers of a field element: `f(z)` must be irreducible of degree `m`, and must not divide `det Z(k×k)`. Both conditions are re-verified here for all five parameter sets, including the toy one.
- **Rank-deficient signing systems.** `SampleSolution` returns ⊥ rather than a wrong answer when `rank(A) < m`; `Sign` re-draws the vinegar with the next `ctr` value. The round-2 parameters deliberately raise that restart probability to between `2⁻¹²` and `2⁻²⁰` so implementations can actually test the path.
- **Reusing the randomizer, or dropping the salt.** The salt binds the target to a per-signature value; the page's tamper buttons show that one flipped salt bit moves every coordinate of `t`.
- **The multivariate family's track record.** Rainbow was broken by Beullens in 2022, and the rectangular MinRank attack shaped MAYO's round-2 parameter choice (`o ≤ n − m`). Nothing on this page argues that MAYO is secure — see [crypto-lab-multivariate](https://systemslibrarian.github.io/crypto-lab-multivariate/) for the break itself.

## Real-World Usage

MAYO is a NIST PQC additional-signatures on-ramp candidate, advanced to the second round, submitted by Beullens, Campos, Celi, Hess and Kannwischer. Its pitch is certificate chains: at NIST level 1 a MAYO1 public key plus signature is under 2 KB combined, competitive with lattice signatures while resting on a different hardness assumption. The submission ships reference, AVX2, Arm NEON and Cortex-M4 implementations. It is **not** standardised, and no production protocol deploys it yet — the on-ramp exists to have alternatives ready if the lattice-based standards are weakened.

## How to Run Locally

```bash
npm install
npm run dev            # http://localhost:5173/crypto-lab-mayo-seal/
npm test               # 107 unit tests, including 6 reference KAT vectors
npm run build          # tsc --noEmit && vite build
npm run test:a11y      # axe-core WCAG 2.1 A/AA gate, both themes, on the built site
```

## Related Demos

- [crypto-lab-multivariate](https://systemslibrarian.github.io/crypto-lab-multivariate/) — the Oil-and-Vinegar trapdoor itself, and the Rainbow / Beullens break
- [crypto-lab-dilithium-seal](https://systemslibrarian.github.io/crypto-lab-dilithium-seal/) — ML-DSA, the standardised lattice signature
- [crypto-lab-falcon-seal](https://systemslibrarian.github.io/crypto-lab-falcon-seal/) — FN-DSA / Falcon, the compact lattice signature
- [crypto-lab-sphincs-ledger](https://systemslibrarian.github.io/crypto-lab-sphincs-ledger/) — SLH-DSA, the hash-based alternative
- [crypto-lab-pq-families](https://systemslibrarian.github.io/crypto-lab-pq-families/) — how the post-quantum families compare

## Build & Verify

**107 unit tests** (Vitest, colocated as `src/**/*.test.ts`), of which **6 are reference known-answer tests** taken from the round-2 submission's `KAT/PQCsignKAT_*.rsp` files — two vectors each for MAYO1 and MAYO2, one each for MAYO3 and MAYO5. Each KAT seeds the NIST AES-256-CTR-DRBG from the vector's `seed`, derives `seedsk` and the signing randomizer `R` from it in the harness's order, and asserts that our secret key, public key and `signature ‖ message` match the reference hex **byte for byte**, then that our verifier accepts.

The rest of the suite covers the field laws of GF(16), `Upper()` preserving the quadratic form, encoder round-trips at every length, the derived-size formulas against spec Table 2.1, irreducibility of all five `f(z)` and the `f ∤ det Z` condition, full rank of the emulsifier combinations, echelon-form invariants, `SampleSolution` correctness and its rank-deficiency refusal, `P` vanishing on `O` and `P*` on `Oᵏ`, accept-good / reject-every-bad for signatures (modified message, single-nibble edits across `s` and the salt, cross-key, all-zero, wrong lengths), and the size-ledger claims.

Files worth reading: `src/mayo/gf16.ts` (the field), `src/mayo/whip.ts` (the whipping construction and its structural checks), `src/mayo/linalg.ts` (Algorithms 1–2), `src/mayo/mayo.ts` (Algorithms 4–8), `src/mayo/uov.ts` (the size ledger), `src/mayo/kat-vectors.json` (the reference vectors).

**Accessibility gate:** `npm run test:a11y` runs `@axe-core/playwright` against the production build and asserts zero WCAG 2.1 A/AA violations in **both** themes, scanning six driven states per theme (after keygen for all five offered parameter sets, after the whipping walkthrough, on an accepted signature, on each rejected one, under real parameters, and after a reference-vector replay). The GitHub Pages deploy is blocked if it fails.

## Performance

Measured in-page and reported by Exhibit 5. On a recent laptop, MAYO1 keygen is roughly 8 ms, signing 15 ms and verification 9 ms; MAYO2 is faster still. Keygen, signing and verification together take about 130 ms at MAYO3 and about 290 ms at MAYO5 — a noticeable pause on a button press, but no more than that. Nothing here is optimised — the code keeps the spec's readable form and skips the nibble-slicing that the reference implementation uses for SIMD.

## Honest Scoping

- **Real:** hand-rolled GF(16) and all MAYO-specific math; SHAKE256 and AES-128-CTR from [@noble](https://github.com/paulmillr/noble-hashes) (audited, synchronous — WebCrypto has no SHAKE and no synchronous AES). Real parameter sets, real reference vectors.
- **Simulated:** nothing. The toy parameter set is a genuine, tiny instance of the same construction, labelled as insecure wherever it appears.
- **Not proven:** anything about MAYO's security. No key-recovery or forgery attack is attempted or claimed; the only way a signature verifies here is by being made with the secret key. Side-channel and fault attacks are out of scope, as are the other on-ramp multivariate candidates (QR-UOV, SNOVA) and classic UOV's internals.
- **No backend.** Everything runs in the browser; key material lives in memory for the length of a page view and is never persisted or transmitted.

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
