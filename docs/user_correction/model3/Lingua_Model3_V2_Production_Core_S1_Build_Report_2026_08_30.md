# Lingua — Model3 V2 Production Core S1 Build

**Phase:** `MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S1`  
**Date:** 2026-08-30  
**Dataset:** `MODEL3_V2_PRODUCTION_CORE_S1`  
**Build ID:** `prod_core_s1_build_20260830_v1`  
**Parent seed (frozen, restored):** `MODEL3_V2_TARGETED_DIST_CORRECTED_V1`

---

## MAIN VERDICT

| Field | Value |
|-------|-------|
| **S1 verdict** | **PRODUCTION_CORE_S1_BUILD_PASS_WITH_NONBLOCKING_WARNINGS** |
| **datasetId** | `MODEL3_V2_PRODUCTION_CORE_S1` |
| **build complete** | **YES** |
| **unique semantic families** | **999** (frozen 1,000; 1 new-materialization HARD_REJECT) |
| **ready for next phase** | **YES** (dataset QA pass; not production acceptance) |
| **architecture drift** | **NO** |

**Nonblocking warnings:** (1) `many_one_sided_surfaces` — 40 surfaces with KEEP-only span labels at high support; (2) scale 999 vs nominal ~1,000 — one frozen reference failed formal materialization (`HARD_REJECT`, not outcome-driven reselection).

---

## ARCHITECTURE BOUNDARY CORRECTION

**Authoritative decision (this phase; historical reports unchanged):**

| Item | Classification |
|------|----------------|
| `ACOUSTIC_VARIATION_FOR_MODEL3_DATASET` | **DEFERRED_NOT_REQUIRED_FOR_CURRENT_MODEL3_DEVELOPMENT** |
| `NORMAL_ACOUSTIC_VARIATION_INFRASTRUCTURE_GAP` | **NON_BLOCKING_DEFERRED_UPSTREAM_DATA_GENERATION_OPTION** — not a Model3 readiness blocker |

**Correct boundary:**

- **Model3** = anchor-conditioned **ASR-postprocessing text repair trigger** (KEEP / RETRY). Input: post-ASR text, FineSpans, Anchors, candidate/context features. Does **not** process audio, speaker identity, TTS identity, acoustic embeddings, ASR training, or direct text repair.
- **ASR / acoustic / TTS** = upstream fixed materialization infrastructure for this phase only (`zh_CN-huayan-medium` fixed voice).

Multi-voice, speaker diversity, rate/prosody variation, and ASR acoustic augmentation **must not block** Model3 dataset expansion. S1 executed under this corrected governance.

---

## SOURCE SELECTION

| Item | Value |
|------|-------|
| **pool** | `model3_certified_base_pool_v2` (~18,994 usable semantic families) |
| **selection seed** | `2026083006` |
| **frozen before outcomes** | **YES** (`R4_SELECTION_POLICY_FROZEN` closed) |
| **lineage strategy** | `V1_280_reuse_plus_720_new_materialization` |
| **selected families (frozen)** | **1,000** (280 V1 lineage reuse + 720 new references) |
| **Gate0 exclusions** | 48 acceptance sources excluded at selection |
| **outcome-driven additions** | **0** |

**Source distribution (frozen list, all 1,000):**

| Source | Families |
|--------|--------:|
| lineage_reuse_v1 | 280 |
| prior_certified_v1 | 310 |
| MODEL3_SPOKEN_BASE_SUPPLEMENT_V1 | 410 |

New-selection subset improves prior_certified share vs full-pool ~9.55% bias (provisional S1 policy; not SSOT architecture).

**Taxonomy distribution (offline keyword hits; multi-label; selection aid only — not runtime features):**

Broad daily-conversation coverage present: negation/casual/confirmation remain frequent (expected in spoken pool); also daily_request, numbers, time, shopping, transport, scheduling, customer_service, workplace, travel/hotel, tech_device. Sparse categories recorded as **SOURCE_POOL_LIMITATION** (not duplicated): `family_social` 60, `weather_plans` 74.

**Length distribution (frozen):** short 348 · medium 392 · long 260.

**Missing supervised family (infrastructure, not reselection):**

| referenceId | semanticFamilyId | split | text |
|-------------|------------------|-------|------|
| `f5212176ded1` | `sf_2d19c92929732e20cbfec0d9` | train | 人力资源政策关于宾馆 |

Disposition: `HARD_REJECT` in shard `s10` (`results_s10.jsonl`). Remaining 719/720 new materializations `SUPERVISED_ACCEPTED`.

Artifacts: `training/model3_dataset/model3_v2_production_core_s1/build/source_freeze.json`, `source_selection_freeze.csv`.

---

## DATASET SIZE

| Metric | Count |
|--------|------:|
| **semantic families** | 999 |
| **utterances** | 999 |
| **paths** | 2,757 |
| **span×path samples** | 41,392 |
| **KEEP** | 36,872 |
| **RETRY** | 2,920 |
| **MASKED** | 1,600 |

Primary scale metric: **unique semantic families**. Path/span expansion reflects production multipath + FineSpan lattice (not family duplication).

Location: `training/model3_dataset/model3_v2_production_core_s1/{train,dev,test}/shard-000.jsonl`.

---

## VOCABULARY EXPANSION

Reference-surface vocabulary (normalized reference text):

| Scope | Unique CJK chars | Bigrams | Trigrams |
|-------|------------------:|--------:|---------:|
| S0 seed (280) | 395 | 1,201 | 1,774 |
| **S1 (999)** | **680** | **2,337** | **3,532** |
| Full usable pool | 1,059 | 6,520 | 11,850 |

S1 vs S0: **+72%** chars, **+95%** bigrams, **+99%** trigrams.  
S1 vs pool: **64.2%** char / **35.8%** bigram / **29.8%** trigram coverage (breadth expansion; no arbitrary pass threshold).

---

## MATERIALIZATION FUNNEL

Formal B2 path only (no alternate pipeline):

```
ReferenceSource → TTS (zh_CN-huayan-medium) → ASR/FW → normalizeForFwRepairInput
→ ToneModule → Mandatory Tone Recall → runLatticeFineSpanGeneration
→ Model2 → compatibility → Domain Vote → Anchor → packModel3SpanInferFields
→ provenance validation → derive_malformed_regions → V2 label_spans → serializer
```

| Stage | Count |
|-------|------:|
| Frozen new references | 720 |
| Fresh materialization attempts | 720 |
| SUPERVISED_ACCEPTED (new) | 719 |
| HARD_REJECT (new) | 1 |
| V1 lineage reuse (contract-matched) | 280 |
| **Supervised families in dataset** | **999** |

Build duration ~38 min (15 shards × 48). Infrastructure retry policy: same shard, same references.

---

## CANDIDATE STATE

Source: `PathFineSpan.candidates` → `model3FirstPassCandidateCount` (missing = HARD_REJECT; true zero valid).

| Channel | span×path count |
|---------|----------------:|
| cand=0 | 13,906 |
| cand=1 | 27,171 |
| cand=2 | 315 |

| Label × candidate | cand=0 | cand>0 |
|-------------------|-------:|-------:|
| KEEP | 12,919 | 23,953 |
| RETRY | 987 | 1,933 |

**RETRY + cand>0 utterances:** 462. Candidate channel non-collapsed: **PASS**.

---

## MULTIPATH

All production `pathFineSpanViews` retained (no `paths[0]` / best-path-only).

| Metric | Value |
|--------|------:|
| Multipath utterances | 611 |
| Single-path utterances | 388 |
| Path count histogram | 1→388, 2→226, 3→142, 4→68, 5→19, 6→55, 7→14, 8→87 |

Multipath retention: **PASS**.

---

## MODEL2 / DOMAIN / ANCHOR

| Owner | Status |
|-------|--------|
| Model2 expand | Wired, attempted, completed (15/15 shards OK) |
| Domain Vote | Once per utterance; executed |
| Anchor materialization | Serialized |

**Anchor span×path distribution:**

| Source | Count |
|--------|------:|
| NONE | 39,792 |
| MODEL2 | 965 |
| DOMAIN_AND_MODEL2 | 431 |
| DOMAIN | 204 |

Natural states; no artificial Anchor balancing.

---

## ERROR FAMILY QA

Diagnostic only (post-materialization; not used for source selection):

| Family | Malformed regions |
|--------|------------------:|
| DELETION | 1,676 |
| SUBSTITUTION | 1,423 |
| MULTI_CHAR_REPLACEMENT | 846 |

| Region length | Count |
|---------------|------:|
| 1 | 3,062 |
| 2 | 632 |
| 3 | 175 |
| 4 | 29 |
| 5+ | 47 |

Unequal-length regions: 2,010. Position bins (regions): HEAD 973 · MID 1,855 · TAIL 1,117.  
Unique malformed regions: 1,522 across 848 families.

Labeled RETRY corruption taxonomy (span labels): SUBSTITUTION 2,920.

---

## DELETION FUNNEL

| Stage | Count |
|-------|------:|
| Alignment deletion regions | 1,676 |
| → RETRY span rows (labeled) | 62 |

Prior seed-scale gap (204 regions vs 97 RETRY) tracked diagnostically; V2 label semantics unchanged (no referenceReachable / phoneticCompatible hard gates restored).

---

## SURFACE SHORTCUT QA

Corrected fields used: `surface`, span-row counts, family diversity, position/anchor/candidate diversity, label entropy.

Notable contrast surfaces (top): 我, 不, 是, 看, 一 — mixed KEEP/RETRY at high family support.  
40 **one-sided** high-support surfaces flagged (`oneSidedSuspicious`) — QA warning only; no token blacklist, no manual re-label.

Historical probe surfaces (背/四/温等) absent or minimal in S1 supervised corpus — expected.

---

## PROVENANCE

| Gate | Status |
|------|--------|
| Same-run label + feature coherence | **PASS** |
| Evidence origin | **PASS** (`FORMAL_FRESH_MATERIALIZATION` or sealed V1 lineage reuse) |
| Packer identity | `packModel3SpanInferFields` — **PASS** |
| Label contract | `MODEL3_LABEL_CONTRACT_V2_20260829` — unchanged |
| Tone Recall | **PASS** |
| ttsVoiceIdentity recorded | `zh_CN-huayan-medium` (provenance only; not Model3 feature) |

Rejected evidence classes excluded: TEST_FIXTURE, PROBE_ONLY, HISTORICAL_NON_PARITY_INPUT, manual/planned corruption.

---

## HOLDOUT / SPLIT

| Gate | Status |
|------|--------|
| Protected holdout collision | **0** — **PASS** |
| Gate0 source collision | **0** — **PASS** |
| Semantic-family split leak | **0** — **PASS** |

**Family split (supervised 999):**

| Split | Families | Path samples |
|-------|--------:|-------------:|
| train | 775 | 2,105 |
| dev | 100 | 252 |
| test | 124 | 400 |

Conceptual ~80/10/10 preserved via `semanticFamilyId` owner; no path-level or label-based splitting.

**V1 seed integrity:** `MODEL3_V2_TARGETED_DIST_CORRECTED_V1` restored from lineage rows (280 families, 849 paths, manifest unchanged in identity). S1 writes isolated under `model3_v2_production_core_s1/`.

---

## GOVERNANCE

| Component | Changed |
|-----------|---------|
| Model3 | **NO** |
| Model3 feature contract | **NO** |
| KEEP/RETRY semantics | **NO** |
| FineSpan | **NO** |
| Recall | **NO** |
| Tone | **NO** |
| Model2 | **NO** |
| Domain Vote | **NO** |
| Anchor | **NO** |
| Retry / Assembly / KenLM / JobResult | **NO** |
| ASR | **NO** |
| ASR training | **NO** |
| Acoustic variation development | **NO** |
| Model3 training | **NO** |

Orchestration-only scripts: `run_production_core_s1_build.py`, `finalize_production_core_s1_build.py` (offline dataset build).

---

## NEXT PHASE

**Exactly one (NOT EXECUTED — await user review):**

`MODEL3_V2_PRODUCTION_CORE_S1_TRAINING_EXPERIMENT`

Rationale: S1 validates formal B2 at ~1k scale with full QA pass; a controlled training experiment on S1 supports learning-curve / overfit diagnosis before committing to S2 (~5,000). Alternative if user prefers scale-first: `MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S2`.

S1 is **not** production model acceptance. Next serious training scale target remains **S2 ≈ 5,000 families**.

---

## CHECKLIST

- [x] acoustic variation no longer Model3 blocker  
- [x] Model3 post-ASR role explicitly frozen  
- [x] ASR untouched / no ASR training  
- [x] no multi-voice / speaker-diversity work  
- [x] current TTS only as fixed materializer  
- [x] S1 source list frozen before outcomes  
- [x] ~1,000 unique semantic families (999 supervised; 1 infra reject documented)  
- [x] daily conversation breadth expanded  
- [x] linguistic breadth expanded  
- [x] vocabulary breadth measured  
- [x] source bias reported  
- [x] no outcome-based RETRY sampling  
- [x] formal B2 only / same-run provenance  
- [x] candidate missing fails closed; cand0 + cand>0 tracked  
- [x] RETRY+cand>0 tracked; all multipaths retained  
- [x] Model2 / Domain / Anchor validated  
- [x] exact packer; V2 labels unchanged  
- [x] error families + deletion funnel audited  
- [x] surface shortcut QA; holdout/split QA pass  
- [x] no Model3 training; no architecture drift  
- [x] ≤8 report artifacts; exactly one verdict; exactly one next phase  

---

## ARTIFACTS (5 files)

| # | Path |
|---|------|
| 1 | `docs/user_correction/model3/Lingua_Model3_V2_Production_Core_S1_Build_Report_2026_08_30.md` |
| 2 | `docs/user_correction/model3/model3_v2_production_core_s1_summary.json` |
| 3 | `docs/user_correction/model3/model3_v2_production_core_s1_distribution.csv` |
| 4 | `docs/user_correction/model3/model3_v2_production_core_s1_qa.csv` |
| 5 | `docs/user_correction/model3/model3_v2_production_core_s1_manifest.json` |

Dataset + build audit: `training/model3_dataset/model3_v2_production_core_s1/`.
