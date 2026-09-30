# Lingua Model3 V2 Production Dataset Expansion Design

**Phase:** `MODEL3_V2_PRODUCTION_DATASET_EXPANSION_DESIGN`  
**Date:** 2026-08-30  
**Mode:** READ-ONLY DESIGN — no bulk generation · no training · no architecture change  

**Parent audit:** `CURRENT_DATASET_VALID_BUT_PRODUCTION_SCALE_EXPANSION_REQUIRED`  
**Formal seed:** `MODEL3_V2_TARGETED_DIST_CORRECTED_V1` (280 families — unchanged)

---

================================
MAIN VERDICT
============

**Expansion design verdict:** `PRODUCTION_DATASET_EXPANSION_DESIGN_READY_WITH_NONBLOCKING_WARNINGS`

| Question | Answer |
|----------|--------|
| Ready for bulk expansion | **NO** (blocked on normal acoustic variation infra) |
| Current pool sufficient for S1 (~1k) | **YES** |
| Current pool sufficient for S2 (~5k) | **YES** |
| Current pool sufficient for S3 (~10k) | **YES** |
| Current pool sufficient for S3b (ceiling) | **YES** (~18,994 families) |
| Need new reference source | **LATER** (only for S4 / 25k+) |
| Acoustic variation ready | **NO** |
| Architecture change required | **NO** |

**Non-blocking warnings:**
1. `NORMAL_ACOUSTIC_VARIATION_INFRASTRUCTURE_GAP` — B2 materializer uses single default Piper voice; no authorized multi-speaker materialization path yet  
2. Source pool dominated by `MODEL3_SPOKEN_BASE_SUPPLEMENT_V1` (~90%)  
3. Taxonomy uses transparent keyword rules — adequate for selection design, not semantic gold standard  
4. Full-pool sparse categories: `family_social`, `weather_plans` (<0.5% each)

---

## Required Decisions (D1–D20)

| ID | Answer |
|----|--------|
| **D1** | Exact usable pool: **18,994** unique semantic families (recomputed) |
| **D2** | Full-pool taxonomy: see table below; negation/casual/confirmation dominate keyword hits |
| **D3** | Truly sparse in full pool: **family_social (60)**, **weather_plans (74)**; partial: workplace, travel, hotel, customer_service, tech |
| **D4** | Pool vocabulary: **1,059** CJK chars, **6,520** bigrams, **11,850** trigrams; seed covers **37.3%** chars, **18.4%** bigrams |
| **D5** | **Yes — material bias:** supplement source **90.45%** of usable pool |
| **D6** | Max production core from current pool: **18,994 families** (not 25k) |
| **D7** | Stages: S0=280 → S1=1k → S2=5k → S3=10k → **S3b=18,994** → S4=25k+ requires new sources |
| **D8** | First **serious** training scale: **S2 (~5k)** recommended checkpoint, not hard gate |
| **D9** | **10k** recommended before production-oriented model decision — via learning curve, not fixed rule |
| **D10** | **25k+** justified only after learning-curve plateau **and** authorized new reference sources |
| **D11** | TTS adequate speaker diversity: **NO** (single authorized B2 voice) |
| **D12** | Normal acoustic strategy: 1 primary voice for S1 feasibility; add 2nd voice on **20–30% deterministic subset** after infra ready |
| **D13** | Acoustic realizations per family: **1 primary + 0–1 secondary (max 2)** |
| **D14** | Secondary variants: **subset only**, not all references × all voices |
| **D15** | Pronunciation-error perturbation: separate future phase after normal variation + learning-curve evidence |
| **D16** | Multi-PC expansion: **YES**, feasible with frozen shards |
| **D17** | Workers must match: ASR, Tone, lexicon, Model2, normalization, feature packer, label + provenance contracts |
| **D18** | Cost: see `model3_v2_expansion_scale_plan.csv` (e.g. S2 5k ≈ 6.1h @1 worker, 1.7h @4 workers) |
| **D19** | V1 seed: **versioned frozen lineage parent**; never mutate in place; S1+ are new dataset IDs |
| **D20** | Next phase: **`MODEL3_V2_NORMAL_ACOUSTIC_VARIATION_PREPARATION`** |

---

================================
FULL SOURCE POOL
================

| Metric | Value |
|--------|------:|
| Raw lines | 22,177 |
| **Usable unique semantic families** | **18,994** |
| Gate0 excluded | 48 |
| Length-invalid excluded | 3,120 |
| Spoken-prefix-short excluded | 15 |
| Avg CJK length | 20.23 |
| Median CJK length | 21 |
| Multi-label categories per family (avg) | 4.22 |

**Dedup / filter chain (same as formal build):** holdout registry → Gate0 exclusion → dialog200 exclusion → CJK 10–36 / len≤48 → spoken-prefix filter → semantic-family + exact-text dedup via `select_pool_candidates`.

**Important:** Prior estimate ~18,994 **confirmed** as authoritative current value.

---

================================
FULL DAILY-CONVERSATION PROFILE
===============================

Multi-label keyword taxonomy (dataset-management only; **not** runtime Domain / Model3 features).

| Category | Families | Pool % | Avg len | Question rate | Assessment |
|----------|--------:|-------:|--------:|--------------:|------------|
| casual_social | 15,396 | 81.1% | 21.2 | 0.68 | good (keyword-broad) |
| negation | 13,711 | 72.2% | 21.1 | 0.73 | good (high overlap) |
| confirmation | 9,174 | 48.3% | 21.5 | 0.76 | good |
| daily_request | 7,037 | 37.1% | 20.9 | 0.57 | good |
| time_dates | 6,053 | 31.9% | 20.3 | 0.55 | good |
| numbers_quantities | 5,118 | 26.9% | 21.6 | 0.56 | good |
| shopping_food | 5,056 | 26.6% | 20.7 | 0.56 | good |
| scheduling | 4,074 | 21.5% | 20.9 | 0.56 | good |
| answer | 3,524 | 18.6% | 20.0 | 0.68 | good |
| correction_clarify | 2,737 | 14.4% | 24.6 | 0.60 | good |
| question | 2,319 | 12.2% | 19.2 | 0.78 | good |
| transport | 1,576 | 8.3% | 20.1 | 0.70 | good |
| names_places | 1,190 | 6.3% | 20.1 | 0.66 | good |
| tech_device | 644 | 3.4% | 20.4 | 0.86 | partial |
| customer_service | 565 | 3.0% | 19.4 | 0.69 | partial |
| workplace | 435 | 2.3% | 15.9 | 0.40 | partial |
| travel | 272 | 1.4% | 16.9 | 0.83 | partial |
| hotel | 207 | 1.1% | 20.1 | 0.03 | partial |
| weather_plans | 74 | 0.39% | 11.3 | 0.00 | **sparse** |
| family_social | 60 | 0.32% | 10.6 | 1.00 | **sparse** |

**Taxonomy method:** Transparent keyword rules + `spoken_like_class` metadata available but not used as primary classifier.  
**Confidence limits:** High overlap (negation/confirmation/casual share function words). Spot audit found plausible matches for workplace/travel/tech; `weather_plans` samples include template-like false positives (e.g. “天气不错我们去…走走”).  
**Conclusion:** Keyword taxonomy **sufficient for stratified selection floors**; not sufficient as semantic SSOT. Future QA should spot-audit per build shard.

---

================================
LINGUISTIC PROFILE
==================

| Structure | Utterances (pool) | Notes |
|-----------|------------------:|-------|
| Question-like | 10,916 | Strong coverage |
| Imperative/request-like | 5,464 | Good |
| Statement-only (no Q/imp hit) | 5,017 | Good |
| Negation | 13,711 | Keyword-broad |
| Modal expressions | 7,757 | Good |
| Short (CJK <14) | 1,759 (9.3%) | |
| Medium (14–21) | 9,318 (49.1%) | |
| Long (≥22) | 7,917 (41.7%) | |
| Time expressions | 6,053 | Good |
| Quantity expressions | 5,117 | Good |
| NE-like lexical | 1,745 | Moderate |
| Multi-clause | 11,036 | Good |
| ASCII digits in text | 0 | Pool uses Chinese numerals / 三点 style |

**Gaps vs daily conversation product:** family/social and weather intents underrepresented at source level; workplace/travel/hotel present but thinner than food/scheduling templates.

---

================================
VOCABULARY PROFILE
==================

| Metric | 280 seed | Full usable pool | Seed / pool |
|--------|---------:|-----------------:|------------:|
| Unique CJK chars | 395 | **1,059** | **37.3%** |
| Unique bigrams | 1,201 | **6,520** | **18.4%** |
| Unique trigrams | 1,774 | **11,850** | 15.0% |
| Long-tail hapax chars | — | 242 | — |

**Corrected claim:** Seed vocabulary is a **measured minority slice** of pool char/bigram space — not an unsupported guess.

---

================================
SOURCE BIAS
===========

| Source | Families | Share |
|--------|---------:|------:|
| MODEL3_SPOKEN_BASE_SUPPLEMENT_V1 | 17,181 | **90.45%** |
| prior_certified_v1 | 1,813 | 9.55% |

**Does one source dominate?** **YES.** Production expansion must apply **source-diversity caps** in selection (PROVISIONAL: no single source >85% of a stage draw) to avoid cloning supplement template statistics.  
**Lexical concentration:** Supplement templates drive scheduling/food/confirmation patterns; `prior_certified_v1` adds shorter workplace-like fragments.

---

================================
CURRENT POOL SCALE CEILING
==========================

| Scale tier | Families | Reachable from current pool? |
|------------|---------:|:----------------------------:|
| S0 seed | 280 | ✓ (built) |
| S1 | 1,000 | ✓ |
| S2 | 5,000 | ✓ |
| S3 | 10,000 | ✓ |
| **S3b ceiling** | **18,994** | ✓ **max without new sources** |
| S4 | 25,000+ | ✗ requires **new reference sources** |

**Do not describe 25k as reachable from current pool.**

---

================================
STAGED EXPANSION
================

Primary unit: **unique semantic families / utterances** (split-locked 80/10/10).

| Stage | Families | Est. paths | Est. span×path | Train/dev/test families | Purpose |
|-------|---------:|-----------:|---------------:|------------------------|---------|
| S0 | 280 | 849 | 14,632 | 224/28/28 | Formal seed (frozen) |
| S1 | 1,000 | ~3,030 | ~52k | 800/100/100 | Training feasibility |
| S2 | 5,000 | ~15,149 | ~261k | 4000/500/500 | First serious scale |
| S3 | 10,000 | ~30,299 | ~522k | 8000/1000/1000 | Production-oriented core |
| S3b | 18,994 | ~57,551 | ~991k | 15195/1899/1899 | Current pool ceiling |
| S4 | 25,000+ | — | — | — | Future sources only |

**Compute (primary realization, ~4.4 s/utt):**

| Stage | 1 worker | 2 workers (~0.92 eff) | 4 workers |
|-------|---------:|------------------------:|----------:|
| S1 1k | 1.2 h | 0.7 h | 0.3 h |
| S2 5k | 6.1 h | 3.3 h | 1.7 h |
| S3 10k | 12.2 h | 6.6 h | 3.3 h |
| S3b ~19k | 23.2 h | 12.6 h | 6.3 h |

Bottlenecks: Model2 host load, Electron harness cold start, lattice batch — expect **sub-linear** speedup (0.92 efficiency factor in estimates).

---

================================
PRODUCTION CORE SELECTION DESIGN
================================

**Layer:** `CORE_DAILY_CONVERSATION` (offline dataset-management only)

**Policy (PROVISIONAL_DATASET_SELECTION_RULE — not architecture SSOT):**

1. **Input:** full `select_pool_candidates()` after holdout + Gate0 exclusion  
2. **Exclude V1 seed families** from new draws to avoid re-materializing same 280 (V1 retained as frozen lineage artifact)  
3. **Stratified broad sampling** — not uniform random N:
   - **Coverage floors** for sparse pool categories: take all available `family_social` (60) and `weather_plans` (74) if stage size permits  
   - **Source cap:** ≤85% from any single source corpus per stage  
   - **Length strata:** match pool mix (~9% short / 49% medium / 42% long)  
   - **Remaining slots:** weighted by natural category frequency (no equal forcing)  
4. **Forbidden selection signals:** RETRY history, failed surfaces, cand>0 expectation, multipath expectation, Anchor hit expectation  
5. **Freeze before materialize:** `sourceSelectionSeed`, shard map, family list, split, acoustic variant plan  
6. **No outcome-based resampling**

---

================================
ACOUSTIC VARIATION CONTRACT
===========================

**Scope:** `NORMAL_ACOUSTIC_VARIATION` only — **not** pronunciation-error perturbation.

| Allowed | Excluded (future separate phase) |
|---------|----------------------------------|
| Multiple authorized TTS voices | n/l, d/t nasal confusion |
| Bounded rate/prosody if supported | zh/ch/sh vs z/c/s injection |
| Speaker timbre/gender variety | Tone error perturbation |

**Semantic family rule:** Same `semanticFamilyId` + same split for all variants; distinct `materializationRunId` per variant; **never** cross TRAIN/DEV/TEST.

**Recommended bounded strategy:**

| Phase | Realizations | Rationale |
|-------|-------------|-----------|
| S1 (~1k) | **1 primary voice** | Feasibility after infra prep |
| S2–S3 | **1 primary + optional 1 secondary on 20–30% deterministic subset** | ASR diversity without full Cartesian product |
| Not recommended | all refs × all voices | Cost explodes; duplicate semantic supervision |

**Pronunciation-error perturbation (B):** Authorized only when normal variation exhausted **and** learning curve shows ASR-realism gap — closed-loop B2 only.

---

================================
TTS CAPABILITY
==============

| Item | Status |
|------|--------|
| Default / authorized voice | `zh_CN-huayan-medium` |
| Unique voices in repo scan | 1 |
| B2 `materialize_audio()` voice param | **Not used** (always default) |
| Rate / prosody controls | **Not supported** in client |
| Piper `/voices` API | Supported in service code |
| Assessment | **`NORMAL_ACOUSTIC_VARIATION_INFRASTRUCTURE_GAP`** |

**Narrow next prep step:** Authorize ≥2 Chinese Piper voices in repo; extend `materialize_audio()` to accept frozen `ttsVoiceIdentity`; record in worker manifest; **no download in this phase**.

---

================================
DATASET LAYERS
==============

| Layer | Purpose | Source | Split |
|-------|---------|--------|-------|
| **CORE_DAILY_CONVERSATION** | Broad spoken daily coverage | certified pool v2 | family-locked |
| **DOMAIN_CONVERSATION** | Optional enrichment from domain-heavy templates already in pool | same pool tags | same lock |
| **LONG_TAIL_LANGUAGE** | Hapax / rare char coverage | pool tail + future sources | same lock |
| **ACOUSTIC_VARIATION** | Second voice on subset | same references | same family/split |
| **REAL_AUDIO_REFERENCE** | Realism validation layer | authorized human audio (future) | same family/split |

Layers are **manifest tags only** — not Domain Vote / Model3 features.

---

================================
ERROR FAMILY QA
===============

**Expansion QA tracks alignment-derived families post-materialization:**

SUBSTITUTION · MULTI_CHAR_REPLACEMENT · INSERTION · DELETION · unequal-length · region length · HEAD/MID/TAIL

**Selection independence:** Select references first → freeze → materialize → measure distribution. **Never** select because INSERTION appeared.

**Deletion supervision funnel (diagnostic):**

```
alignment DELETION region
  → current-text target exists?
  → overlapping eligible FineSpan?
  → Anchor mask subtraction?
  → label contract outcome (KEEP/RETRY/EXCLUDE)
  → RETRY supervision emitted?
```

Prior seed observation: **204** deletion regions vs **97** RETRY span rows — funnel drop likely at FineSpan overlap / anchor mask / label eligibility. Track rates at S1+; **do not change label semantics**.

---

================================
SURFACE SHORTCUT QA
===================

**Corrected reporting fields (no business logic change):**

`surface`, `keep_span_rows`, `retry_span_rows`, **`keep_unique_semantic_families`**, **`retry_unique_semantic_families`**, **`total_unique_semantic_families`**, position diversity, anchor context diversity, candidate-state diversity, label entropy.

**Management:** No blacklist · no synthetic opposite labels · reduce risk via breadth (families, contexts, positions, acoustic realizations).

**Diagnostic score (future QA):** flag high support + low entropy + low family spread.

---

================================
MULTI-PC DESIGN
===============

**Feasible:** YES (proven by 5-shard V1 build)

**Shard freeze (before any worker runs):**
- source IDs, semanticFamilyIds, split, acoustic variant plan, `sourceSelectionSeed`

**Worker manifest must record:**
workerId · machineIdentity · ASR checkpoint · Tone · lexicon snapshot · Model2 checkpoint · TTS voice · feature/label/provenance contract IDs

**Merge fail-closed on mismatch** of any upstream identity above.

**Deterministic retry:** Re-run failed jobs against **same frozen shard** — no outcome-based resampling.

---

================================
WORKER IDENTITY CONTRACT
========================

See `model3_v2_acoustic_multi_pc_contract.json` for full schema.

Merge rejects heterogeneous workers unless explicit future policy authorizes intentional heterogeneity (not recommended for production core).

---

================================
COMPUTE / STORAGE
=================

**Storage estimate (rough, per primary realization):** ~0.8 MB intermediate artifacts / utterance → S2 ~4 GB scratch; S3b ~15 GB; final JSONL smaller after seal.

**Post-seal deletable (future policy):** raw lattice scratch if provenance manifest + JSONL sealed — **do not implement cleanup in this phase**.

---

================================
DATASET LINEAGE
===============

| Dataset ID | Families | Role |
|------------|---------:|------|
| `MODEL3_V2_TARGETED_DIST_CORRECTED_V1` | 280 | **Frozen formal seed** — do not mutate |
| `MODEL3_V2_PRODUCTION_CORE_S1` | ~1,000 | New build; parent lineage cites V1 as prior art, not in-place edit |
| `MODEL3_V2_PRODUCTION_CORE_S2` | ~5,000 | Superset build from pool |
| `MODEL3_V2_PRODUCTION_CORE_S3` | ~10,000 | Production-oriented |
| `MODEL3_V2_PRODUCTION_CORE_S3B` | ~18,994 | Pool ceiling |

**Preferred pattern:** Versioned new builds with manifest `parentDatasets: ["MODEL3_V2_TARGETED_DIST_CORRECTED_V1"]` and explicit union policy if V1 rows included in training (optional, not required).

**Gate0 sources:** Remain excluded from all training builds.  
**Protected real inventory:** Central registry — never in train/dev/test or LLM seeds.

---

================================
LEARNING CURVE PLAN
===================

| Checkpoint | Scale | Compare |
|------------|-------|---------|
| S0 | 280 | Baseline formal seed |
| S1 | 1k | Overfit / shortcut signals |
| S2 | 5k | RETRY family recall, HEAD/MID/TAIL |
| S3 | 10k | Protected real inventory |
| S3b | ~19k | Diminishing returns vs cost |

**Metrics:** formal held-out P/R/F1 · KEEP false RETRY · protected real target recall · error-family recall · surface shortcut score · latency

**Init comparison at checkpoints:** random-init vs RealDist — same split, same config.

**Scale rule:** Do **not** declare “25k required” without curve evidence.

---

================================
READINESS GATES (R1–R12)
=======================

| Gate | Status | Evidence |
|------|--------|----------|
| R1 full-pool taxonomy | **PASS** | `model3_v2_full_pool_profile.csv` |
| R2 vocabulary profile | **PASS** | measured char/bigram/trigram |
| R3 source bias | **PASS** | 90% supplement documented |
| R4 selection policy frozen | **FAIL** | policy designed, not yet frozen for build |
| R5 holdout active | **PASS** | existing registry |
| R6 acoustic contract | **PASS** | contract JSON |
| R7 TTS sufficient | **FAIL** | single authorized voice |
| R8 split lock | **PASS** | `assign_split` SSOT |
| R9 multi-PC contract | **PASS** | contract JSON |
| R10 merge QA | **PASS** | extend existing build QA |
| R11 lineage | **PASS** | version table above |
| R12 no architecture drift | **PASS** | governance unchanged |

**Bulk materialization blocked until R4 + R7 pass.**

---

================================
NEW REFERENCE SOURCE POLICY
===========================

Trigger new sources when:
- Stage target exceeds **18,994** families  
- Learning curve plateaus on S3b despite breadth  
- `family_social` / `weather_plans` product coverage still insufficient after taking full sparse pool  
- LLM clean-reference generation authorized under closed-loop B2 (never direct RETRY labels)

---

================================
GOVERNANCE
==========

Model3 · features · labels · threshold · Tone · Recall · FineSpan · Model2 · Domain · Anchor · Retry · JobResult: **NO CHANGE**  
Bulk dataset generated: **NO** · Training: **NO**

---

================================
NEXT PHASE
==========

**Exactly one:** `MODEL3_V2_NORMAL_ACOUSTIC_VARIATION_PREPARATION`

Prepare authorized multi-voice B2 materialization path before S2/S3 bulk. S1 build may follow immediately after prep if user approves single-voice feasibility path.

**Do not execute.**

---

## Artifacts (5)

| # | File |
|---|------|
| 1 | `Lingua_Model3_V2_Production_Dataset_Expansion_Design_2026_08_30.md` |
| 2 | `model3_v2_full_pool_profile.csv` |
| 3 | `model3_v2_expansion_scale_plan.csv` |
| 4 | `model3_v2_acoustic_multi_pc_contract.json` |
| 5 | `model3_v2_expansion_readiness_summary.json` |

**Profiling script (re-runnable):** `training/model3_dataset/scripts/run_expansion_design_profile.py`
