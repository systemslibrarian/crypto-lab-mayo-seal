# Making MAYO Seal a 10/10 Teaching Demo

## Executive assessment

**Current teaching score: about 8.5/10.** The cryptographic and accessibility foundations are already exceptional: the demo runs real MAYO, reproduces six reference KATs, exposes the actual signing trace, recomputes structural preconditions, and sends every attack attempt through the real verifier. All 133 unit tests, the production build, and all eight accessibility/keyboard tests pass.

The remaining gap is mostly instructional design. The page has the right material, but it asks a newcomer to absorb too much of it before the central mental model has settled. A 10/10 version should make one idea unforgettable:

> MAYO keeps the secret Oil-and-Vinegar shortcut, shrinks the oil dimension to reduce the public key, and recovers enough signing freedom by combining $k$ copies. The signer can solve because the secret oil space makes the problem linear; whipping supplies enough oil variables while preserving that trapdoor.

That last distinction matters. **Width alone does not make a generic multivariate system easy.** The secret oil space creates the linear system; whipping changes its dimensions.

## Scorecard

| Teaching lens | Current | What keeps it from 10 |
| --- | ---: | --- |
| Narrative clarity | 8.5 | The “why” is strong, but keygen appears before the central whipping insight and the opening language assumes linear-algebra vocabulary. |
| Intuition via interaction | 8.5 | The $k$ slider and stepped signer are excellent, but they are separate experiences rather than one continuous learner journey. |
| Progressive disclosure | 7.5 | All six exhibits have equal visual weight. Raw digests, vectors, matrices, KATs, malformed inputs, and structural proofs compete with the core lesson. |
| Visualization quality | 8.0 | The threshold graphic is useful, but real-parameter matrix excerpts do not convey the size and shape of the full matrix. |
| Newcomer accessibility | 7.5 | The glossary is good, but phrases such as “too small to invert,” “kernel,” and “TLS certificate chain” arrive before enough concrete scaffolding. |
| Teaching honesty | 9.5 | Real computation, explicit scope, KATs, preconditions, and failed attacks are exemplary. One repeated solvability claim needs correction. |

## Priority 0: correct the solvability story

The most important change is factual, not visual. [index.html](index.html) and [src/ui/whipviz.ts](src/ui/whipviz.ts) say the signing system is solvable “exactly when it is wider than it is tall,” and that below the threshold the signer “cannot sign at all.” That overstates what $k o > m$ guarantees.

The accurate teaching model is:

- $k o > m$ gives more oil unknowns than equations. This is the parameter-design condition that makes a solution overwhelmingly likely for a full-row-rank signing matrix.
- A particular vinegar draw can still produce a rank-deficient matrix. MAYO detects this and retries. The existing Step 4 already shows this correctly.
- With $k o < m$, a random target is usually unreachable, not logically impossible. Its approximate reachability probability is $16^{-(m-k o)}$ under the random-system intuition.
- At $k o = m$, a full-rank square system has a unique solution. MAYO chooses slack rather than balancing on that edge.

Replace “solvable / not solvable” in the slider with language such as:

- **Enough room:** “$k o=80$ unknowns for $m=78$ equations. A full-row-rank draw has $16^2$ solutions.”
- **Usually out of reach:** “$k o=8$ unknowns for $m=78$ equations. A random target is reachable only about once in $16^{70}$ draws.”
- **Retry caveat:** “Enough columns is necessary for MAYO’s intended success rate, but an unlucky rank-deficient draw can still be retried.”

Also revise the figure caption from “solvable exactly when wider than tall” to “MAYO chooses enough columns that a full-row-rank draw has solutions.” Add a focused test for all three labels: below, equal to, and above the threshold.

## Priority 1: lead with the aha

Move “The whole idea in one picture” directly below the plain-language introduction and make it the first required interaction. Key generation should follow it, not precede it.

Recommended first-screen sequence:

1. **The problem:** one copy gives only $o$ oil variables for $m$ equations; the target is almost always out of reach.
2. **The move:** drag $k$ from 1 to the shipped value and watch $k o$ cross $m$.
3. **The trade:** show two numbers beside the slider: public-key bytes saved by small $o$, and signature bytes added by larger $k$.
4. **The checkpoint:** ask the learner to complete one sentence: “MAYO shrinks ___ to reduce the public key, then increases ___ to recover signing room.” Answer: $o$, then $k$.

This makes the central design trade-off visible before seeds, P blocks, hex, or Gaussian elimination appear.

Suggested opening copy:

> Classic Oil-and-Vinegar needs a large hidden oil space so signing has enough unknowns, but that makes the public key huge. MAYO makes the oil space small and combines several copies during signing. The public key shrinks with $o^2$; the available signing variables grow to $k o$.

Keep GF(16), TLS, and the exact parameter claims nearby, but behind “Why these numbers?” disclosures until the learner has manipulated the core relationship.

## Priority 2: turn the exhibits into one signature journey

The current panels create independent keys, messages, and signatures. That is convenient for implementation, but it weakens narrative continuity. Build a shared lesson state so the learner follows one artifact through the page:

1. Choose **TOY** or **MAYO1** once.
2. Set one message.
3. See one-copy failure or low success probability.
4. Whip the shipped number of copies and sign.
5. Verify the resulting signature.
6. Tamper with that same signature and observe rejection.

Use a compact progress indicator such as **Problem → Whip → Solve → Verify → Break**. Keep the existing free-exploration controls, but place them in an “Explore independently” mode after the guided journey.

This shared state would also remove repeated setup work and answer a learner’s natural question: “Is this the same signature I just made?”

## Priority 3: simplify the main walkthrough, preserve the math on demand

The five real signing steps are correct, but the default path moves too quickly from intuition to SHAKE output, salts, full vectors, the $Z$ exponent table, and matrix corners. Keep all of that, but reorganize each step into three layers:

- **Headline:** one plain-language sentence.
- **Mechanism visual:** only the object needed for this step.
- **Inspect the real bytes/math:** disclosure containing current vectors, matrices, formulas, and hex.

The default path can be reduced to three conceptual beats:

1. **One copy misses:** the secret trapdoor makes a linear system, but there are far too few oil variables.
2. **Whipping adds room:** $k$ copies produce $k o$ oil variables while preserving the same hidden oil space in each copy.
3. **Solve and check:** elimination finds oil coordinates, then $P^*(s)$ matches the message target $t$.

The current five algorithmic steps should remain available as “Show the full signing algorithm.” This preserves expert value without making a newcomer distinguish SHAKE inputs before understanding why whipping exists.

## Priority 4: improve the visuals that carry the concept

### Show the two causes separately

The current figure risks teaching “wide matrix = easy.” Label the two ingredients explicitly:

- **Secret structure makes it linear.** Fixing vinegar plus knowing $O$ creates $A x=y$.
- **Whipping supplies enough variables.** Replacing $o$ with $k o$ makes a full-rank system likely to hit the target.

A two-row causal diagram would prevent the most likely misconception:

```text
secret O + fixed vinegar        -> quadratic map becomes linear in oil variables
k whipped copies                -> o variables become k·o variables
linear + enough variables       -> solve, assemble s, verify P*(s) = t
```

### Give clipped matrices a scale map

For real parameters, place a small full-matrix thumbnail beside every clipped table. Highlight the displayed top-left region and label both dimensions, for example:

> Showing a 14×18 corner of the full 78×80 system. The computation uses all 6,240 entries.

This communicates scale better than a caption alone and makes TOY-to-MAYO1 progression visible.

### Make the size trade-off immediate

The UOV-versus-MAYO ledger is valuable but arrives late. Pull one computed comparison into the first lesson:

- small $o$ → much smaller public key;
- larger $k$ → more signature blocks;
- shipped $k$ is the smallest value with the desired slack.

Keep the full nine-row ledger as the advanced exploration.

## Priority 5: add prediction and retrieval

The demo currently demonstrates extremely well, but rarely asks the learner to commit to a prediction. Add three short checks with immediate explanations:

1. **Before moving $k$:** “At $k=1$, will this random target usually be reachable?”
2. **Before solving:** “What changes when we whip: the number of equations, the oil variables, or both?”
3. **Before tampering:** “Changing the salt moves which side of the verification comparison?”

End the guided journey with a four-part summary the learner can reconstruct:

- **Problem:** classic UOV’s large $o$ inflates the public key.
- **Compression move:** MAYO uses a much smaller $o$.
- **Repair:** whipping gives $k o$ signing variables while preserving the trapdoor.
- **Cost:** compact public key, more signature blocks.

A “Can you explain MAYO in 20 seconds?” prompt would turn recognition into retrieval, which is more likely to stick.

## Priority 6: separate core lesson from proof lab

Keep all six current capabilities, but give them unequal hierarchy.

### Core lesson

- Why UOV’s key grows
- The $o$ versus $k o$ interaction
- One real sign/verify flow
- One tamper action
- One computed MAYO-versus-unwhipped size comparison

### Proof lab

- Full key material and P-block expansion
- Full five-step trace
- Matrix and vector inspectors
- Random-guess histogram
- Wrong-oil-space control experiment
- Malformed-input battery
- KAT replay
- Structural preconditions
- Complete size ledger

“Proof lab” is not lesser content. It tells the learner that these panels answer “How do we know the demo is telling the truth?” rather than implying they are prerequisites for the main idea.

## Newcomer copy fixes

Introduce each technical term at the moment it becomes useful:

- Replace **“too small to invert”** with **“too few oil variables to hit a typical target.”**
- Explain **TLS certificate chain** as **“a bundle of public keys and signatures sent during a secure connection, where every kilobyte affects latency.”**
- Define **rank** inline as **“the number of independent equations.”**
- Define **kernel / vanishes** as **“every point in the secret oil space maps to zero.”**
- Render exponent notation with accessible text such as `16 to the power 70`; do not rely only on Unicode superscripts.
- Make clear that **TOY is the same algorithm with insecure dimensions**, not a simulation.

## What must be preserved

- Real GF(16), keygen, signing, verification, encodings, and whipping logic.
- TOY as the default inspectable parameter set, with a one-click switch to MAYO1.
- Byte-for-byte reference KAT replay.
- Structural precondition checks.
- Compute-both-sides verification display.
- Wrong-oil-space experiment and genuine-$O$ control.
- Malformed-input handling.
- Computed size ledger rather than quoted marketing numbers.
- Explicit “not production,” non-constant-time, and no-security-proof scoping.
- Both-theme WCAG and keyboard gates.

Do not replace these with animation, canned values, or simplified fake math. The recommendation is to change hierarchy and explanation, not rigor.

## Suggested implementation order

1. Correct every absolute solvability claim and add below/equal/above threshold tests.
2. Move the $k$ interaction ahead of keygen and simplify the opening copy.
3. Build shared lesson state for one message, key, signature, and tamper sequence.
4. Add the two-cause diagram: secret structure makes linear; whipping adds variables.
5. Put raw bytes, the $Z$ matrix, and elimination tables behind disclosures in guided mode.
6. Add prediction checks and a final retrieval summary.
7. Add full-matrix scale thumbnails for clipped real-parameter views.
8. Reframe KATs, preconditions, malformed inputs, and the full ledger as the proof lab.

## Definition of 10/10

The redesign is done when a newcomer can complete the guided path in about three minutes and correctly answer all of these without reading the proof lab:

1. Why does classic UOV need a large public key?
2. What does MAYO make smaller?
3. What does whipping multiply?
4. Why does whipping not make arbitrary quadratic systems easy?
5. What is the trade-off between $o$, $k$, public-key size, and signature size?
6. Why can signing retry even when $k o > m$?

Engineering acceptance criteria:

- No UI copy claims $k o > m$ guarantees a solution for every draw.
- Below, equal, above, and rank-deficient cases have focused tests.
- The first meaningful interaction is the $k$ threshold/trade-off visual.
- Guided mode carries one artifact from sign through verify and tamper.
- Raw cryptographic detail remains available but is not required to understand the core lesson.
- TOY and MAYO1 both complete the same guided flow using real code.
- `npm test`, `npm run build`, and `npm run test:a11y` remain green.

## Bottom line

This demo does not need more cryptography or more panels. It needs a stronger hierarchy around the excellent cryptography already present. Correct the threshold claim, put the whipping interaction first, carry one signature through a short guided story, and make the full implementation evidence an optional proof lab. That would turn an impressive reference implementation into a lesson learners can accurately retell.