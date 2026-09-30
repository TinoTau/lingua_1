# LINGUA_MODEL2_FULL_EXPLANATION_EVIDENCE_PREDEV_AUDIT

**PHASE:** `LINGUA_MODEL2_FULL_EXPLANATION_EVIDENCE_PREDEVELOPMENT_AUDIT`  
**MODE:** READ-ONLY · TRACE-FIRST · CONTRACT DISCOVERY  
**PRODUCT_CODE_CHANGE_THIS_ROUND:** `NO`

---

## 0. Purpose & prior rejection

Previous Anchor predev recommended `CONTRACT_A = FULL_GEOMETRY_EXACT_SURFACE_AND_RETAINED_DOMAIN`.

**Not approved for development.** Legitimate Model2 repairs have `replacement != ASR surface` (升层→生成, 刘→牛). CONTRACT_A would false-demote them.

This audit asks only:

> What runtime evidence can prove Model2 **fully explained** a PathFineSpan, versus only **partially** explaining it?

---

## 1. Case set (6 ∈ [4,8])

| ID | Role | Audit region | GT note (AUDIT ONLY) |
|----|------|--------------|----------------------|
| p2_u004_001 | **P1** | 升层 | hypothesized full Model2 explanation |
| p2_u001_039 | **P2** | 刘 | hypothesized full mono explanation |
| p2_u004_009 | **N1** | 藏 | partial vs 床头灯 / chuang |
| p2_u004_019 | **N2** | 德鸾 | n_l may explain luan→nuan; de≠di |
| p2_u002_012 | N3 | 注册 | B1 extra; P query no hit |
| p2_u001_020 | N4 | 理事 | B1 extra; P query no hit |

Replay: CORRECT_PROFILE + frozen tone + `MODEL2_DIALOG200_TRACE=1`. No Pilot200 full run.

---

## 2. Pipeline field survival (P path)

```text
PathFineSpan/window geometry
 → observed syllables (windowPinyinKey)
 → PAction (single:<family>)
 → hypothesizeIntendedSyllables (relation-direction.ts)
 → querySyllables / pinyinKey / nChanged (local only)
 → recallSpanTopKV2 (hotword.pinyin used inside recall)
 → materializeProfileHits → WindowCandidate
 → LexicalEdge → PathFineSpan → Anchor adapter
```

| FIELD | PRODUCER | RelAdapter | CandMat | WinCand | Edge | PFS | Anchor | REQUIRED_FOR_CLOSED_CHAIN? | LOST? | MINIMAL_OWNER_TO_PRESERVE |
|-------|----------|------------|---------|---------|------|-----|--------|----------------------------|-------|---------------------------|
| observed syllables | window | Y | as windowPinyinKey | Y | Y | via cand | Y | Y | no | — |
| transformed syllables | hypothesize | Y | **NO** | **NO** | NO | NO | NO | Y | **YES @ materialize** | Model2 cand / WindowCandidate internal |
| changedPositions / nChanged | hypothesize | Y (nChanged used to skip) | **NO** | **NO** | NO | NO | NO | for GEOMETRY≠EXPLANATION audit | **YES** | same |
| relation family | actionId | Y | model2ActionId | Y | Y | Y | Y | Y | no | — |
| query pinyin key | executeProfileLexiconQueries | Y | **NO** on cand | NO | NO | NO | NO | Y | **YES** (trace-only today) | WindowCandidate internal |
| lexicon hit surface | recall hit | Y | replacement | Y | Y | Y | Y | Y | no | — |
| lexicon hit pinyin | hotword.pinyin | Y | **NO** | NO | NO | NO | NO | Y (strict match) | **YES @ materialize + trace** | WindowCandidate internal |
| termId | hotword.id | Y | Y | Y | Y | Y | Y | support | no | — |
| PROFILE_PRONUNCIATION | materialize | — | Y | Y | Y | Y | Y | Y | no | — |
| originSpanId / geometry | policyInput | — | Y | Y | Y | Y | Y | Y | no | — |
| replacement | hit.word | — | Y | Y | Y | Y | Y | Y | no | — |

```text
firstEvidenceLossBoundary (for closed-chain proof) =
candidate-materialize.ts::materializeProfileHits
(drops query syllables, nChanged/positions, hit.pinyin;
 WindowCandidate.windowPinyinKey remains OBSERVED ASR pinyin)
```

Trace `p_retrieval.queries[]` retains `query` / `pinyin_key` / hit surfaces (observation only). Hit pinyin still absent in trace.

---

## 3. Per-case closed-chain results (owning window = audit surface)

### P1 — 升层 (FULL closed chain)

```text
observed: sheng|ceng
action: single:ch_c
transform: sheng|cheng   nChanged=1  changed=[1]  unchanged=[0]
query: sheng|cheng
hit: 生成
PathFineSpan「升层」: PROFILE_PRONUNCIATION 生成 coversFullSpan=true
currentAnchor: DOMAIN_AND_MODEL2
OLD_CONTRACT_A: NON_ANCHOR  → FALSE_DEMOTION
```

Runtime closed chain: **YES**.  
Note: `unchanged=[0]` is normal (生 already matches relation-non-applicable syllable).

### P2 — 刘 (FULL closed chain)

```text
observed: liu → niu → hit 牛
nChanged=1 changed=[0] unchanged=[]
PathFineSpan「刘」: PROFILE_PRONUNCIATION 牛 coversFullSpan=true
OLD_CONTRACT_A: NON_ANCHOR  → FALSE_DEMOTION
```

### N1 — 藏 (CLOSED chain isomorphic to P2)

```text
observed: cang → chang → hit 常
nChanged=1 changed=[0] unchanged=[]
PathFineSpan「藏」: PROFILE_PRONUNCIATION 常 coversFullSpan=true
Multi-char windows 藏头灯 → chang|tou|deng hits=[]
OLD_CONTRACT_A: NON_ANCHOR
```

**Model2-internal evidence is isomorphic to P2.**  
Runtime cannot know `chang ≠ chuang` without Pilot target / downstream context.

```text
N1 outcome = B
Model2 produces internally consistent candidate;
only downstream linguistic/context evidence can know incompleteness.
```

### N2 — 德鸾 (transform without closed hit)

```text
observed: de|luan → de|nuan
nChanged=1 changed=[1] unchanged=[0]
query: de|nuan  hits=[]
PathFineSpan「德鸾」: profilePronunciationCandidates=[]
currentAnchor: DOMAIN_AND_MODEL2  (soft PROFILE_DOMAIN only)
```

Geometry coverage of relation output: full 2-syl sequence.  
Explanation of ASR residuals: **not closed** (no lexicon hit).  
`unchanged=[0]` looks like P1 structurally; **hit emptiness** is the runtime separator from P1—not the unchanged bitmap.

```text
N2 outcome = A (partial) on relation fire + empty hit
+ B for soft-domain Anchor (not Model2 P proof)
```

### N3 注册 / N4 理事

Same pattern as N2: relation transforms (`zhu|ce→zu|ce`, `li|shi→ni|shi`), **hits=[]**, Anchor from domain soft. No closed P chain.

---

## 4. GEOMETRY_COVERAGE vs EXPLANATION_COVERAGE

| Concept | Runtime-provable today? | Meaning |
|---------|-------------------------|---------|
| **GEOMETRY_COVERAGE** | YES (if transport retained) | Relation emitted full-length syllable sequence for the window |
| **RELATION_POSITION_COVERAGE** | YES at adapter (derivable) | Which indices changed vs identity pass-through |
| **ASR_ERROR_EXPLANATION_COVERAGE** | **NO** | Whether every true ASR residual is explained by the profile relation |

**Critical invariant:**

```text
unchangedPositions ≠ unexplained ASR error
```

Identity syllables are expected and correct on P1 (`sheng`). The same pattern appears on N2 (`de`). Without target/oracle, Model2 **must not** treat identity as residual.

```text
RUNTIME_CANNOT_PROVE_RESIDUAL_FROM_MODEL2_EVIDENCE_ALONE = YES
```

---

## 5. Taxonomy (exactly one per audit span)

| Case | runtimeFullExplanationClassification | auditGroundTruthClassification |
|------|--------------------------------------|--------------------------------|
| P1 升层 | **FULL_EXPLANATION_PROVABLE** *(closed pronunciation chain)* | FULL (useful) |
| P2 刘 | **FULL_EXPLANATION_PROVABLE** *(closed chain)* | FULL (useful for that mono) |
| N1 藏 | **EXPLANATION_EXISTS_BUT_SUFFICIENCY_UNPROVABLE** | PARTIAL (compound residual) |
| N2 德鸾 | **PARTIAL_EXPLANATION_PROVABLE** *(relation fired, no P hit)* | PARTIAL |
| N3 注册 | **PARTIAL_EXPLANATION_PROVABLE** | PARTIAL |
| N4 理事 | **PARTIAL_EXPLANATION_PROVABLE** | PARTIAL |

“FULL” here means **closed pronunciation-hypothesis chain**, not “all ASR errors explained.”

---

## 6. Contract candidates (≤3) — audit only

### CONTRACT_1 — CLOSED_PRONUNCIATION_EXPLANATION_CHAIN

**Semantic:** Model2 produced a complete observed→transform→lexicon-query→hit→full-geometry PROFILE_PRONUNCIATION candidate for the PathFineSpan.

**Fields:** observed syl, transformed syl, actionId, query key, hit surface (+ ideally hit pinyin), provenance, full geometry cover, origin ownership.

**Transport:** service-internal on WindowCandidate (transformedQueryKey, nChanged, changedPositions, hitPinyinKey). JobResult: NO. Model2/Domain/Model3 semantics: NO.

| | P1 | P2 | N1 | N2 |
|--|----|----|----|----|
| Protect / fire | YES | YES | **YES (risk)** | NO |

```text
false-protection risk = HIGH on N1 (藏→常 isomorphic to 刘→牛)
false-demotion risk = LOW on P1/P2
```

Architecture-consistent as a **pronunciation-hypothesis proof**, **not** as ASR-error-completeness proof.

### CONTRACT_2 — RELATION_FIRED_NCHANGED_GT_0

Too weak (N2/N3/N4 all fire). **Reject** as Anchor sufficiency.

### CONTRACT_3 — ALL_SYLLABLES_CHANGED

Would demote P1 (sheng unchanged). **Architecture-inconsistent** with global relation application. **Reject**.

---

## 7. vs OLD CONTRACT_A

```text
OLD_CONTRACT_A_FALSE_DEMOTION_CONFIRMED = YES
  P1 升层→生成: demoted
  P2 刘→牛: demoted
```

```text
OLD_CONTRACT_A_STATUS = VALID_AS_ONE_PROOF_CLASS
```

Exact-surface + retained-domain remains a legitimate **lexical preserve** proof class (ASR surface already names a retained-domain term). It is **not** the Model2 pronunciation-repair proof class.

```text
Q15 multi-proof Anchor likely? = YES (lexical preserve OR …)
but Model2 closed-chain alone is NOT a safe Anchor for compound residuals (N1).
Do NOT finalize OR-composition in this round.
```

---

## 8. Architecture invariants

| Invariant | Status |
|-----------|--------|
| MODEL2_PRE_EDGE_INSERTION_UNCHANGED | PASS |
| MODEL2_GLOBAL_RELATION_APPLICATION_UNCHANGED | PASS |
| WINDOW_LOCAL_ACTION_OWNERSHIP_UNCHANGED | PASS |
| WINDOW_LOCAL_TONE_UNCHANGED | PASS |
| DOMAIN_VOTE_UNCHANGED | PASS |
| PATH_LEVEL_DOMAIN_BUCKETS_UNCHANGED | PASS |
| MODEL3_ROLE_UNCHANGED | PASS |
| MODEL2_ON_MODEL3_RETRY = NO | PASS |
| JOBRESULT_BOUNDARY_UNCHANGED | PASS |
| NO_DUAL_MODEL2_PATH | PASS |
| NO_GROUND_TRUTH_RUNTIME_DEPENDENCY | PASS |

```text
ARCHITECTURE_CHANGE_REQUIRED = NO
```

Missing fields = **EVIDENCE_TRANSPORT_GAP**, not architecture change.

---

## 9. Required Q answers

| Q | Answer |
|---|--------|
| Q1 | Closed chain: observed→relation transform→real lexicon query→hit (surface; pinyin match implied by recall / should be stored)→full-geometry PROFILE_PRONUNCIATION candidate. Proves consistent pronunciation **hypothesis**, not contextual correctness. |
| Q2 | **NO** for ASR-error completeness. YES only for closed-chain hypothesis. P2≅N1. |
| Q3 | N/A for error completeness. Closed-chain uses transform+query+hit+geometry. |
| Q4 | **Model3 / downstream context** must decide when closed chain exists but compound residual may remain; or refuse Model2-alone Anchor for that class. |
| Q5 | Transformed syllables: **required** for closed-chain proof downstream | currently lost |
| Q6 | Changed positions: **useful** to separate geometry vs relation-touch; **cannot** alone prove residual | currently lost |
| Q7 | Hit pinyin: **required** for strict match proof | lost at materialize/trace |
| Q8 | All exist upstream at relation adapter / recall hit |
| Q9 | Lost at `materializeProfileHits` (and hit pinyin also absent from dialog200 compact hits) |
| Q10 | YES — service-internal WindowCandidate / edge metadata |
| Q11 | JobResult change: **NO** |
| Q12 | Model2 inference semantics change: **NO** |
| Q13 | Model3 semantics change: **NO** for this discovery; ownership of residual sufficiency stays Model3 |
| Q14 | Exact-surface+retained-domain: **YES** as independent lexical proof class |
| Q15 | Multi-proof likely: **YES**; finalize later |
| Q16 | Development ready for Model2-alone FULL-vs-PARTIAL Anchor: **NO** |

---

## 10. Owner adjudication

```text
ONE_NEXT_OWNER = MODEL3_SUFFICIENCY_OWNER
```

**First unresolved blocker:** production Model2 evidence cannot distinguish FULL ASR-error explanation from PARTIAL compound residual when a closed pronunciation chain exists (P2 vs N1). That sufficiency decision is outside Model2’s frozen responsibility.

Secondary (not first): `EVIDENCE_TRANSPORT_OWNER` to preserve transform/hit-pinyin for closed-chain observability and any future multi-proof design.

```text
ONE_NEXT_DELTA =
Do not implement Anchor CONTRACT_A or Model2-closed-chain-as-sole-Anchor.
Next: define how Model3 (KEEP/RETRY) should treat spans that already carry a Model2 CLOSED_PRONUNCIATION_EXPLANATION_CHAIN versus soft-domain-only anchors — without changing Model2 inference or Domain Vote.
Optional parallel discovery: service-internal transport of transformedQueryKey/hitPinyin for observability (not this round).
```

---

## 11. Final block

```text
FULL_EXPLANATION_RUNTIME_PROVABILITY = PARTIAL

OLD_CONTRACT_A_STATUS = VALID_AS_ONE_PROOF_CLASS

SERVICE_INTERNAL_EVIDENCE_TRANSPORT_REQUIRED = YES

JOBRESULT_CHANGE_REQUIRED = NO

ARCHITECTURE_CHANGE_REQUIRED = NO

ONE_NEXT_OWNER = MODEL3_SUFFICIENCY_OWNER

ONE_NEXT_DELTA =
Defer Model2-alone full/partial Anchor predicate; next audit/design how Model3 residual sufficiency consumes (or ignores) closed Model2 pronunciation chains vs soft-domain anchors — no Model2/Domain/FineSpan/JobResult change.

PRODUCT_CODE_CHANGE_THIS_ROUND = NO
```

STOP.
