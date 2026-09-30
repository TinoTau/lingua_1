# Lingua FW Repair V4 — Single-Char Candidate Materialization / Routing Audit

**Date:** 2026-08-18  
**Stage:** FW_REPAIR_V4_CANDIDATE_MATERIALIZATION_SINGLE_CHAR_ROUTING_AUDIT  
**Type:** AUDIT ONLY / READ ONLY  
**Traces:** `recall_foundation_completion_2026_08_18/dialog200_after/` (no ASR rerun)  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_materialization_audit_2026_08_18/`

No lexicon / FineSpan / Model2 / budget / training / dialog_200 change.

---

## 0. P0 answer

`in_lexicon = 206` and `raw_hit = 206` and `union_materialized = 0` because **`raw_hit` was not a production recall hit**.

Previous R4 (`R4_base_raw_hit`) is `pta.existence(expected).in_base`: an **offline sqlite probe**. It does not mean Lattice queried that character or constructed a `WindowCandidate`.

**Label:** `TRACE_STAGE_SEMANTICS_MISMATCH`.

Production expected-surface hit on AFTER traces: **0 / 206**.  
Union: **0 / 206**.

The 155 `CANDIDATE_MATERIALIZATION_GAP` units are **154 length-1 + 1 length-2**. **0** remain true materialization gaps. All **155** reclassify to **QUERY_OR_ROUTING_GAP** (probe treated as raw hit; covering 1-char **fallback** FineSpans made R3 true).

This is **not** a generic candidate-materializer bug. 2-char true-recall in-lexicon units: **8 / 34** production+union hits.

---

## 1. Frozen design (§4–6)

Reconstructed from Lattice CR **1.0.2 / 1.0.3 / 1.0.4 / 1.0.8 (1.1C)** plus live code.

**Runtime location (§5):** Lattice **window** recall, then `WindowCandidate` bind. Not FineSpan-first, not fallback-as-recall, not a missing extra trigger.

| Item | Status |
|------|--------|
| Data design (2510) | completed previous round |
| Runtime routing | **implemented** (`collectBaseOnlySingleCharCandidate`) |
| `FROZEN_DESIGN_IMPLEMENTATION_MISSING` | **NO** |
| `FROZEN_CONTRACT_INCOMPLETE` | **NO** (CR 1.0.2 defines the route) |
| Passive LTR single-char path | **RETIRED** |
| Fallback binds lexicon hits | **NO** (by design) |

Length-1 **should** materialize only as unique tone-exact eligible **or** surface-exact of **ASR window text**. It is **not** designed to emit `没→莓` via homophone Top1.

---

## 2. 206 funnel (all units, no sample)

Population: true-recall length-1 **and** sqlite `in_base` (the previous 206).

FUNCTION_WORD_OR_SINGLE_CHAR units = **28** (separate responsibility; not in 206).

| Stage | n |
|-------|--:|
| S0 in lexicon / probe raw_hit | 206 |
| S1/S2 exact-aligned 1-char PathFineSpan on selected path | 164 |
| of those, `window_source=fallback` candidate_count=0 | 164 |
| lexical 1-char FineSpan covering the unit | **0** |
| S3 production expected-surface hit | **0** |
| S5 candidate constructed for expected | 0 |
| S11 union | 0 |
| S12 post-budget | 0 |

Entire AFTER run PathFineSpans with syllable length 1: **4157**, **all fallback**, **0 lexical**. Tone pattern present on 3876; absent on 281. So Fail-Closed `no_pattern` cannot be the only cause.

### Terminal classes (first production drop, sum=206)

| Class | n |
|-------|--:|
| HIT_REJECTED_BY_ROUTE | 164 |
| NO_VALID_SINGLE_CHAR_FINESPAN | 42 |
| all other spec classes | 0 |
| **SUM** | **206** |

- **164:** selected-path covering FineSpan is empty 1-char **fallback** → window collector produced no lexical edge. Frozen causes (need window-level fields to split): 1.1C fail-closed, LIMIT=8 uniqueness reject, surface-exact `word===windowText` miss (traditional ASR vs simplified lexicon), `minCandidateScore` null.
- **42:** covering FineSpan is a **2+ char lexical window** (e.g. 私环, 起点) or no cover → not an exact 1-char query on the selected path (`QUERY_GENERATION` boundary). Lattice still builds 1-char windows globally; they did not win the path.

`RAW_HIT_NOT_PRODUCTION` is the **metric diagnosis for all 206 previous R4**, not a 206-wide first-drop class (first drop is route/span above).

---

## 3. 155 gap

| | n |
|--|--:|
| Original CMG | 155 |
| Still true materialization (production hit, no WindowCandidate/union) | **0** |
| Reclassified QUERY_OR_ROUTING_GAP | **155** |
| Reclassified expected | 0 |
| 1-char | 154 |
| 2-char | 1 |
| 3-char / 4+ | 0 |

The one 2-char old-CMG row also had **probe** R4 and **no** production expected surface.

---

## 4. Length gates / merge / Model2

Lattice has **no** `if length < 2 return` on the V2 length-1 branch. Domain / idiom / fuzzy / LTR / IME still min=2 — frozen, not drift.

Merge/dedup/budget: **not reached** for expected 1-char surfaces.

This AFTER run: `p_retrieval` almost always `NOT_EXECUTED / NO_P_ACTION` (NO_PROFILE). D hits are multi-char domain terms and cannot bind to 1-char FineSpans (frozen exact-align). Model2 is not the 1-char materializer.

---

## 5. Trace sufficiency

Enough to prove: probe ≠ production; fallback vs lexical FineSpan; union surfaces; 2-char materializer works.

Missing (observation-only, no production logic change):

- per-window length-1 SQL hits
- `tone_recall_readiness` state
- uniqueness / truncation / surface-exact reject reason
- compact `originSpanId` on this AFTER snapshot

---

## 6. Conformance

| Item | Result |
|------|--------|
| Inventory 2510 | PASS |
| Base-only / exact-only / no fuzzy / no domain / cap=1 | PASS (code) |
| FineSpan binding | PASS (empty fallback by design when collector misses) |
| Candidate materializer | PASS (shared base binder; 2-char proves it) |
| Union integration | NOT_REACHED for expected 1-char |
| Assembly | NOT_REACHED |

---

## 7. Decision

Do **not** treat 206 sqlite rows as “hits the main chain failed to wrap.”

Do **not** change FineSpan, lexicon, Model2, budget, or recall algorithm in this round.

Next: **observation fields** on length-1 window recall so the 164 collector-misses can be split (tone vs uniqueness vs surface vs score). Only then decide whether a **RESTORE** of frozen collector behavior is needed vs working-as-designed empty fallback.
