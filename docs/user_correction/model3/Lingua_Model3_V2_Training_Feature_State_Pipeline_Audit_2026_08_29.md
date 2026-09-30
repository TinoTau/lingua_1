# Lingua Model3 V2 Training Feature-State Pipeline Audit

**Phase:** `MODEL3_V2_TRAINING_FEATURE_STATE_PIPELINE_AUDIT`  
**Date:** 2026-08-29  
**Mode:** READ-ONLY — no dataset build, no training, no architecture/feature/model change

================================
MAIN VERDICT
============

Primary classification: **TRAINING_UPSTREAM_STATE_PROVENANCE_GAP**

Candidate-state provenance resolved: **YES** (mechanism known; training acquisition path **not** authorized)

Dataset Build can resume: **NO**

Architecture change required: **USER_DECISION_REQUIRED**  
(not Model3 / Recall / Tone *runtime* change — a **training-data upstream materialization policy** decision)

---

**Boundary preserved**

| Concept | Status |
|---------|--------|
| Model3 **input modality** | TEXT-ONLY (surface + packed features). Unchanged. |
| Feature **provenance** | `first_pass_cand_log1p` encodes **upstream acoustic-dependent Recall state**, not text-only lexicon. |
| Model3 is **not** an acoustic model | Confirmed. Acoustic path would only *materialize* training features. |

================================
LIVE CANDIDATE PROVENANCE
=========================

### Exact code path

```
Audio + FW ASR
  runAsrStep (asr-step.ts)
    → faster_whisper ToneModule.run_tone_inference(processed_audio, FW word timestamps)
    → ctx.acousticToneSlices[]  (+ toneEvidenceProduction)

runFwDetectorV4Path / runSpanAssemblyV4Orchestrator
  buildUtteranceSyllableCoordinate(rawText)          # text → syllables (pinyin strings)
  buildWordTimeSpans(rawText, asrSegments, …)        # FW word times → char ranges
  runLatticeFineSpanGeneration({ acousticSlices, wordTimeSpans, toneTimestampOnlyEnabled })
    buildLexicalWindowQueries → latticeHardBlockFilter
    recallTopKForWindows
      resolveTimestampToneState → toneCallerEnabled
      extractAcousticTonePatternForRecall / mapToneEvidenceForRecall
        # syllable slot → covering WordTimeSpan → time-overlap AcousticToneSlice
        # pattern digits = argmax(posterior) ONLY — no invented tensors
      recallSpanTopKV2
        resolveToneRecallReadiness
        collectTierCandidatesToneFirst  # Tone SQL only; plain removed
      bindLexiconHitsToWindow → WindowCandidate[]
    buildLexicalEdges  # ONLY windows with candidates.length > 0
    injectFallbackEdges  # candidates: []
    enumerateCompleteSegmentationPaths
    materializePathFineSpans  # PathFineSpan.candidates = edge.candidates

  per path:
    resolveCompatibilityRelations  # isCovered on CLONED pool → activeCandidates
    expandActiveCandidatesWithModel2  # mutates activeCandidates only
    runModel3PathStep
      packModel3SpanInferFields(PathFineSpan)
        model3FirstPassCandidateCount = candidates.filter(!isCovered).length
      → first_pass_cand_log1p / rawFirstPassCandidateCount
```

### What `rawFirstPassCandidateCount` means

| Question | Answer |
|----------|--------|
| Count formula | `PathFineSpan.candidates.filter(c => !c.isCovered).length` (`model3-feature-pack.ts`) |
| Stage | **Lattice first-pass FineSpan candidates** |
| Pre/post compatibility | **Pre** relative to `activeCandidates` — orchestrator does **not** write `isCovered` back onto PathFineSpan |
| vs Domain Vote | Independent (Vote uses pool; count does not) |
| vs Model2 | Model2 expands `activeCandidates` only — **does not** change this count |
| Live practical meaning | ≈ uncovered lattice hits hanging on that FineSpan; fallback FineSpans → **0** |

### Minimum required upstream state (for cand>0)

| Field | Class |
|-------|--------|
| `rawText` + text-derived syllables | REQUIRED |
| non-empty `domainIds` (lattice gate) | REQUIRED |
| LexiconRuntimeV2 + `supportsToneFirstRecall()` | REQUIRED |
| `toneTimestampOnlyEnabled === true` | REQUIRED |
| `AcousticToneSlice[]` (non-empty) | REQUIRED |
| `WordTimeSpan[]` covering window chars | REQUIRED |
| per-window `acousticTonePattern` | REQUIRED (DERIVED from slices×WordTimeSpan) |
| `tonePinyinKey` | DERIVED |
| window syllables / windowPinyinKey | REQUIRED |
| `windowText` | OPTIONAL→conditional (length-1 identity) |
| ASR word timestamps (upstream of WordTimeSpan) | REQUIRED (upstream) |
| raw audio waveform | REQUIRED to *produce* slices in live; not read by Model3 |
| text-derived dictionary tone digits | **NOT_USED** (forbidden as Plain fill) |
| `toneEvidenceProduction` | NOT_USED for cand (diagnostics) |
| Compatibility / Domain / Model2 | NOT_USED for PathFineSpan cand>0 |

**Minimum contract object (not “needs audio” vaguely):**  
production-equivalent **`AcousticToneSlice[]` + `WordTimeSpan[]` + tone channel enabled**, aligned so `mapToneEvidenceForRecall` yields a valid pattern → `resolveToneRecallReadiness = ready`.

================================
MANDATORY TONE RECALL
=====================

**Owner:** `resolveToneRecallReadiness` (`tone-recall-readiness.ts`)  
**Order:** `caller_disabled` → `runtime_unsupported` → `no_pattern` → `invalid_pattern` → `ready`

| State | Condition |
|-------|-----------|
| `caller_disabled` | `toneCallerEnabled === false` |
| `runtime_unsupported` | `!supportsToneFirstRecall()` |
| `no_pattern` | missing/empty `acousticTonePattern` |
| `invalid_pattern` | cannot build tonePinyinKey (length / tone∉[1,5]) |
| `ready` | valid `tonePinyinKey` → Tone SQL only |

**Required inputs for ready:** syllables + runtime tone support + caller enabled + acoustic pattern.

**Failure behavior:** zero Tone SQL / zero hits → no LexicalEdge → fallback FineSpan `candidates=[]` → cand=0.

**Plain lexicon / text-only pinyin fallback:** **intentionally removed** (Batch 1.1C). Confirmed in `tone-first-tier-collector.ts`, `recall-span-topk-v2.ts`, integration tests. **Do not restore.**

### Text pinyin vs acoustic Tone (must not merge)

| Channel | Owner | Source | Model3 feature |
|---------|-------|--------|----------------|
| Text pinyin availability | `model3PinyinTextDerived(globalSyllables)` | text syllable coordinate | `pinyin_channel_avail` |
| Acoustic tone for Recall | ToneModule + `mapToneEvidenceForRecall` | audio + FW timestamps | unlocks **candidates** → `first_pass_cand_log1p` |

Gate0 had pinyin=1 and cand≡0 simultaneously — proves these are **different** provenances.

================================
GATE0 VS LIVE
=============

| dimension | Gate0 offline | live production | why different | owner |
|-----------|---------------|-----------------|---------------|-------|
| audio | absent | present (ASR batch) | training probe text-only | ASR / corpus |
| FW timing | absent | WordTimeSpan from ASR words | no ASR segments | `buildWordTimeSpans` |
| AcousticToneSlice | absent | ToneModule on audio | no tone inference | `run_tone_inference` |
| acousticTonePattern | null | mapped from slices | no pattern | `mapToneEvidenceForRecall` |
| Recall readiness | no_pattern / caller path → empty | often `ready` | tone channel | `resolveToneRecallReadiness` |
| lexical edges | 0 | >0 when hits | no Tone SQL hits | `buildLexicalEdges` |
| candidate list | always [] | 0 or 1+ on FineSpan | fallback vs lexical | `materializePathFineSpans` |
| rawCand | **90/90 = 0** | **466×0 + 541×1** (trace) | collapse vs unlocked | `model3FirstPassCandidateCount` |
| retainedDomains / Domain Anchor | Domain path runnable | Domain + Model2 | Model2 needs acoustic retrieval | Anchor adapter |
| multipath | 1 path ×6 utt | many cases multipath | probe set too small / easy | lattice enum |

**Tone architecture check:** Live Tone still operates on **original audio aligned through FW timestamps** (`mapToneEvidenceForRecall` forbids invented tensors). **No STOP_AND_REVIEW drift** relative to frozen principle. Syllable *strings* are text-derived; tone *digits* are acoustic — hybrid key, not text-tone substitute.

================================
TRAINING ASSET INVENTORY
========================

See `model3_v2_upstream_training_asset_inventory.csv`.

**Highlights**

| asset | tone/acoustic | reusable for Model3 cand? |
|-------|---------------|---------------------------|
| AISHELL-3 Tone CNN/CRNN features (~998k) | training features, not live slices | **NO** as direct cand SSOT |
| dialog_200 wavs (200, Piper TTS) | audio yes; no baked slices | **PARTIAL** — can *re-run* ASR→Tone→Recall |
| ToneModule weights + inference | production Tone | YES as producer if audio fed |
| `model3_v2_live_input_trace.jsonl` | packed cand only | **reference/validation**; not supervised train (no GT label; mostly holdout) |
| Model3 V2 labeled / RealDist | text features; cand often defaulted | **NO** as honest cand coverage |
| Frozen tone simulator contract | — | **DOES_NOT_EXIST** |
| Piper TTS / restore-dialog200 | eval/Tone/FW corpus | **EXISTING_BUT_FOR_OTHER_PURPOSE** |
| Model3 TTS readiness (Aug 26) | historical | **SUPERSEDED_FOR_MODEL3** (TEXT_ONLY) |

================================
ROUTE A — REAL STATE
====================

**Path:** real audio / existing live trace → production Tone → Recall → cand → Model3 sample

| criterion | score |
|-----------|-------|
| PRODUCTION SEMANTIC PARITY | PASS (when full pipeline) |
| REUSE EXISTING OWNER | PASS |
| NO DUPLICATED LOGIC | PASS |
| TRAIN SCALE | FAIL / PARTIAL — 14-case trace; dialog_200 mostly eval/holdout |
| LABEL COMPATIBILITY | FAIL for supervised RETRY — trace has `decision` not GT; no malformed-region labels |
| PRIVACY / HOLDOUT | FAIL if using protected inventory for train |
| REPEATABILITY | PARTIAL |

**Usable for:** distribution reference, offline eval replay, calibration.  
**Not usable for:** supervised targeted-dist training corpus at required scale without new labeled real-audio set.

**Verdict:** PARTIAL — not sufficient alone to resume Dataset Build.

================================
ROUTE B — ACOUSTIC MATERIALIZATION
==================================

**Path:** training text/corruption → authorized audio (e.g. TTS) → production ASR → Tone → Recall → cand

| criterion | score |
|-----------|-------|
| PRODUCTION SEMANTIC PARITY | PARTIAL→PASS *if* full production ASR+Tone+Recall reused |
| EXISTING TTS PIPELINE | EXISTING_BUT_FOR_OTHER_PURPOSE (Piper/dialog_200/Model2) |
| AUTHORIZATION | **NEW_TRAINING_DATA_GENERATION_DECISION_REQUIRED** |
| Model3 runtime remains text-only | PASS (TTS only for upstream *training* state) |
| Alignment risk | HIGH — predetermined corrupted text vs ASR output may diverge |
| COST / COMPLEXITY | HIGH |
| SYNTHETIC BIAS | HIGH (TTS≠user ASR; historical readiness flagged LOW_ERROR_YIELD) |
| Frozen for *this* purpose | **NO** — `MODEL3_TTS_READINESS` superseded; POINTER forbids inventing acoustic Model3 identity without ACP |

**Verdict:** PARTIAL technically feasible via existing owners; **not currently authorized**.

================================
ROUTE C — FROZEN SIMULATOR
==========================

Search: tone corruption metadata, confusion tables, validated synthetic AcousticToneSlice contracts for Model3 training.

**Classification:** **DOES_NOT_EXIST** → **ROUTE C = NOT_CURRENTLY_AUTHORIZED**

Do **not** design a simulator in this phase. Mark: **NEW_TRAINING_SIMULATION_CONTRACT_REQUIRED** (future user approval only).

================================
FEATURE PROVENANCE MATRIX
=========================

See `model3_v2_training_feature_provenance_matrix.csv`.

Summary gaps: **rawFirstPassCandidateCount** is the blocking provenance gap; Anchor **Model2** source underrepresented offline; other packed features (len/position/pinyin/cjk) achievable text-side.

================================
ANCHOR PARITY
=============

DOMAIN_ANCHOR_OWNER_PARITY: **PASS** (Gate0 used `materializeModel3Anchors` Domain path)

MODEL2_ANCHOR_PARITY: **FAIL / NOT_EXERCISED** offline (Model2 acoustic provenance UNAVAILABLE; live trace shows MODEL2 / DOMAIN_AND_MODEL2 anchors)

FULL_ANCHOR_DISTRIBUTION_PARITY: **FAIL** — Gate0 “PRODUCTION_EQUIVALENT_ANCHOR” means **owner parity for Domain materialization**, **not** full live Anchor *distribution* parity. Terminology corrected here.

================================
MULTIPATH
=========

PATH_OWNER_PARITY: **PASS** (`runLatticeFineSpanGeneration` path enumeration)

MULTIPATH_MATERIALIZATION_EXERCISED: **NO** (Gate0: 6/6 single-path)

Existing non-holdout multipath examples (dialog_200 step7 census, for **future** Gate0 only — do not use as train templates here):

`d001,d020,d021,d043,d044,d045,d046,d064,d065,d066,d088,d089,d090,d109,d110,d111,d133,d134,d135,d154,d155,d156,d178,d180,d182,d199,d200` (27 IDs; protected inventory excluded)

================================
ARCHITECTURE GOVERNANCE
=======================

Model3 changed: **NO**  
feature contract changed: **NO**  
Recall changed: **NO**  
Tone changed: **NO**  
FineSpan changed: **NO**  
Anchor changed: **NO**  
JobResult changed: **NO**  
dataset generated: **NO**  
training executed: **NO**  
first_pass_cand removed: **NO**  
Mandatory Tone Recall rolled back: **NO**  
fake cand / fake tone: **NO**

TTS authorization for Model3 *training upstream materialization*:  
**NEW_TRAINING_DATA_GENERATION_DECISION_REQUIRED**  
(not `ALREADY_AUTHORIZED_BY_EXISTING_TRAINING_CONTRACT`)

Feature Capacity Audit: **NOT** recommended as next step (blocker is provenance, not capacity).

================================
REQUIRED ANSWERS
================

**A.** Minimum upstream state: enabled tone channel + **`AcousticToneSlice[]` + `WordTimeSpan[]`** yielding valid per-window **`acousticTonePattern`** → Tone Recall `ready` → LexicalEdge candidates on PathFineSpan.

**B.** Live has ASR audio → ToneModule slices → pattern → Tone SQL hits → cand>0 on some FineSpans. Gate0 text-only → readiness fail → lexicalEdgeCount=0 → all fallback → cand≡0.

**C.** Repository has **pieces** (dialog_200 audio, ToneModule, lattice/Recall, Piper) but **no** frozen authorized training contract that feeds them into Model3 sample cand. Live traces hold packed cand but not train-scale labeled data.

**D.** Text-only training **cannot** generate production-equivalent cand **without violating** Mandatory Tone Recall semantics (plain fallback removed).

**E.** Existing real traces: usable for **distribution reference / validation / replay**; **not** sufficient supervised training (no RETRY GT; mostly protected holdouts).

**F.** Existing acoustic/TTS assets **can** drive the real pipeline if **re-run** ASR→Tone→Recall; that use is **not** currently authorized for Model3 V2 dataset build (policy gap).

**G.** Frozen Tone simulator: **DOES_NOT_EXIST**.

**H.** Using TTS/acoustic materialization for this purpose: **YES — new training architecture / data-generation decision required** (runtime Model3 stays text-only).

**I.** Remove `first_pass_cand`? **NO** — provenance routes not proven infeasible; only unauthorized. Explicit ACP later if all routes rejected.

**J.** Dataset Build resume now? **NO**.

================================
NEXT PHASE
==========

**MODEL3_V2_ACOUSTIC_TRAINING_STATE_ARCHITECTURE_PROPOSAL**

Do **not** execute in this phase.

Purpose of that future phase (design only when authorized): decide whether to approve Route B–style **upstream-only** acoustic materialization (and/or real-audio training corpus policy), without changing Model3 runtime modality, Recall, or feature contract.

Do **not** resume `MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD` until provenance is authorized and Gate 0 can show natural cand 0/>0.

================================
CHECKLIST
=========

[x] live cand chain traced  
[x] Tone producer identified (`run_tone_inference` / ToneModule)  
[x] minimum upstream state identified  
[x] Recall readiness states documented  
[x] Gate0 collapse explained by code evidence  
[x] live cand>0 explained by code evidence  
[x] text pinyin vs acoustic Tone separated  
[x] existing Tone / TTS / real-trace assets inventoried  
[x] frozen simulator existence checked → DOES_NOT_EXIST  
[x] Route A/B/C evaluated  
[x] fake cand / fake tone / Recall rollback prohibited  
[x] Anchor parity split Domain / Model2 / full  
[x] multipath owner vs exercised + non-holdout IDs  
[x] feature provenance matrix produced  
[x] TTS authorization status explicit  
[x] feature removal not performed  
[x] Model3 / Recall / Tone unchanged  
[x] dataset build not resumed / no training  
[x] exactly one next phase selected / not executed  
