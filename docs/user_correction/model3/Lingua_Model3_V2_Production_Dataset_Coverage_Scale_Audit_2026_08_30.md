# Lingua Model3 V2 Production Dataset Coverage & Scale Audit

**Phase:** `MODEL3_V2_PRODUCTION_DATASET_COVERAGE_SCALE_AUDIT`  
**Date:** 2026-08-30  
**Mode:** READ-ONLY AUDIT — no dataset rebuild · no training · no architecture change  

**Subject:** `MODEL3_V2_TARGETED_DIST_CORRECTED_V1`  
**Prerequisite status:** `PIPELINE_ACCEPTED=YES`, `DATASET_BUILD_VALID=YES` (Gate0 + formal B2 build QA passed)

---

================================
MAIN VERDICT
============

**Audit verdict:** `CURRENT_DATASET_VALID_BUT_PRODUCTION_SCALE_EXPANSION_REQUIRED`

| Question | Answer |
|----------|--------|
| Current dataset valid | **YES** |
| Sufficient for bounded experiment | **YES** |
| Sufficient for production-oriented training | **NO** |
| Expansion required | **YES** |
| Architecture change required | **NO** |

**Interpretation:** The current corpus is a **high-quality formal B2 seed / baseline** (280 independent semantic families). It proves pipeline correctness and supports a **bounded training experiment**, but it does **not** sample enough of daily conversational language space for production-oriented Model3 training. Error-family coverage is **structurally present** after alignment recompute (including multi-char, insertion, deletion, unequal-length), but several families remain **sparse at independent-region level**. Daily-conversation taxonomy coverage is **partial** in workplace, travel, customer-service, tech, family/social, and weather categories.

**Do not claim:** `PRODUCTION_MODEL_ACCEPTED` or `PRODUCTION_DATASET_ACCEPTED`.

---

## Required Decisions (D1–D15)

| ID | Decision |
|----|----------|
| **D1** | 280-family dataset **not sufficient** for production-oriented training |
| **D2** | **Sufficient** for a bounded training experiment (formal split, multipath, cand non-collapse, RETRY+cand>0) |
| **D3** | Real multi-char / insertion / deletion families **are represented** in alignment-derived regions; INSERTION/DELETION remain **partially represented** (sparse vs SUBSTITUTION/MULTI_CHAR); prior build metadata `corruptionFamily=SUBSTITUTION-only` is a **taxonomy/metadata gap**, not proof of absence |
| **D4** | Largest gaps: **scale** (280 vs ~19k usable pool families), **sparse conversation categories** (workplace/travel/CS/tech/family/weather), **question-form diversity**, **acoustic/speaker diversity**, **TAIL RETRY utterance coverage** |
| **D5** | Source pool `model3_certified_base_pool_v2`: **22,177 lines**, **~18,994 usable unique families/texts** after holdout/Gate0/length filters; avg ~20.2 CJK chars |
| **D6** | **Expand dataset before** any serious production-oriented training |
| **D7** | Recommended range: **5,000–25,000 unique semantic families / utterances** (primary unit) |
| **D8** | Justified by: pool capacity >>280, vocabulary sampled <<1% of pool char space, daily-conversation taxonomy partial, small-model capacity OK at that scale, observed B2 throughput makes staged expansion feasible |
| **D9** | **Staged expansion:** S0=280 (current) → S1≈1k → S2≈5k → S3≈25k → S4 long-tail |
| **D10** | Old RealDist: **pretrain / A-B init only**, not formal merge; synthetic V1: **reject** |
| **D11** | **Controlled A/B** (random-init vs RealDist init on same formal split) — best causal evidence; costs one extra run |
| **D12** | Acoustic diversity **adequate for pipeline proof**, **not adequate for production** (single `piper_tts` identity, no authorized speaker/accent variation) |
| **D13** | Pronunciation/accent expansion: **later phase**, only via closed-loop B2; not authorized now |
| **D14** | Multi-PC sharding: **feasible** (current 5-shard build already demonstrates invariants) |
| **D15** | Materialization cost: ~**4.4 s/utterance** end-to-end; see Scale Options table |

---

================================
CURRENT DATASET REAL SIZE
=========================

| Unit | Count | Role |
|------|------:|------|
| **Semantic families** | **280** | **Primary independent linguistic diversity unit** |
| **Utterances** | **280** | 1:1 with families in this build |
| **Audio realizations** | **280** | Formal fresh B2 (`piper_tts` → ASR/Tone/Recall) |
| **SegmentationPaths** | **849** | Acoustic/lattice path multiplicity (not independent language) |
| **Path-level samples** | **849** | One row per path |
| **span×path samples** | **14,632** | Training rows (KEEP 13,259 / RETRY 865 / MASKED 508) |
| **Unique malformed regions** | **422** | Independent alignment errors (reference ↔ current) |
| **Utterances with malformed regions** | **237** | |
| **RETRY span×path rows** | **865** | Supervision rows (multipath-inflated vs 422 regions) |
| **RETRY-linked region×path rows** | **570** | Spans mapped to overlapping alignment regions |

**Critical distinction:** 14,632 span×path samples ≠ 14,632 independent linguistic examples. **280 semantic families** is the correct scale anchor for production planning.

---

================================
REAL ERROR FAMILY COVERAGE
==========================

**Method:** Recomputed from `referenceText` ↔ `currentText` using authoritative `derive_malformed_regions` (`stage2_v2_label.py`). Diagnostic classification only; **V2 labels unchanged**. Prior build metadata tagged all 865 RETRY spans as `SUBSTITUTION`; alignment recompute shows **mixed families**.

| Family | Unique families | Unique utterances | Unique malformed regions | span×path RETRY | Assessment |
|--------|----------------:|------------------:|-------------------------:|----------------:|------------|
| SUBSTITUTION | 116 | 116 | 139 | 278 | **Well represented** |
| MULTI_CHAR_REPLACEMENT | 47 | 47 | 50 | 307 | **Well represented** (supervision > regions due to multipath) |
| INSERTION | 27 | 27 | 29 | 183 | **Partially represented** |
| DELETION | 135 | 135 | 204 | 97 | **Partially represented** (regions abundant; RETRY supervision sparser) |
| PHONETIC_LIKE (diagnostic) | — | — | majority of 1-char SUBSTITUTION | — | **Present** (same-length single-char replaces) |

**vs historical real Model3 failures:**

| Historical family | Status |
|-------------------|--------|
| MULTI_CHAR_REPLACEMENT | **Present** (50 regions; e.g. surface `现`, `分`, multi-char ASR chunks) |
| INSERTION | **Partially present** (29 regions; unequal-length exercised) |
| DELETION | **Partially present** (204 regions; fewer RETRY labels than regions) |
| PHONETIC (local) | **Present** via natural ASR single-char substitution |
| HEAD/MID weakness (historical) | **Structurally improved** vs tiny pilots; TAIL utterance RETRY still weakest |

**Verdict on Q1:** The 865 RETRY samples **do cover** real error families at span level, but **independent-region counts** show INSERTION/DELETION are not as richly supervised as substitution/multi-char. This is **coverage density**, not pipeline failure.

---

================================
ERROR REGION LENGTH
===================

| Length (current region) | Unique regions | Families with such regions |
|-------------------------|---------------:|---------------------------:|
| 1 char | 332 | 202 |
| 2 chars | 60 | 53 |
| 3 chars | 22 | 21 |
| 4 chars | 2 | 2 |
| 5+ chars | 6 | 6 |

**Unequal-length regions:** **237** (56% of 422 regions; **153 families**)  
**Assessment:** V2 unequal-length contract is **exercised** (`lengthChanging=True`). Not an architecture gap — **DATA_COVERAGE_GAP** only if production needs more 4–5+ char error diversity (currently sparse).

---

================================
POSITION COVERAGE
=================

### Malformed regions (alignment-derived)

| Position | Unique regions | Unique utterances |
|----------|---------------:|------------------:|
| HEAD | 114 | 101 |
| MID | 213 | 162 |
| TAIL | 95 | 83 |

### RETRY supervision (unique utterances)

| Position | Unique utterances with RETRY |
|----------|-----------------------------:|
| HEAD | 63 |
| MID | 94 |
| TAIL | 33 |

### RETRY span×path rows (multipath-inflated)

| Position | Rows |
|----------|-----:|
| HEAD | 294 |
| MID | 406 |
| TAIL | 165 |

**Assessment:** MID best covered; **TAIL remains weakest** at utterance level (33 vs 94 MID). Historical HEAD weakness **partially addressed** but not production-complete.

---

================================
CONTEXT / ANCHOR COVERAGE
=========================

| Anchor / context signal | Count / note |
|-------------------------|--------------|
| Span rows NONE anchor | 14,124 |
| MODEL2 anchor spans | 345 |
| DOMAIN_AND_MODEL2 | 134 |
| DOMAIN-only | 29 |
| Four anchor states present | **YES** |
| RETRY near anchor (NONE context) | 357 span rows |
| RETRY with no anchor context | 508 span rows |
| Multipath utterances | 189 / 280 |
| RETRY+cand>0 utterances | 116 |

**Assessment:** Anchor **taxonomy exercised**; DOMAIN-only still sparse (consistent with build warning). Most RETRY spans sit in **non-anchor** contexts — appropriate for Model3 scope. Multiple suspicious local regions appear via multipath + multi-region utterances.

---

================================
DAILY CONVERSATION COVERAGE
===========================

Keyword-derived taxonomy from reference text (framework, not runtime domain schema):

| Category | Current families | Assessment | Gap |
|----------|----------------:|------------|-----|
| casual | 227 | good | — |
| negation | 215 | good | — |
| confirmation | 132 | good | — |
| daily_request | 95 | good | — |
| numbers_quantities | 78 | good | — |
| shopping_food | 70 | good | — |
| time_dates | 66 | good | — |
| scheduling | 53 | good | — |
| correction_clarify | 44 | good | — |
| question | 32 | partial | more interrogative forms |
| transport | 23 | partial | navigation depth |
| names_places | 17 | partial | NE diversity |
| customer_service | 7 | **sparse** | CS dialog patterns |
| travel_hotel | 6 | **sparse** | travel/accommodation |
| tech_device | 6 | **sparse** | device/IT talk |
| workplace | 3 | **sparse** | meetings/projects |
| family_social | 3 | **sparse** | social dialog |
| weather_plans | 2 | **sparse** | weather/planning |

**Source pool bias:** Dominated by `MODEL3_SPOKEN_BASE_SUPPLEMENT_V1` (17,222) + `prior_certified_v1` (4,955). Pool **can** support broader taxonomy once scaled; current 280-family slice **over-represents** confirmation/negation/casual vs workplace/travel/tech.

---

================================
LINGUISTIC DIVERSITY
====================

| Dimension | Current (280) | Assessment |
|-----------|---------------|------------|
| Utterance length | short 1,759 / medium 9,318 / long 7,917 **in pool**; current build mixed | pool OK; sample small |
| Questions | 32 families keyword-hit | partial |
| Imperatives / requests | daily_request 95 | moderate |
| Negation | 215 | good |
| Numbers / time | 78 / 66 | moderate |
| Named entities / places | 17 | sparse |
| Colloquial / particles | present via spoken-base supplement | limited by N |
| Domain terminology | tech/workplace sparse in sample | gap |

**Assessment:** Linguistic **patterns exist** in source pool; current dataset **under-samples** long-tail structures and several conversational intents.

---

================================
VOCABULARY COVERAGE
===================

| Metric | Current 280 | Source pool (usable) | Sampling ratio |
|--------|------------:|---------------------:|---------------:|
| Unique CJK chars (reference) | **395** | ≫395 (not fully enumerated this audit) | ≪1% of pool lexical space |
| Unique bigrams | **1,183** | — | small slice |
| Utterances | 280 | **18,994** | **1.5%** |

Path duplication **does not** increase vocabulary diversity. Expansion should prioritize **new semantic families**, not multipath duplication alone.

---

================================
SOURCE POOL CAPACITY
====================

| Source | Families / texts | Quality | Bias | Usable for expansion |
|--------|-----------------:|---------|------|----------------------|
| `model3_certified_base_pool_v2` | 22,177 lines → **18,994** usable unique | spoken conversational Chinese; length-filtered | supplement-heavy; not uniform taxonomy | **YES** (primary) |
| Gate0 acceptance batch | 48 excluded | formal proven | held out from training | diagnostic only |
| Protected holdout | 0 skipped in count | — | — | excluded |

**Near-duplicate policy:** semantic-family dedup + text dedup already in pool selection.  
**Audio:** B2 materialization generates fresh audio per utterance (`piper_tts`).  
**Reference suitability:** clean spoken-style references suitable for closed-loop B2.

---

================================
SURFACE SHORTCUT RISK
=====================

Build QA identified **27 high-support KEEP/RETRY contrast surfaces** and **40 one-sided suspicious surfaces** (e.g. `我/这/一/是` KEEP-only).

| Surface type | Example | Families (build QA) | Risk |
|--------------|---------|--------------------:|------|
| Contrast | `不` KEEP 470 / RETRY 8 | 132 | low entropy but cross-family — **legitimate frequency asymmetry** |
| Contrast | `现` KEEP 77 / RETRY 38 | 23 | higher entropy — OK |
| One-sided | `我` KEEP 645 / RETRY 0 | 174 | **natural high-freq function word** — monitor, do not blacklist |
| One-sided RETRY | `棒` RETRY 22 / KEEP 0 | small | low support — watch |

**Proposed QA metric (future):** `shortcut_risk_score = f(support, label_entropy, family_diversity, position_diversity, anchor_context_diversity)` — flag when high support + low entropy + low family spread. **Not a Model3 feature.**

**Action:** No blacklist / no label fabrication. Expand corpus breadth to reduce spurious surface correlation.

---

================================
ACOUSTIC DIVERSITY
==================

| Dimension | Current formal route | Assessment |
|-----------|---------------------|------------|
| Materializer | `piper_tts` (all shards) | single engine identity |
| Speaker diversity | not varied in manifest | **narrow** |
| Speaking rate / prosody | TTS-default | **narrow** |
| Sentence length | follows reference (10–36 CJK) | moderate |
| ASR error realism | closed-loop FW VAD | **valid** but conditioned on one TTS voice |
| Purpose | generate upstream ASR/Tone/Recall states | OK for S0/S1; **insufficient for S3 production acoustic breadth** |

**Recommendation:** Future layer `ACOUSTIC_VARIATION` (authorized voices/rates) via same B2 closed loop — **later phase**, not now.

---

================================
OLD DATASET REUSE
=================

| Dataset | Classification | Reason |
|---------|------------------|--------|
| `MODEL3_V2_TARGETED_DIST_CORRECTED_V1` | **SAFE_FOR_FORMAL_TRAINING** | current formal B2 baseline |
| `MODEL3_V2_REALDIST_EXPANDED_V1` | **SAFE_ONLY_FOR_PRETRAIN / A-B init** | synthetic/collapse history; distribution mismatch risk if merged |
| `MODEL3_V2_LABELED` / text-only relabels | **DIAGNOSTIC_ONLY** | no acoustic provenance |
| `MODEL3_V1_SYNTHETIC_100K` | **REJECT_FOR_FORMAL_TRAINING** | planned corruption, non-B2 |

**Do not auto-concatenate** old corpora into formal training.

---

================================
SCALE OPTIONS
=============

Observed throughput: Gate0 **48 utt / 230.9 s** (4.81 s/utt); targeted build **280 utt / ~1224 s** (~4.37 s/utt). Planning uses **~4.4 s/utt**, **~52 span×path samples/utt**.

| Stage | Unique families/utterances | Est. span×path | Wall time (1 PC) | Purpose |
|-------|---------------------------:|---------------:|-----------------:|---------|
| S0 | 280 (current) | 14,632 | ~0.3 h | pipeline proof ✓ |
| S1 | 1,000 | ~52k | ~1.2 h | training feasibility |
| S2 | 5,000 | ~261k | ~6.1 h | broad daily conversation core |
| S2b | 10,000 | ~522k | ~12.2 h | conversation expansion |
| S3 | 25,000 | ~1.3M | ~30.6 h (~1.3 d) | production-oriented |
| S4 | 50,000–100,000 | 2.6M–5.2M | 2.5–5 d | long-tail (if pool + QA extended) |

**Storage / GPU:** dominated by lattice/ASR/Tone artifacts during build; training storage modest vs materialization scratch. **4-PC parallel** ≈ quarter wall time if shards frozen independently.

---

================================
RECOMMENDED PRODUCTION SCALE
============================

**Recommended range:** **5,000 – 25,000 unique semantic families / utterances**

**Unit:** UNIQUE SEMANTIC FAMILIES (≈ utterances 1:1 under current selection policy)

**Reason:**
1. Pool supplies **~19k** usable families without new external corpus  
2. Current **395** chars / **280** intents ≪ daily conversation breadth  
3. Error families present but need **density** across families, especially INSERTION/DELETION/TAIL  
4. Small BiGRU (emb 64, hidden 128) remains **reasonable** at S2–S3 — **DATA FIRST**, not model upsizing  
5. B2 cost at 25k ≈ **1.3 GPU-days** single machine — acceptable vs production goal  

---

================================
EXPANSION STRATEGY
==================

```
broad reference pool (model3_certified_base_pool_v2)
  → semantic-family dedup
  → holdout / Gate0 exclusion
  → deterministic shard freeze (seed + shard map)
  → formal B2 materialization (no planned corruption)
  → existing QA + shortcut metric
  → merge + split lock
```

**Rules:**
- Select for **broad conversational diversity**, not known failing cases  
- Do **not** target RETRY ratio  
- Optional future: LLM-generated **clean reference text only** → same B2 loop  
- Layer management (maintainability): `CORE_DAILY_CONVERSATION`, `DOMAIN_CONVERSATION`, `LONG_TAIL`, `ACOUSTIC_VARIATION`, `REAL_AUDIO_REFERENCE` — **dataset layers only**, not runtime Domain features  

**Real audio:** Hybrid long-term — B2 TTS for scale/closed-loop; authorized real audio as **separate provenance layer** for accent realism (privacy/cost tradeoff). **No collection now.**

---

================================
MULTI-PC MATERIALIZATION
========================

**Feasible:** **YES**

Current build already used **5 independent shards** (`s00`–`s04`, 56 utt each) with merge QA.

**Required invariants:**
- Frozen source shard before outcomes  
- Stable `semanticFamilyId`  
- Independent `materializationRunId` per utterance  
- Same feature/label/provenance/model/config identities  
- Deterministic split ownership (`assign_split` on family)  
- Merge-time QA (holdout, family leak, candidate collapse, shortcut surfaces)  

TTS/ASR/Tone stages **can** run per shard on separate machines; Model2 batch host per shard as today.

---

================================
TRAINING STRATEGY
=================

| Option | Pros | Risks |
|--------|------|-------|
| **A. Random-init** on formal dataset | cleanest provenance story | 280 families may overfit surface shortcuts |
| **B. Continue RealDist** | faster convergence | synthetic shortcut / distribution bias may persist |
| **C. Controlled A/B** | causal comparison on same split | +1 training run cost |

**Recommended:** **C (controlled A/B)** on current 280 or post-S1 expanded set — same split, same config, compare init only. If expansion lands at S2+, prefer **random-init primary** with RealDist as optional ablation.

**Model capacity:** keep current small BiGRU until learning curve plateaus on expanded data.

---

================================
LEARNING CURVE PLAN
===================

| Checkpoint | Families | Evaluate |
|------------|---------:|----------|
| S0 | 280 | baseline (current) |
| S1 | 1,000 | shortcut behavior, RETRY family recall, overfit signals |
| S2 | 5,000 | protected real inventory, HEAD/MID/TAIL |
| S3 | 25,000 | production-oriented generalization gate |
| S4 | 50k+ | long-tail diminishing returns |

Metrics at each: synthetic held-out, protected real cases, KEEP controls, RETRY family recall, surface shortcut score, latency. **Stop adding data** when protected-real metrics plateau.

---

================================
GOVERNANCE
==========

| Item | Changed |
|------|---------|
| Model3 | **NO** |
| Features | **NO** |
| Labels | **NO** |
| Threshold | **NO** |
| Tone / Recall / FineSpan / Model2 / Domain / Anchor / Retry / JobResult | **NO** |
| Dataset modified | **NO** |
| Training executed | **NO** |

---

================================
NEXT PHASE
==========

**Exactly one:** `MODEL3_V2_PRODUCTION_DATASET_EXPANSION_DESIGN`

**Do not execute** in this audit.

---

## Artifacts (8)

| # | File |
|---|------|
| 1 | `Lingua_Model3_V2_Production_Dataset_Coverage_Scale_Audit_2026_08_30.md` (this report) |
| 2 | `model3_v2_real_error_family_coverage.csv` |
| 3 | `model3_v2_daily_conversation_coverage.csv` |
| 4 | `model3_v2_source_pool_capacity.csv` |
| 5 | `model3_v2_surface_shortcut_risk.csv` |
| 6 | `model3_v2_scale_cost_options.csv` |
| 7 | `model3_v2_production_dataset_audit_summary.json` |
| 8 | `model3_v2_vocabulary_linguistic_coverage.csv` |
| 9 | `model3_v2_old_dataset_reuse_matrix.csv` |

---

## Checklist (phase complete)

- [x] Current dataset treated as valid seed  
- [x] 280 families distinguished from 14,632 span rows  
- [x] RETRY taxonomy recomputed via `derive_malformed_regions`  
- [x] Unique malformed regions counted (422)  
- [x] Multipath inflation separated  
- [x] Multi-char / insertion / deletion / unequal-length measured  
- [x] HEAD/MID/TAIL measured (utterance + region levels)  
- [x] Anchor context measured  
- [x] Daily conversation taxonomy audited  
- [x] Vocabulary + source pool capacity measured  
- [x] Surface shortcut risk audited + metric proposed  
- [x] Acoustic diversity audited (piper_tts concentration)  
- [x] Old datasets classified  
- [x] Production scale in unique families/utterances  
- [x] Materialization cost + multi-PC feasibility  
- [x] Staged expansion + learning curve designed  
- [x] Training init strategy recommended  
- [x] Exactly one verdict + next phase  
- [x] No dataset mutation / training / architecture change  
