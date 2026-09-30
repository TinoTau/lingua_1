# LINGUA_MODEL2_MODEL3_INSERTION_POINT_AND_RESIDUAL_OWNERSHIP_AUDIT

| Field | Value |
|-------|-------|
| Date | 2026-09-12 |
| Nature | **READ-ONLY ARCHITECTURE AUDIT** |
| Mode | NO CODE / CONFIG / MODEL / DATASET / LEXICON / THRESHOLD / SPAN / RETRY CHANGE |
| Scope | Production insertion points, residual ownership, Pilot200 expectation compatibility |

---

## 0. Executive verdicts (four STOP questions)

| # | Question | Answer |
|---|----------|--------|
| 1 | Base Recall miss residual preserved and handed to Model3? | **YES** — surface preserved as fallback `edgeKind=fallback` / PathFineSpan `windowSource=fallback`, typically **len=1, zero candidates**; non-anchor unless Domain/Model2 later attaches. Model3 receives these as path spans; actionable RETRY only if non-anchor. |
| 2 | Model3 can bounded-merge contiguous residual + local re-segmentation + re-recall? | **YES, conditional on RETRY** — `deriveRetryRegions` merges adjacent non-anchor RETRY; `resegmentRetryRegionWithLattice` + Stage-2 re-window/re-recall. KEEP / Anchor break merge. Contiguous **non-anchor alone** is not a region until Model3 marks RETRY. |
| 3 | Model2 original frozen insertion: pre- or post-segmentation? | **DOCUMENT CONFLICT** — Aug-12 Pre-Training SSOT: **after Exact Recall, before `build-lexical-edges`** (pre-segmentation). Aug-17 Runtime MVP SSOT: **after PathFineSpan `activeCandidates`, before DomainAwareAssembly** (post-segmentation). Current Stage-J code matches **Aug-17**. |
| 4 | Pilot200 multi-char Model2 repair vs production ownership? | **Conflict** — under **current** Stage-J insertion, Base-miss multi-char targets are **Model3 residual ownership** (geometry already shattered to mono fallback). Counting them as Model2 useful-expansion is **Pilot expectation drift**, not proof Model2 failed its current contract. |

```text
MODEL2_INSERTION_POINT_CORRECT = UNPROVEN
  (CURRENT matches Aug-17 frozen MVP; CONFLICTS with Aug-12 pre-training design)

MODEL3_RESIDUAL_OWNERSHIP_CORRECT = YES

BASE_MISS_FALLBACK_SEMANTICS_CORRECT = YES

PILOT200_EXPECTATION_COMPATIBLE_WITH_PRODUCTION_ARCHITECTURE = NO
```

```text
ARCHITECTURE_CHANGE_REQUIRED = NO
ARCHITECTURE_DECISION_REQUIRED = YES
  (choose authoritative Model2 insertion SSOT: Aug-12 pre-edge vs Aug-17 post-PathFineSpan)
PILOT_EVALUATION_CONTRACT_CHANGE_REQUIRED = YES
  (under current Stage-J code / Aug-17 insertion)
IMPLEMENTATION_DRIFT_REPAIR_REQUIRED = CONDITIONAL
  (YES only if user freezes Aug-12 as owner and treats Aug-17 as drift)
```

---

## 1. Accepted facts (not re-opened)

- Base/domain Recall hit → LexicalEdge; miss → no candidate-backed LexicalEdge → fallback / zero-candidate FineSpan.
- PathFineSpan → Model2; Model2 PAction = relation-conditioned re-query on **same PathFineSpan geometry**.
- FineSpan-local Tone binding = PASS; PAction geometry = whole FineSpan; relation adapter preserves span length; Tone owner **closed**.

---

## 2. Production pipeline (code order)

Corrected from code (`lattice-fine-span-runtime.ts`, `span-assembly-v4-orchestrator.ts`, `run-model3-path-step.ts`):

```text
RAW / ASR segments
→ Syllable coordinate + Window enumeration (1..5)
→ Base/domain Recall (recallTopKForWindows)
→ LexicalEdge (candidate-backed only) / injectFallbackEdges (len=1, empty candidates)
→ Complete segmentation paths
→ PathFineSpan materialization
→ Tone rebind (FineSpan-local) + Compatibility
→ Model2 expandActiveCandidatesWithModel2   ← CURRENT insertion
→ Domain Vote (ONCE)
→ materializeModel3Anchors
→ Model3 KEEP/RETRY (anchors masked: RETRY→KEEP, eligible=false)
→ deriveRetryRegions (adjacent non-anchor RETRY merge)
→ resegmentRetryRegionWithLattice + Stage-2 re-recall
→ refresh pool → completeDomainAwareAssemblyFromVote (SAME vote)
→ Cross-path merge → KenLM
```

### Node cards

| Stage | INPUT | OUTPUT | OWNER | MAY_CREATE_ANCHOR? | MAY_PROCESS_NON_ANCHOR? |
|-------|-------|--------|-------|--------------------|-------------------------|
| Window + Base Recall | windows, lexicon | WindowCandidate[] | Lexicon / lattice | NO | N/A (pre-anchor) |
| LexicalEdge | candidates | `edgeKind=lexical` | lattice | NO | N/A |
| Fallback inject | uncovered syllables | `edgeKind=fallback` len=1, `candidates=[]` | lattice coverage | NO | preserves residual surface |
| Segmentation | lexical+fallback edges | complete paths | lattice | NO | yes (coverage) |
| PathFineSpan | path edges | PathFineSpan[] | lattice | NO | yes |
| Model2 | PathFineSpan + activeCandidates | PROFILE_* candidates | Model2 Stage J | **YES** (via PROFILE_* → Anchor) | yes (same geometry expand) |
| Domain Vote | activeCandidates | retainedDomains | Domain | evidence for DOMAIN Anchor | filters |
| Anchor | vote + candidates | DOMAIN / MODEL2 / DOMAIN_AND_MODEL2 | model3-anchor-adapter | creates marks | N/A |
| Model3 | all path spans + mask | KEEP/RETRY | Model3 | NO | **actionable only non-anchor** |
| Retry | RETRY regions | reseg + re-recall candidates | Model3 retry | NO (no 2nd Domain Vote / no Model3 reinvoke) | yes, merged residual |

---

## 3. Base Recall / LexicalEdge semantics

### LEXICAL_EDGE_SEMANTICS

```text
“lexically explained candidate-backed region”
```

Evidence: LexicalEdges built only from windows with recall hits; `injectFallbackEdges` injects length-1 edges with **shared empty** `candidates` when lexical edges cannot cover the utterance (`inject-fallback-edges.ts`).

### Base miss preservation

| Verdict | Value |
|---------|-------|
| BASE_MISS_SURFACE_PRESERVED | **YES** |
| BASE_MISS_REPRESENTATION | fallback LexicalEdge → PathFineSpan `windowSource=fallback`, typically syllable length 1, zero WindowCandidates |
| ZERO_CANDIDATE_FINESPAN_ALLOWED | **YES** |

Base Recall miss ≠ architecture failure; it means “ASR surface not currently lexicon-explained.”

```text
BASE_MISS_FALLBACK_SEMANTICS = CORRECT
```

---

## 4. Explained vs unexplained representation

| Concept | Representation in code |
|---------|------------------------|
| LEXICALLY_EXPLAINED_REGION_REPRESENTATION | `edgeKind=lexical` with non-empty candidates; PathFineSpan from lexical edge; may still be **non-anchor** |
| LEXICALLY_UNEXPLAINED_REGION_REPRESENTATION | `edgeKind=fallback` / `windowSource=fallback`, `candidates=[]`; later may gain Model2 PROFILE_* or remain residual |

No `isLegalWord` flag. Distinction is structural:

- candidate-backed LexicalEdge vs zero-candidate fallback
- Anchor mask (`DOMAIN` / `MODEL2` / `DOMAIN_AND_MODEL2`) vs non-anchor
- Model3 KEEP vs RETRY on non-anchor

```text
CAN_CURRENT_CODE_DISTINGUISH_EXPLAINED_VS_UNEXPLAINED_REGION = YES
LEXICALLY_EXPLAINED_VS_RESIDUAL_DISTINCTION = PRESENT
```

Caveat: “explained” ≠ “trusted Anchor”. Base candidate-backed ≠ automatic Anchor.

---

## 5. Segmentation responsibility

```text
SEGMENTATION_GOAL = B
  合法 LexicalEdge + fallback edge 混合，保证整句 coverage
```

| Verdict | Value |
|---------|-------|
| SEGMENTATION_FULL_COVERAGE | **YES** (invariant: injectFallbackEdges guarantees reachability) |
| FALLBACK_EDGE_SEMANTIC_ROLE | **Primarily coverage mechanism**; **also de-facto residual carrier** (zero-candidate mono spans). Not an explicit “suspicious region” type—suspicion is deferred to Model3 non-anchor + RETRY. |

---

## 6. Contiguous residual region discovery

Example shape `[这里][油][些][问题]`:

- Explained: multi-char lexical PathFineSpans with candidates.
- Unexplained: adjacent fallback mono PathFineSpans.

**Before Model3:** code sees **independent** PathFineSpans; no “contiguous residual region” object.

**At Retry:** `deriveRetryRegions` (`model3-retry-region.ts`) merges only **adjacent non-anchor spans with decision=RETRY**. KEEP or Anchor **breaks** the group.

```text
CONTIGUOUS_NON_ANCHOR_REGION_DISCOVERY = PARTIAL
  PRESENT for adjacent Model3-RETRY non-anchors
  ABSENT as a general pre-Model3 residual-region type
```

Implementation: `electron_node/.../model3-runtime/model3-retry-region.ts` → `deriveRetryRegions`.

---

## 7. Anchor ownership

### ANCHOR_SOURCES (real enum)

From `Model3AnchorSource` / `materializeModel3Anchors`:

```text
ANCHOR_SOURCES = [
  DOMAIN,                 // retained Domain Vote + domain_term / passive_domain_weak on span
  MODEL2,                 // PROFILE_RETRIEVAL | PROFILE_PRONUNCIATION | PROFILE_DOMAIN
  DOMAIN_AND_MODEL2       // both
]
```

### Base Recall hit ≠ Anchor

```text
Base candidate-backed LexicalEdge / PathFineSpan
≠ automatically trusted Anchor

Only DOMAIN (post-vote retained) and/or MODEL2 provenance create anchors.
Base-only exact hits that never get PROFILE_* and lack retained domain evidence
remain non-anchor → Model3 may KEEP or RETRY.
```

---

## 8. Model2 ↔ Anchor

```text
MODEL2_CAN_CREATE_ANCHOR_EVIDENCE = YES
```

Condition: Model2 materializes a non-covered WindowCandidate with `retrievalProvenance` in `{PROFILE_RETRIEVAL, PROFILE_PRONUNCIATION, PROFILE_DOMAIN}` bound to the PathFineSpan → `hasModel2Evidence` → Anchor source MODEL2 (or DOMAIN_AND_MODEL2).

Thus Model2 **can** turn a previously non-anchor FineSpan into Anchor evidence **without changing geometry**.

---

## 9. Model3 input contract

| Field | Value |
|-------|-------|
| MODEL3_INPUT_UNIT | PathFineSpan (full path), with features / acoustic-pinyin-tone / domain context / user profile as packed for host |
| MODEL3_ONLY_PROCESSES_NON_ANCHOR | **Actionably YES** — inference may see all spans with `isAnchor`; `maskAnchorDecisions` forces Anchor RETRY→KEEP and `eligible=false` |

Frozen: Model3 must not actionable-RETRY already Anchored spans.

### KEEP / RETRY

| Decision | Meaning |
|----------|---------|
| KEEP | Accept current PathFineSpan for assembly path; no local reseg |
| RETRY | Eligible non-anchor span enters retry-region derivation |

```text
MODEL3_RETRY_REGION_UNIT =
  bounded raw/syllable region from one or more adjacent non-anchor RETRY PathFineSpans
  (not “retry this FineSpan in isolation” when neighbors also RETRY)
```

```text
ADJACENT_RETRY_REGION_MERGE = YES
  (conditional: adjacency in raw+syllable; Anchor/KEEP break)
```

Evidence: `deriveRetryRegions` + `regionMergedFromAdjacentRetry`.

---

## 10. Retry re-segmentation / re-recall

| Verdict | Value |
|---------|-------|
| LOCAL_RESEGMENTATION | **YES** — `resegmentRetryRegionWithLattice` → `runLatticeFineSpanGeneration` on region slice |
| LOCAL_RERECALL | **YES** — Stage-2 windows + recall on new local geometry (`model3-retry-router.ts`) |
| RETRY_CAN_DISCOVER_MULTI_CHAR_TERM_ACROSS_ORIGINAL_FALLBACK_BOUNDARIES | **YES** (capability) — re-lattice can form multi-char LexicalEdges inside the merged region if Base Recall now hits; **PARTIAL in practice** if Model3 never RETRYs the monos, or reseg fails (`NO_PATH` fallback geometry) |

```text
MODEL3_RETRY_CAN_RESEGMENT_RESIDUAL_REGION = YES
MODEL3_RESIDUAL_OWNERSHIP = CORRECT
```

---

## 11. Model2 insertion: CURRENT vs HISTORICAL

### CURRENT_MODEL2_INSERTION_POINT

```text
PathFineSpan path
→ Tone rebind + Compatibility → activeCandidatesBase
→ expandActiveCandidatesWithModel2(...)     // span-assembly-v4-orchestrator.ts ~L401–419
→ Domain Vote → Anchors → Model3 → Retry → Assembly
```

Function chain:

```text
runLatticeFineSpanGeneration
→ (per path) rebindToneForFineSpan / compatibility
→ expandActiveCandidatesWithModel2
→ runModel3PathStep (vote + anchors + KEEP/RETRY + retry router)
→ completeDomainAwareAssemblyFromVote
```

### MODEL2_ORIGINAL_INSERTION_POINT (documents — do not reverse from code alone)

| Doc | Insertion | Date |
|-----|-----------|------|
| `Lingua_Model2_Final_Architecture_Input_Contract_PreTraining_Audit_2026_08_12.md` §3 | **After** `recall-topk-for-windows`, **before** `build-lexical-edges` — merge Model2 Top-K with Exact Recall per Fine Span window | 2026-08-12 |
| Same doc §2 mission diagram | Per Fine Span: Exact Recall **∥** Model2 Fuzzy Recall → Candidate Merge → Domain Vote → Assembly | 2026-08-12 |
| `Lingua_Model2_Runtime_Integration_MVP_PreDevelopment_Audit_2026_08_17.md` §3 | **After** `activeCandidates` (post PathFineSpan/compatibility), **before** `runDomainAwareAssembly` | 2026-08-17 |
| `Lingua_Model2_Runtime_Integration_MVP_Development_Report_2026_08_17.md` | Same post-activeCandidates skeleton | 2026-08-17 |
| Orchestrator header / Stage J | “Model2 P/D” after FineSpan path-local prep; matches Aug-17 | current |

```text
MODEL2_ORIGINAL_RESPONSIBILITY =
  A + B hybrid historically:
  Aug-12: User-Conditioned Fuzzy Candidate Recall participating in per-window candidate merge
           BEFORE LexicalEdge / segmentation (B-leaning)
  Aug-17 / Stage-J: pronunciation-relation / profile expansion on already-segmented PathFineSpan
           geometry (A-leaning: PathFineSpan PAction expansion)
```

```text
MODEL2_EXPECTED_TO_PARTICIPATE_PRE_SEGMENTATION =
  UNPROVEN as single frozen truth
  YES under Aug-12 Pre-Training SSOT
  NO under Aug-17 Runtime MVP SSOT (explicitly post-activeCandidates)
```

```text
MODEL2_INSERTION_POINT_DRIFT = UNPROVEN
  (requires ARCHITECTURE_DECISION: which SSOT owns “original”)
CURRENT code vs Aug-17 = MATCH
CURRENT code vs Aug-12 = DRIFT_CANDIDATE
```

---

## 12. Model2 failure → Model3 fall-through

```text
MODEL2_FAILURE_FALLS_THROUGH_TO_MODEL3 = YES
```

Evidence: orchestrator catch continues with `activeCandidatesBase`; no PROFILE_* → no MODEL2 Anchor; residual FineSpans remain non-anchor for Model3. Empty Model2 hit likewise leaves domain/base-only or zero-candidate spans for Model3.

This fall-through is an important intended chain under **current** Stage-J layering.

---

## 13. Pilot200 vs production

### Research goal

```text
learn pronunciation relation → apply to unseen lexical term
```

Pilot SSOT (`LINGUA_DIALOG2000_V2_PILOT200_SSOT.md`) treats Model3/Retry redesign as **out of scope / DEFERRED** for Pilot scoring — i.e. Pilot metrics are framed as **Model2 profile capability**, not Model3 residual repair.

### Reachability under CURRENT insertion

For:

```text
multi-char target + Base Recall miss + term in Lexicon + known UserProfile relation
```

Model2 only re-queries **existing PathFineSpan** geometry (typically **mono fallback**). It cannot reconstruct the multi-char Lexicon query that never became a LexicalEdge.

```text
PILOT200_MULTI_CHAR_GENERALIZATION_REACHABLE = NO
  (under current Stage-J Model2 insertion + LexicalEdge gate)
  CONDITIONAL only via Model3 Retry reseg+recall — not via Model2 PAction alone
```

### Responsibility conflict

```text
PILOT200_RESPONSIBILITY_CONFLICT = YES
```

Pilot useful-expansion expectations that require **multi-char Base-miss repair** are counting work that **current architecture assigns to Model3 residual Retry** (or to a restored Aug-12 pre-edge Model2), not to post-segmentation PathFineSpan Model2.

---

## 14. Case responsibility classification (7 targets)

Classification under **CURRENT production Stage-J** (Aug-17 insertion + LexicalEdge requires base hit).  
Do **not** auto-assign MODEL2_OWNED merely because a UserProfile relation exists.

| Target | Typical ASR miss shape | MODEL2 can fix multi-char now? | Classification | Notes |
|--------|------------------------|--------------------------------|----------------|-------|
| 礼宾部 | Base miss → mono fallbacks | NO | **MODEL3_RESIDUAL_OWNED** | Relation evidence irrelevant until multi-char geometry or Retry reseg |
| 奶精 | same | NO | **MODEL3_RESIDUAL_OWNED** | |
| 咖啡师 | same | NO | **MODEL3_RESIDUAL_OWNED** | |
| 营运证 | same | NO | **MODEL3_RESIDUAL_OWNED** | |
| 生成 | same | NO | **MODEL3_RESIDUAL_OWNED** | |
| 换乘 | same | NO | **MODEL3_RESIDUAL_OWNED** | |
| 内处理 | same (prior mono Model2 hit was different term) | NO for multi-char target | **MODEL3_RESIDUAL_OWNED** | Mono PathFineSpan Model2 may still expand **other** chars; not target multi-char |

If Aug-12 pre-edge Model2 were restored as SSOT owner:

```text
would reclassify toward MODEL2_OWNED or MODEL2_THEN_MODEL3
→ that reclassification is ARCHITECTURE_DECISION, not this audit’s code change
```

```text
MODEL2_OWNED (current code) =
  relation expansion on an already-formed PathFineSpan whose geometry already matches
  the intended term length (or intentional mono repair)
```

---

## 15. Responsibility gap / overlap

### Gap

```text
RESPONSIBILITY_GAP = YES
RESPONSIBILITY_GAP_REGION =
  Base-miss multi-syllable surface
  → shattered to zero-candidate mono fallback PathFineSpans
  → Model2 cannot change geometry (same-span PAction only)
  → if Model3 KEEP (or never marks adjacent RETRY)
  → no bounded reseg/re-recall
  → multi-char Lexicon term never queried
```

This is **more severe** than low Model2 hit rate: a region with **no owner that can restore multi-char geometry** when Model3 does not RETRY.

### Overlap

```text
RESPONSIBILITY_OVERLAP = NO
  (production layers are sequenced: Model2 expand → Anchor → Model3 residual)
```

**Evaluation overlap / conflation = YES** (Pilot metrics attribute Model3-class residual multi-char repair to Model2).

---

## 16. Ownership table (code-based)

| Stage | Handles explained region | Handles residual | Can create candidate | Can create Anchor | Can change geometry |
| ----------- | ------------------------ | ---------------- | -------------------- | ----------------- | ------------------- |
| Base Recall | YES (hits) | NO (miss → empty) | YES | NO | NO (windows fixed) |
| LexicalEdge | YES (candidate-backed) | NO | NO (consumes) | NO | YES (edge length = hit window) |
| Fallback | NO | YES (coverage/residual carrier) | NO (empty) | NO | forces len=1 on uncovered |
| Segmentation | mixes both for coverage | YES | NO | NO | selects edge path |
| Model2 | YES (expand on span) | YES (same geo expand) | YES (PROFILE_*) | YES (via PROFILE_*) | **NO** (frozen same FineSpan) |
| Domain Vote | filters domain evidence | indirect | NO | enables DOMAIN Anchor | NO |
| Model3 | sees anchors (masked) | YES (actionable) | NO | NO | NO (decision only) |
| Retry | N/A | YES (RETRY regions) | YES (Stage-2 recall) | NO | **YES** (local reseg) |

---

## 17. Architecture drift class

```text
ARCHITECTURE_DRIFT_CLASS = E. MULTIPLE

  - MODEL2_INSERTION_POINT: Aug-12 vs Aug-17 SSOT conflict (decision required)
  - D. PILOT200_EXPECTATION_DRIFT: multi-char Base-miss scored as Model2 under post-seg contract
  - Model3 residual path itself: CORRECT (not C drift); gap is KEEP/non-RETRY on residual, not missing Retry machinery
```

Not a single vague “architecture drift.”

---

## 18. Gates / freezes respected

- No suggestion to auto-create LexicalEdge on Base miss without Aug-12-style Model2 merge evidence.
- No suggestion to send all 1..5 windows to Model2 unless Aug-12 SSOT is explicitly chosen as repair owner.
- `MODEL2_FUTURE_TONE_COMPATIBILITY_RULE` / FineSpan-local Tone / PAction contract: **unchanged, closed**.
- LexicalEdge continues to require lexical evidence under current gate.

---

## 19. Observability (if needed later — no code this round)

```text
OBSERVABILITY_GAP = PARTIAL
```

Minimal traces if a follow-up decision round needs proof:

| field | stage | why |
|-------|-------|-----|
| `edgeKind` + `candidateCount` + syllable `[start,end]` | post-`injectFallbackEdges` | prove residual mono shatter |
| `pathFineSpan.spanId` + geometry + `windowSource` | pre-Model2 | prove Model2 input geometry |
| `isAnchor` + Model3 `decision` + `retryRegionId` + `regionMergedFromAdjacentRetry` | Model3/Retry | prove residual merge vs KEEP gap |
| `newLocalSpanSurfaces` / Stage-2 hit terms | Retry | prove multi-char rediscovery |

---

## 20. Architecture Change Proposal gate (STOP)

```text
ARCHITECTURE_CHANGE_REQUIRED = NO

ARCHITECTURE_DECISION_REQUIRED = YES
  Decide which Model2 insertion SSOT is authoritative:
  (1) Aug-12 pre-LexicalEdge fuzzy merge, or
  (2) Aug-17 / Stage-J post-PathFineSpan PAction expansion

If (2) remains owner:
  PILOT_EVALUATION_CONTRACT_CHANGE_REQUIRED = YES
  IMPLEMENTATION_DRIFT_REPAIR_REQUIRED = NO
  Re-attribute Base-miss multi-char cases to Model3 residual / Retry eval

If (1) is restored as owner:
  IMPLEMENTATION_DRIFT_REPAIR_REQUIRED = YES
  PILOT_EVALUATION_CONTRACT_CHANGE_REQUIRED = PARTIAL
  (restore pre-seg candidate merge — not a new product design)

ONE_NEXT_OWNER = ARCHITECTURE_DECISION (Model2 insertion SSOT)
```

---

## 21. Final verdict block

```text
BASE_MISS_FALLBACK_SEMANTICS = CORRECT
LEXICALLY_EXPLAINED_VS_RESIDUAL_DISTINCTION = PRESENT
CONTIGUOUS_NON_ANCHOR_REGION_DISCOVERY = PARTIAL
MODEL3_RESIDUAL_OWNERSHIP = CORRECT
MODEL3_RETRY_CAN_RESEGMENT_RESIDUAL_REGION = YES

CURRENT_MODEL2_INSERTION_POINT =
  after PathFineSpan + compatibility activeCandidates;
  before Domain Vote / Model3
  (expandActiveCandidatesWithModel2)

MODEL2_ORIGINAL_INSERTION_POINT =
  CONFLICT:
  Aug-12 = after Exact Recall / before build-lexical-edges
  Aug-17 = after activeCandidates / before DomainAwareAssembly

MODEL2_INSERTION_POINT_DRIFT = UNPROVEN
MODEL2_FAILURE_FALLS_THROUGH_TO_MODEL3 = YES

PILOT200_MULTI_CHAR_GENERALIZATION_REACHABLE = NO
PILOT200_RESPONSIBILITY_CONFLICT = YES

RESPONSIBILITY_GAP = YES
RESPONSIBILITY_OVERLAP = NO

ARCHITECTURE_DRIFT_CLASS = E. MULTIPLE

MODEL2_INSERTION_POINT_CORRECT = UNPROVEN
MODEL3_RESIDUAL_OWNERSHIP_CORRECT = YES
BASE_MISS_FALLBACK_SEMANTICS_CORRECT = YES
PILOT200_EXPECTATION_COMPATIBLE_WITH_PRODUCTION_ARCHITECTURE = NO
```

**STOP.** No code changes. Next owner is an explicit architecture decision on Model2 insertion SSOT, then either Pilot eval contract realignment or implementation repair to Aug-12 — not both silently.
