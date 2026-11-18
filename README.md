# MAYO Seal

**MAYO · NIST PQC On-Ramp** — signs and verifies with the MAYO multivariate signature scheme, whose "whipped" Oil-and-Vinegar map keeps UOV's small signatures while shrinking its notoriously large public key.

**Live demo:** https://systemslibrarian.github.io/crypto-lab-mayo-seal/

---

## What It Is

MAYO is a multivariate quadratic signature scheme submitted to NIST's [additional signatures on-ramp](https://csrc.nist.gov/projects/pqc-dig-sig). This page implements it: the finite field GF(16), the spec's wire encodings, echelon form and `SampleSolution`, the whipping construction, and `MAYO.CompactKeyGen` / `ExpandSK` / `ExpandPK` / `Sign` / `Verify` from the round-3 specification (NIST submission package). Keygen, signing and verification all run in the browser, for the real **MAYO1, MAYO2, MAYO3 and MAYO5** parameter sets and for a deliberately tiny toy set whose matrices fit on screen.

The problem MAYO solves: in Unbalanced Oil-and-Vinegar the signer's shortcut is a hidden linear subspace, the *oil space* **O**, on which every public equation vanishes. Signing means fixing the *vinegar* coordinates at random and then solving for the oil coordinates — a linear system of **m** equations in **o** unknowns. That only works when `o ≥ m`, and the public key grows with `o²`, so classic UOV pays for its trapdoor in kilobytes.

MAYO shrinks **o** far below **m**, which breaks the shortcut, and then repairs it publicly: it *whips* **k** copies of the same map into one map

```
P*(x₁,…,x_k) = Σᵢ Eℓ·P(xᵢ) + Σᵢ<ⱼ Eℓ·P′(xᵢ,xⱼ)
```

where each `E` is multiplication by a power of `z` in `F16[z]/f(z)`. Round 3 uses an MDS schedule, so every square block submatrix of `(Eᵢⱼ)` is invertible. The quadratic part `P*` still vanishes on `Oᵏ`, leaving an affine signing system of **m** equations in **k·o** unknowns after fixing the vinegar.

Round 3 verifies `P*(s) + Σᵢ Eᵢ₀ Λ sᵢ = t`. The same SHAKE256 output gives the target and a 16-byte AES key and 16-byte IV that expand into the linear map Λ. The specification added the linear term to counter improved claw-finding attacks. The compact signing path derives the system directly from the compact key without materialising `L`. The toy keeps its original quadratic-only map.

| Round-3 set | n | m | o | k | Public key (B) | Signature (B) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MAYO1 | 88 | 80 | 8 | 10 | 1456 | 464 |
| MAYO2 | 86 | 64 | 13 | 5 | 2928 | 239 |
| MAYO3 | 118 | 108 | 10 | 11 | 2986 | 681 |
| MAYO5 | 154 | 142 | 12 | 12 | 5554 | 964 |

**Security model:** EUF-CMA in the random oracle model. The specification's security analysis names exactly two hardness assumptions in §5.1, "Hard Problems underlying MAYO", and §5.2's Theorem 1 reduces EUF-CMA to those two: the **OV problem** (Definition 1) — distinguish a random multivariate quadratic map from one that vanishes on the rowspace of a secret oil space `O` — and the **multi-target whipped MQ problem** (Definition 2) — given a random `P` and unboundedly many targets, find a preimage under the *whipped* map `P*`. Solving generic multivariate quadratic systems is the background hardness of the family, not the assumption the proof rests on: Chapter 6 of the spec separates the two — because MAYO public keys share Oil and Vinegar's structure, "decades of cryptanalysis inspire confidence in the security of MAYO against key recovery attacks", while "for security against forgery attacks, MAYO relies on the hardness of the “Whipped MQ” problem, which has had relatively less public scrutiny." **This is not production crypto** — it is a teaching demo. The implementation is not constant-time and makes no side-channel claims.

**Standards reviewed 15 November 2026:** the two assumptions above were read from the [round-3 MAYO specification in NIST's round-3 submission package](https://csrc.nist.gov/csrc/media/Projects/pqc-dig-sig/documents/mayo_specification.pdf) — the document headed "Round 3 Version" — Chapter 5 "Security Analysis" (§5.1 "Hard Problems underlying MAYO", Definitions 1 and 2; §5.2 Theorem 1, which bounds the EUF-CMA advantage by the OV and multi-target-whipped-MQ advantages) and Chapter 6 "Advantages and Limitations". Both quoted sentences and both definitions are in that round-3 document, so the assumptions stated here are the ones the current specification states. This lab implements the round-3 sets from Table 2.1. The [NIST round-3 submission package](https://csrc.nist.gov/csrc/media/Projects/pqc-dig-sig/documents/MAYO.zip) supplies the reference vectors. The MAYO1 row in the PQMAYO site PDF is the round-1 table, with `n = 66, m = 64, o = 8, k = 9`.

## Research status — round-3 implementation and heuristic forgery estimates

[Ostuzzi, Geometric Forgeries: Structural Cryptanalysis of MAYO,
ePrint 2026/2247](https://eprint.iacr.org/2026/2247), published September 30, 2026,
combines structural and multi-target attacks. Table 1 estimates round-2 MAYO1 at
128 bits of work and MAYO3 at 207; MAYO1 falls below the paper's 143-bit level-I
comparator. These are **heuristic attack-cost estimates in a preprint**, not a
practical full-size forgery demonstration or a final standards decision.

This is distinct from the Schur–Macaulay analysis below. The lab
runs the round-3 parameters and reference vectors. Its level labels describe
the submission's **claimed/targeted** levels, not established security. Exhibit 4
measures random guessing only: `16^m` is its baseline, not a lower bound on all
attacks. Round 3 adds linear terms and changes parameters; the paper still
estimates reductions for some round-3 sets. Neither this paper nor the lab
establishes round-3 security.

## Exhibits

1. **Keygen: a needle small enough to shrink the haystack** — derive a keypair from a seed you choose, for the toy set or for any of MAYO1, MAYO2, MAYO3 and MAYO5. Shows what actually ships (a 16-byte seed plus the P⁽³⁾ block), what the verifier expands from that seed instead of downloading, and how much larger the same key would be with the whipping removed. For the toy set it also *computes* the trapdoor twice over: a random oil point mapped through the real public map comes out all zeros, and so does a random point of `Oᵏ` through the whipped map — the property whipping has to preserve for a solution to exist.
2. **Sign: watch too few oil variables become enough** — opens with the mechanism as a figure: the signing system drawn as a block m rows tall and k·o columns wide, against the width it has to clear, with a **k slider**. Turn k down and the block falls short of the line with the shortfall bracketed; turn it up and it crosses. The readout is careful about what the threshold does and does not promise, and computes both probabilities: below it a random target is reachable about once in `16^(m−k·o)` draws — improbable, not impossible — and above it a particular vinegar draw can still come out rank-deficient, which MAYO detects and retries. The slider uses a random-matrix model. Round-3 MAYO1 ships a square system (`k·o = m = 80`), and the other shipped sets have spare columns.

   Then the headline mechanism, stepped, on **any** of the offered parameter sets. Hash the message to a target `t`; fix the vinegar and try one unwhipped copy (at TOY: 6 equations in 3 unknowns, echelon form ending in a row that reads `0 = c`; at MAYO1: 80 in 8, same outcome); whip `k` copies, showing the spec's `Z` matrix of `z^ℓ` exponents; solve the same `m` equations in `k·o` unknowns; assemble `sᵢ = (vᵢ + O·xᵢ ‖ xᵢ)` and confirm the verification equation. At real parameters the matrices are drawn as a corner and the caption says which — the view is clipped, the computation is not, and the echelon view is anchored so the contradiction row stays on screen.
3. **Verify: compute both sides, then try to fool it** — sign under any parameter set, then watch verification recompute `t` from the message and salt, evaluate the public verification expression on the signature, and print both vectors coordinate by coordinate. Three tamper buttons (flip a nibble in `s`, flip a bit in the salt, change the message under the signature) feed the *real* verifier and report which coordinate first disagrees.
4. **Forge it without the trapdoor** — the break-it-yourself panel, where every button runs the real code and fails. Guess `s` and the salt at random and watch the match histogram come out binomial at one-in-sixteen per coordinate, with the measured guess rate extrapolated to the `16^m` random-guess baseline (not the best-known forgery cost). Or keep the genuine key material and change only the oil space — at random, or by a single nibble: `Sign` still solves a full-rank system and still emits a correctly-sized signature, and `Verify` still rejects it, because `P⁽³⁾` was built from the real `O`. A control button runs the identical rebuilt-key path with the real `O` and verifies. A fourth button feeds the verifier four malformed signatures and reports which are refused on shape before any field arithmetic and which are rejected by the comparison.
5. **UOV versus MAYO, by the byte** — the `k = 1` corner of MAYO's own size formula (`o = m`) next to each shipped set, computed in the page rather than quoted; then the *historical round-2 submission's* Table 2.2 nine level-1 `(o, k)` splits, with every size recomputed and any disagreement with the printed table flagged. This compares sizes, not security: [Merz and Ran, ePrint 2026/2181 (September 26, 2026)](https://eprint.iacr.org/2026/2181) estimate that four *alternate* round-2 MAYO sets fall below their claimed security level. The preprint does not demonstrate key recovery against all MAYO parameters or establish the security of round-3 parameters.
6. **The real thing: reference vectors and preconditions, checked here** — seeds NIST's AES-256-CTR-DRBG exactly as the KAT harness does, derives the keypair and the signature, and compares its own bytes against the reference hex for MAYO1, MAYO2, MAYO3 and MAYO5. A second panel recomputes the seven structural facts MAYO depends on — `f(z)` irreducible, `f ∤ det Z`, non-trivial `E` combinations at full rank, `P` vanishing on `O`, `P*` on `Oᵏ`, the sizes matching Table 2.1, and the ℓ numbering covering each pair once — each with what it computed, how long it took, and what breaks without it. The suite asserts all seven in CI; the panel exists because a page that only claims them is asking to be trusted.

## When to Use It

- **Use MAYO** when verification speed and signature size matter more than key size, and you want a post-quantum signature whose hardness assumption is not lattice-based — diversification against a lattice break is much of the on-ramp's point.
- **Use MAYO2 over MAYO1** when the signature travels often and the key rarely (239 B versus 464 B, for 2928 B versus 1456 B of key).
- **Do NOT use this code.** It is a teaching implementation: not constant-time, not reviewed, and not hardened. Use the reference implementation at [PQCMayo/MAYO-C](https://github.com/PQCMayo/MAYO-C).
- **Do NOT use MAYO where ML-DSA already fits.** ML-DSA (FIPS 204) is standardised; MAYO is an on-ramp candidate still under evaluation — it advanced to round 3 on 14 May 2026 (NIST IR 8610), which is a step in the process, not an endorsement — and the multivariate family has a history of parameter-level breaks.

## What This Page Is Careful Not To Claim

The width `k·o` affects how often a candidate signing system has full row rank. The slider computes the following probabilities for uniformly random matrices.

- **Below the threshold** a random target is reachable about once in `16^(m−k·o)` draws. Improbable, not impossible.
- **At the threshold** a square system has one solution when it is invertible, which a random draw is roughly 93% of the time.
- **Above it** roughly one draw in `2^restart` is still rank-deficient; `Sign` re-draws the vinegar and tries again, exactly as spec Algorithm 7 does.

Nor does width alone make a system easy. The figure spells out both causes: the secret oil space is what turns the quadratic map into a linear one, and whipping is what supplies enough variables. Neither is sufficient alone — a wide multivariate system with no trapdoor is precisely the problem MAYO's security rests on.

## What Can Go Wrong

- **MAYO research update — 16 November 2026.** [Li and Tao, *Extending the Schur–Macaulay Framework for UOV Attacks via Truncated Polynomial Algebras*, ePrint 2026/2444](https://eprint.iacr.org/2026/2444), revised 16 November 2026, reports lower attack-cost estimates for selected additional Round-3 MAYO parameter sets. This is a **preprint; conditional extrapolation** based on conjectural Hilbert-series and structured-rank predictions, not demonstrated production-key recovery. The estimates apply to the selected Round-3 parameter sets examined in the paper. The demo does not execute this attack. See [Exhibit 5 research note](https://systemslibrarian.github.io/crypto-lab-mayo-seal/#mayo-schur-update).

- **A too-small oil space with no whipping.** Exhibit 2 shows it directly: `m` equations in `o < m` unknowns is inconsistent with probability about `1 − 16^-(m-o)`. The suite checks that the shipped signing systems have at least as many columns as rows.
- **Emulsifier matrices that lose rank.** If some non-trivial combination of the `E` matrices were singular, whipped copies could cancel and the construction would collapse. MAYO avoids it by making the `E` powers of a field element: `f(z)` must be irreducible of degree `m`, and must not divide `det Z(k×k)`. Both conditions are re-verified here for all five parameter sets, including the toy one.
- **Rank-deficient signing systems.** `SampleSolution` returns ⊥ rather than a wrong answer when `rank(A) < m`; `Sign` re-draws the vinegar with the next `ctr` value. The retry probability depends on the parameter set and the signing system.
- **Reusing the randomizer, or dropping the salt.** The salt binds the target to a per-signature value; the page's tamper buttons show that one flipped salt bit moves every coordinate of `t`, and the malformed-input battery shows that a genuine salt from a *different* signature by the same key is just as fatal.
- **A corrupted oil space in the signer.** Exhibit 4 makes this concrete: a signer whose `O` is wrong by one nibble still solves its linear system and still emits a well-formed signature, and every one of them is rejected. A multivariate signer therefore cannot detect trapdoor corruption from the fact that signing "worked" — only verification catches it, which is a good argument for verifying after signing.
- **The multivariate family's track record.** Rainbow was broken by Beullens in 2022, and the rectangular MinRank attack shaped MAYO's round-2 parameter choice (`o ≤ n − m`). The later [Schur–Macaulay analysis (September 26, 2026)](https://eprint.iacr.org/2026/2181) estimates reduced security for four alternate round-2 MAYO sets; preliminary results also prompted the MAYO team to discard one proposed round-3 set and increase parameters. Those are preprint estimates about specified parameter choices, not a demonstrated break of the four round-3 sets implemented here. Nothing on this page argues that MAYO is secure — see [crypto-lab-multivariate](https://systemslibrarian.github.io/crypto-lab-multivariate/) for the Rainbow break.

## Real-World Usage

MAYO is a NIST PQC additional-signatures on-ramp candidate [listed in round 3](https://csrc.nist.gov/Projects/pqc-dig-sig/round-3-additional-signatures), submitted by Beullens, Campos, Celi, Hess and Kannwischer. It [advanced to round 3](https://csrc.nist.gov/News/2026/nist-advances-9-candidates-to-the-3rd-round-of-pqc) on 14 May 2026, one of nine candidates NIST carried forward; NIST IR 8610 gives the rationale. This lab implements and checks the round-3 submission parameters and vectors. Under the submission's claimed NIST level 1, MAYO1 has a 1456-byte public key and a 464-byte signature, under 2 KB combined. The submission ships reference, AVX2, Arm NEON and Cortex-M4 implementations. It is **not** standardised, and no production protocol deploys it yet — the on-ramp exists to have alternatives ready if the lattice-based standards are weakened.

## How to Run Locally

```bash
npm install
npm run dev            # http://localhost:5173/crypto-lab-mayo-seal/
npm test               # unit tests, including 6 reference KAT vectors
npm run build          # tsc --noEmit && vite build
npm run test:a11y      # accessibility + browser claims against the built site
```

## Related Demos

- [crypto-lab-multivariate](https://systemslibrarian.github.io/crypto-lab-multivariate/) — the Oil-and-Vinegar trapdoor itself, and the Rainbow / Beullens break
- [crypto-lab-dilithium-seal](https://systemslibrarian.github.io/crypto-lab-dilithium-seal/) — ML-DSA, the standardised lattice signature
- [crypto-lab-falcon-seal](https://systemslibrarian.github.io/crypto-lab-falcon-seal/) — FN-DSA / Falcon, the compact lattice signature
- [crypto-lab-sphincs-ledger](https://systemslibrarian.github.io/crypto-lab-sphincs-ledger/) — SLH-DSA, the hash-based alternative
- [crypto-lab-pq-families](https://systemslibrarian.github.io/crypto-lab-pq-families/) — how the post-quantum families compare

## Build & Verify

The unit suite (Vitest, colocated as `src/**/*.test.ts`) includes **6 reference known-answer tests** taken from the round-3 submission's reference `KAT/PQCsignKAT_*.rsp` files — two vectors each for MAYO1 and MAYO2, one each for MAYO3 and MAYO5. Each KAT seeds the NIST AES-256-CTR-DRBG from the vector's `seed`, derives `seedsk` and the signing randomizer `R` from it in the harness's order, and asserts that our secret key, public key and `signature ‖ message` match the reference hex **byte for byte**, then that our verifier accepts.

The rest of the suite covers the field laws of GF(16), `Upper()` preserving the quadratic form, encoder round-trips at every length, the derived-size formulas against spec Table 2.1, irreducibility of all five `f(z)` and the `f ∤ det Z` condition, full rank of the emulsifier combinations, echelon-form invariants, `SampleSolution` correctness and its rank-deficiency refusal, `P` vanishing on `O` and `P*` on `Oᵏ`, accept-good / reject-every-bad for signatures (modified message, single-nibble edits across `s` and the salt, cross-key, all-zero, wrong lengths), and the size-ledger claims.

Files worth reading: `src/mayo/gf16.ts` (the field), `src/ui/whipviz.ts` (the k-slider figure), `src/mayo/whip.ts` (the whipping construction and its structural checks), `src/mayo/linalg.ts` (Algorithms 1–2), `src/mayo/mayo.ts` (Algorithms 4–8), `src/mayo/forge.ts` (the failed attacks and the fail-closed cases), `src/mayo/preconditions.ts` (the structural checks), `src/mayo/uov.ts` (the size ledger), `src/mayo/kat-vectors.json` (the reference vectors). Places shaped for a likely extension are marked `// [extension] point`.

**Accessibility gate:** `npm run test:a11y` runs accessibility and interaction regressions, including two research-claim tests, against the production build. The latter check claimed round-3 level labels, the dated preprint status, and the measured random-guess baseline.

Two are axe scans asserting zero WCAG 2.1 A/AA violations in the shipped **dark** theme, at desktop and 380px widths, across the driven states (after keygen for all five offered parameter sets, after the whipping walkthrough at toy and at real parameters, on an accepted signature, on the walkthrough's own artifact adopted into the verifier, on each rejected one, under real parameters, after every forgery attempt and the malformed-input battery, after a reference-vector replay with the preconditions rechecked, and one whole-page pass with every exhibit in its final state), with every disclosure opened before each scan — an unscanned state is an ungated state.

Each interaction scan is scoped to the exhibit that changed, with the final pass covering landmarks, heading order and the shared chrome. That is not only faster: re-scanning the whole page after every interaction re-checks thousands of already-cleared nodes, and it was what pushed the sweep past its timeout on a CI runner once the walkthrough started rendering real-parameter matrices.

The keyboard checks cover what a static scan cannot: that the skip link is the first tab stop and reaches the content, that every id-bearing control is reachable by Tab, that focus is visibly indicated, that the k slider is arrow-key operable *and* reports its state in text and in the SVG's accessible name, that the whole demo can be driven keyboard-only, and that **no state is conveyed by colour alone** — every verdict carries a glyph and a worded headline, and every compare cell carries a border treatment plus an accessible name.

A manual review under grayscale and simulated deuteranopia/protanopia drove one fix: differing coordinates in the compare strips were distinguishable by tint and border weight but too subtly at that cell size, so they are now struck through as well. The GitHub Pages deploy is blocked if any of this fails.

## Performance

Measured in-page and reported by Exhibit 5. On a recent laptop, MAYO1 keygen is roughly 8 ms, signing 15 ms and verification 9 ms; MAYO2 is faster still. Keygen, signing and verification together take about 130 ms at MAYO3 and about 290 ms at MAYO5 — a noticeable pause on a button press, but no more than that. Nothing here is optimised — the code keeps the spec's readable form and skips the nibble-slicing that the reference implementation uses for SIMD.

## Honest Scoping

- **Real:** hand-rolled GF(16) and all MAYO-specific math; SHAKE256 and AES-128-CTR from [@noble](https://github.com/paulmillr/noble-hashes) (synchronous — WebCrypto has no SHAKE and no synchronous AES; both are pinned `^2.4.0`, later than either library's audit — hashes "at version 1.0.0, in Jan 2022, independently, by [Cure53]", ciphers "at version 1.0.0, in Sep 2024, independently, by [cure53]"). Real parameter sets, real reference vectors.
- **Simulated:** nothing. The toy parameter set is a genuine, tiny instance of the same construction, labelled as insecure wherever it appears.
- **Not proven:** anything about MAYO's security. Exhibit 4 attempts forgeries and they fail, but that demonstrates the odds rather than any cryptanalysis: no key-recovery attack, and nothing with an advantage over guessing, is implemented or claimed. The honest control signs with the real oil space; a valid random guess could also verify. These controls do not rule out structural forgeries. Side-channel and fault attacks are out of scope, as are the other on-ramp multivariate candidates (QR-UOV, SNOVA) and classic UOV's internals.
- **No backend.** Everything runs in the browser; key material lives in memory for the length of a page view and is never persisted or transmitted.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
