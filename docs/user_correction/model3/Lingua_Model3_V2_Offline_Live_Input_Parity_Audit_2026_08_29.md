# Lingua — Model3 V2 Offline / Live Input Parity Audit

**Phase:** MODEL3_V2_OFFLINE_LIVE_INPUT_PARITY_AUDIT  
**Date:** 2026-08-29  
**Mode:** READ-ONLY  
**Training / architecture / features changed:** NO

---

## MAIN VERDICT

| Field | Value |
|-------|-------|
| **Primary** | **MULTI_FACTOR** |
| Dominant components | `FEATURE_EXTRACTION_PARITY_FAILURE` + `OFFLINE_EVALUATION_HARNESS_DRIFT` + `FINESPAN_INPUT_PARITY_FAILURE` (+ `SOURCE_TEXT_DIFFERENCE` on some cases) |
| Feature-capacity audit justified now? | **NO** |
| Next phase | **MODEL3_V2_OFFLINE_EVAL_PIPELINE_CORRECTION** |

Offline **7/13** was **not** measured on live Electron Model3 inputs. It re-scored a **historical FineSpan dump** with **defaulted** `first_pass_cand_log1p=0` and `pinyin_channel_avail=1`. Live RealDist uses current PathFineSpans and live cand/pinyin. Holding FineSpans fixed and re-inferring with offline feature defaults **reproduces** the offline RETRYs; live recorded decisions do not — so the residual gap after FineSpan alignment is **feature-channel input**, not proof of six-feature capacity failure.

---

## CHECKPOINT IDENTITY

| | Offline probe | Live acceptance |
|--|---------------|-----------------|
| Model | MODEL3_V2_REALDIST_V1 | MODEL3_V2_REALDIST_V1 |
| Path | `.../seed_2026082903` | same (via `MODEL3_CHECKPOINT_IDENTITY`) |
| SHA256 | `fbb8d85d…ad648e` | `fbb8d85d…ad648e` |
| Match | **PASS** | **PASS** |

---

## OWNERSHIP AUDIT

### Offline RealDist “7/13” probe

| Input | Owner |
|-------|--------|
| FineSpans | **STORED HISTORICAL** — `model3_v1_feature_contract_dialog200_anchored.jsonl` `span_margins` from prior **V1** Electron acceptance |
| Anchors | Stored `isAnchor` booleans in that dump |
| Offsets | **Not stored** |
| `first_pass_cand_log1p` | **DEFAULTED 0** — cand not persisted; `infer_utterance_spans` uses `firstPassCandidateCount or 0` |
| `pinyin_channel_avail` | **DEFAULTED True** — hardcoded `fa.pinyinTextDerived=True` |
| Other 4 features | Recomputed via `bigru_v1.span_features` from surface + index |
| Sequence | **Primary path only** (first `path_id` in dump) |
| Inference | Python `Model3BiGRUV1` + RealDist weights |

### Live Electron path

ASR/FW → PathFineSpan → Domain Vote / Anchors → Model2 → `packModel3SpanInferFields` → `model3_inference_host._pack_spans` → RealDist weights

| Input | Owner |
|-------|--------|
| FineSpans | Live `PathFineSpan` (span-assembly-v4) |
| Anchors | `model3-anchor-adapter` (Domain + Model2) |
| `first_pass_cand` | `candidates.filter(!isCovered).length` |
| `pinyin` | `globalSyllables.length > 0` |
| Sequence | Each path’s FineSpans; case RETRY = any path |

### SSOT / duplication

| Piece | Shared? |
|-------|---------|
| BiGRU forward / weights | **YES** |
| Feature **formula** (`span_features` ↔ host pack) | **YES** |
| FineSpan **producer** | **NO** — dump vs live |
| cand / pinyin **values** | **NO** — default vs live |
| Classification | **DUPLICATED_INPUT_PIPELINE** for FineSpan inventory + cand/pinyin sourcing |

---

## DECISIVE EXPERIMENT

**Method:** Load live primary-path FineSpans; re-infer RealDist using **offline feature defaults** (`cand=0`, `pinyin=True`).

| Case | FineSpan vs dump | Offline RETRY | Live recorded RETRY | Live spans + offline feat defaults |
|------|------------------|---------------|---------------------|-------------------------------------|
| d003 | **EXACT** | 烧 | **none** | **烧** (matches offline) |
| d019 | **EXACT** | 上/限/计 | **none** | **上/限/计** |
| d181 | **EXACT** | 温 | **none** | **温** |
| d137 | **EXACT** | 杯 (+1.61) | 烦/一/杯/热 (4) | 杯 only (matches offline pattern) |
| d002 | **DIFFERENT** surfaces | 背 | 烦/做/一/杯 (背 KEEP) | **背** recovered |
| d160 | text+span differ | 顺/向/木 | **none** | 顺/便/向/木 still RETRY |

**Implication:** Offline RETRY pattern is an artifact of **(stale or live) FineSpans + cand=0/pinyin=True**. Live production feature values suppress those RETRYs and, for coffee orders, shift activation to the prefix.

Dialog200 traces do **not** persist `first_pass_cand_log1p` / `pinyin_channel_avail`, so exact per-span live feature deltas cannot be logged from acceptance CSV alone — only proven by this controlled re-inference.

---

## CASE TABLE (priority)

| case | off text | live text | FineSpan parity | Anchor | feature | sequence | off margin/dec | live probe | primary difference |
|------|----------|-----------|-----------------|--------|---------|----------|----------------|------------|-------------------|
| d002 | IDENTICAL | IDENTICAL | SEQUENCE_DIFFERENT (n=15 both; surface mismatch from idx7) | n/a index | DIFFERENT | DIFFERENT | 背 **+2.10 RETRY** | 背 **−15.24 KEEP**; live RETRY 烦/做/一/杯 | FineSpan + features |
| d003 | IDENTICAL | IDENTICAL | **EXACT** | PARITY | DIFFERENT | PARITY | case RETRY via 烧 | no RETRY | **Features** |
| d019 | IDENTICAL | IDENTICAL | **EXACT** | PARITY | DIFFERENT | PARITY | 上/限/计 RETRY | no RETRY | **Features** |
| d160 | **DIFF** (has「视频的时候」) | shorter | SEQUENCE_DIFFERENT 31→26 | n/a | DIFFERENT | DIFFERENT | 顺 **+3.26 RETRY** | 顺 **−13.32 KEEP** | Text + FineSpan + features |
| d179 | **DIFF** (全认 vs 確認) | DIFF | SEQUENCE_DIFFERENT | n/a | DIFFERENT | DIFFERENT | 全/四 RETRY | no RETRY | Text + features |
| d181 | IDENTICAL | IDENTICAL | **EXACT** | PARITY | DIFFERENT | PARITY | 温 RETRY | no RETRY | **Features** |
| d195 | **DIFF** | DIFF | SEQUENCE_DIFFERENT | n/a | DIFFERENT | DIFFERENT | 对 RETRY | no RETRY | Text + FineSpan + features |
| d137 | IDENTICAL | IDENTICAL | **EXACT** | PARITY | DIFFERENT | PARITY | 杯 RETRY | 烦/一/杯/热 | **Features** (same wrong-region family as live d002) |

---

## d160 (mandatory)

1. **Source text differs:** offline dump ASR includes「视频的时候」; live run does not → FineSpan count 31→26, order shifts so「顺」moves earlier.
2. **Offline dump + RealDist:** RETRY on 顺/向/木 (+3.26 / +1.87 / +1.50).
3. **Live recorded:** 顺 KEEP (−13.32); no RETRY on path.
4. **Live FineSpans + offline feature defaults:** still RETRY 顺/便/向/木 — i.e. **even after ASR/FineSpan change**, offline-style features would still fire; **live feature packing** is what clears RETRY.

**Answer:** d160 failed live primarily because **live feature channels ≠ offline probe defaults**, compounded by **ASR text / FineSpan drift** vs the stale dump.

---

## d002 / d137 (coffee-order wrong region)

### d002

- Text identical.
- FineSpan **surfaces differ** vs historical dump (first mismatch index 7: offline「美」vs live「带」— segmentation inventory changed).
- Offline / live+offline-feats: RETRY **背**.
- Live recorded: **背 KEEP (−15.2)**; RETRY **烦/做/一/杯**.

Activation shifts because **live features** suppress the 背-positive margin seen under cand=0, while making the order-prefix spans RETRY-positive.

### d137

- Exact FineSpan + Anchor parity with dump.
- Same pattern family: live RETRY on 烦/一/杯/热; offline-feat reinfer only 杯.
- Confirms repeated **live feature regime**, not a one-off d002 FineSpan quirk.

---

## SECONDARY FACTORS

| Factor | Applies |
|--------|---------|
| SOURCE_TEXT_DIFFERENCE | YES (d160, d179, d195) |
| FINESPAN_DIFFERENCE | YES (d002, d160, d179, d195) |
| ANCHOR_DIFFERENCE | No on exact-parity cases |
| FEATURE_DIFFERENCE | **YES — decisive** |
| SEQUENCE_DIFFERENCE | YES where FineSpans differ |
| HARNESS_DATA_STALENESS | **YES** (V1-era dump) |
| HARNESS_LOGIC_DUPLICATION | YES (FineSpan/cand path) |
| RUNTIME_INFERENCE_DIFFERENCE | Not indicated when inputs matched under controlled reinfer |
| POSSIBLE_FEATURE_CAPACITY_LIMIT | Possible later — **not established** |
| POSSIBLE_SEQUENCE_SHORTCUT | Possible contributor under cand=0 — not isolated as sole cause |

---

## INFERENCE RUNTIME PARITY

Where FineSpans + offline feature defaults match, margins/decisions match offline → **no** `INFERENCE_RUNTIME_PARITY_FAILURE` for the Python BiGRU path.

Live host uses the same weight file; residual live≠offline-reinfer gap is attributed to **feature inputs**, not a second model.

---

## REPORTING CORRECTIONS (scope only)

| Topic | Correction |
|-------|------------|
| Retry funnel `FINAL_OUTPUT_CHANGED` | Overall dialog text-changed **15** ≠ Retry-subset text-changed **0** — keep separate |
| “Full dialog_200” | Full **Electron mainline path: YES**; full **200-case dataset: NO** (anchored-only **51**) |
| 53→51 | Baseline anchored filter used `model3_v1_dialog200_raw_cases.jsonl`; RealDist run filtered via `model3_v1_feature_contract_dialog200_anchored.jsonl` → 51 IDs — **harness filter source**, not model |

---

## ANSWERS TO ACCEPTANCE QUESTIONS

1. **Why 7/13 ≠ live?** Offline re-scored stale FineSpans with defaulted cand/pinyin; live FineSpans + live features differ.  
2. **d160?** Text/FineSpan drift + live features clear RETRY that offline-style features would still fire.  
3. **d002/d137 wrong region?** Live features suppress 背 RETRY and promote coffee-prefix RETRY; offline-feat reinfer prefers 背/杯.  
4. **Same FineSpan producer?** **NO.**  
5. **Same feature extraction code?** Formula yes; **values no.**  
6. **Same Anchors?** Yes when FineSpans exact.  
7. **Same BiGRU sequence?** Only on exact FineSpan cases.  
8. **Six-feature capacity next?** **Not yet** — fix offline/live input parity first.

---

## NEXT PHASE

**MODEL3_V2_OFFLINE_EVAL_PIPELINE_CORRECTION**

Do not execute here. Scope should make offline claims consume **live PathFineSpans + live feature values** (persist cand/pinyin in traces), then re-measure RealDist before any feature-capacity redesign.

---

## ARTIFACTS

1. `docs/user_correction/model3/Lingua_Model3_V2_Offline_Live_Input_Parity_Audit_2026_08_29.md`
2. `docs/user_correction/model3/model3_v2_offline_live_case_parity.csv`
3. `docs/user_correction/model3/model3_v2_offline_live_finespan_trace.csv`
4. `docs/user_correction/model3/model3_v2_offline_live_parity_summary.json`

---

## HARD STOP

Parity root cause classified; no training; no Model3/feature/architecture changes; next phase not started.
