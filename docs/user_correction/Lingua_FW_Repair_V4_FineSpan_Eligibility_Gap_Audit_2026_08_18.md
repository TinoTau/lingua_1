# Lingua FW Repair V4 — FineSpan Eligibility Gap Audit

**Date:** 2026-08-18  
**Stage:** FINESPAN_ELIGIBILITY_GAP_AUDIT (READ ONLY)  
**Input:** MATERIALIZABLE_TARGET_V1 reanalysis of Stage-J 200/200 traces  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/materializable_target_v1_2026_08_18/`

Do not treat legacy 97→59 as the gap. Recompute first.

---

## 1. Authoritative LEXICAL → PATH gap

| | Dialogs requiring correction | Correction units |
|--|--:|--:|
| Lexical recoverable | 6 | 36 |
| Path recoverable | 1 | 33 |
| **Gap** | **5** | **10** |

All 10 gap units were audited (not sampled).

Partial-any-unit (not strict): 30 dialogs have ≥1 lexical unit; 25 have ≥1 path unit.

---

## 2. Gap classification (10 units)

| Class | N |
|-------|--:|
| NO_FINESPAN_COVERAGE | 9 |
| CANDIDATE_BOUND_TO_WRONG_SPAN | 1 |
| RANGE_MISMATCH | 0 |
| PARENT_FRAGMENT_MISMATCH | 0 |
| PARTIAL_COVERAGE_ONLY | 0 |
| OVERLAP_PATH_CONFLICT | 0 |
| ELIGIBILITY_RULE_REJECT | 0 |
| EXPECTED_REJECTION (frozen exact-align) | see §4 |
| OTHER | 0 |

Length change: **10/10 same length**. Not a 2→3 / 3→2 offset cluster.

Provenance: **9 PROFILE_DOMAIN (Model2 D)** / **1 BASE**. Gap is **not** Base-only; Model2 D bindings dominate.

Eligibility itself is domain-blind → **no OWNERSHIP_DRIFT**.

---

## 3. What the 10 units actually are

Repeated pattern (d002 / d047 / d137 / d182 「大背」→「大杯」; d031 / d121 / d166 「预定」→「预订」; d183 「少病/小备」):

1. Lattice **PathFineSpan** materializes **1-character fallback** edges (`window_source=fallback`) for the error site (`背`, `定`).
2. Lexical candidate is **2 characters** (`大杯`, `预订`, `少冰`).
3. Frozen eligibility requires candidate syllable/raw range **exactly equal** to that PathFineSpan → a 2-char window has **no matching PathFineSpan**.
4. Model2 D still **introduces** the 2-char term, but `candidateId` is `m2d:{wrong_1char_span}` (e.g. `大杯` bound to FineSpan 「帮」, pinyin `bang`). That is **CANDIDATE_BOUND_TO_WRONG_SPAN**.
5. Compact D `hits[]` often **lack `candidateId`** → `MISSING_TRACE_FIELD` / TRACE_BINDING_ERROR for those rows.

d090: base candidate `上线` (`14:16:1`) is eligible on FineSpan 「上限」 at a **later** occurrence, not on the first 「限」→「线」 site → bound to wrong span.

---

## 4. Why ranges differ (not auto-bug)

| Hypothesis | Verdict |
|------------|---------|
| FineSpan “cut wrong” vs expected word | Path edges are 1-char fallbacks; 2-char recall windows exist at Recall but are **not** the Assembly FineSpan |
| Candidate bound wrong | **YES** for Model2 D `m2d:` onto unrelated 1-char span |
| Offset / UTF-16 bug | **NO** — length-change 0; indices match raw |
| parent_fragment coverage | Production `parentFragmentTopK` **RETIRED**; 0 gap units classified PARENT_FRAGMENT_MISMATCH |
| Expected frozen rejection | **YES**: exact FineSpan alignment **cannot** apply a 2-char replacement to a 1-char PathFineSpan |

This is **EXPECTED CONTRACT REJECTION** plus **wrong-span D binding**, not proof that streaming FineSpan design is invalid.

---

## 5. Streaming FineSpan conformance (read-only)

| Item | Result |
|------|--------|
| Streaming FineSpan / lattice path | **PASS** (`runSpanAssemblyV4Orchestrator` + lattice) |
| Coarse boundary soft | **PASS** (`lattice-hard-block-filter` does not hard-block `boundaryCrossCount` alone) |
| Overlap semantics | **PASS** (PathFineSpan non-overlap invariant; Assembly `rawOverlap`) |
| Backtracking | **PASS** (Assembly subset DFS; lattice path caps ≠ old beam) |
| Legacy span path | **NO** |
| Detector residue | **NO** |
| Hidden extra eligibility gate | **NO** — exact alignment is the frozen gate |
| parent_fragment recall | **RETIRED** |

**FINESPAN_ASSEMBLY_CONTRACT_DRIFT:** not found as a second hidden algorithm. Tension is: **PathFineSpan 1-char fallback vs multi-char lexicon terms**.

---

## 6. Missing trace fields (do not rerun ASR this round)

`compactCandidate` omits `rawStart` / `syllableStart` / `hitKind` / `repairTarget`.  
D retrieval `hits` omit `candidateId`. Binding is reconstructed. Documented as `MISSING_TRACE_FIELD`. Observation-only fields may be added later **without** changing ranking.

---

## 7. Guardrail

Gap existence ≠ FineSpan design error.

| Bucket | This audit |
|--------|------------|
| TRACE_BINDING_ERROR | D hits without candidateId; compact span fields missing |
| IMPLEMENTATION_DRIFT | D attaching 2-char terms to unrelated 1-char FineSpan |
| DATA / OFFSET ERROR | Not observed |
| EXPECTED CONTRACT REJECTION | 2-char term vs 1-char PathFineSpan exact-align |
| FROZEN DESIGN LIMITATION | Possible **if** 1-char path edges systematically block multi-char repairs — **not** proven as the global bottleneck (only 10 units vs 552 lexical misses) |

**Architecture Change Proposal: NO** this round.

---

## 8. Assembly revalidation

Previous TRUE_ASSEMBLY_DROP 24 → V1 **TRUE_ASSEMBLY_MATERIALIZATION_FAILURE = 0**.  
d002 / d047 fail **before** Assembly (no eligible spanning FineSpan). Do not open Assembly implementation fix on that evidence.

---

## 9. Recommended next phase

Largest failure class is **LEXICAL_RECALL_MISS (169 / 175)**.

**Recommended Next Phase: RECALL_AUDIT**

FineSpan/eligibility remains a **secondary** 10-unit issue (Model2 D wrong-span + 1-char path edges). No FineSpan production fix this round.
