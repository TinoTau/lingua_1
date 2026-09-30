# Lingua — Model3 V1 Training Coverage / Real-Mainline Trigger Audit

**Phase:** MODEL3_V1_TRAINING_COVERAGE_AUDIT  
**Date:** 2026-08-29  
**Mode:** STRICT READ-ONLY / PRE-TRAINING AUDIT  
**Production / training / model modified:** NO

---

## MAIN VERDICT

| Field | Verdict |
|-------|---------|
| **Primary root cause** | **MULTI_FACTOR** |
| Dominant factors | `MODEL_KEEP_BIAS` (STRONG) + `TRAINING_DATA_COVERAGE_GAP` + `TRAINING_LABEL_SEMANTIC_DRIFT` |
| **Architecture verdict** | **FROZEN_ARCHITECTURE_STILL_VALID** |
| **Training readiness** | **TRAINING_DATA_REDESIGN_REQUIRED** |
| **Next phase** | **MODEL3_V1_TARGETED_TRAINING_DATA_REDESIGN** |

Retry multi-hypothesis correction remains **CLOSED** / accepted. Zero RETRY on dialog_200 is **not** a Retry-consumer failure and **not** “no real targets.”

---

## DIALOG_200 TARGET AVAILABILITY

| Metric | Value |
|--------|------:|
| Cases executed | 53 |
| Exact ASR≈reference | 6 |
| ASR/reference mismatches | **47** |
| High-confidence RETRY-eligible cases (prior case-audit mapped) | **13** |
| High-confidence RETRY-eligible spans | **14** |
| NO_ERROR | 6 |
| ERROR_INSIDE_NON_ANCHOR_FINESPAN | 7 |
| ERROR_REQUIRES_LOCAL_RESEGMENTATION | 6 |
| DELETION_NO_REPAIRABLE_TARGET | 3 |
| UNKNOWN mismatch (no prior family tag) | 31 |
| Outside-Model3-scope (classified) | 0 |
| Anchor-covered errors (classified) | 0 |
| No-FineSpan-target (deletion) | 3 |

**REAL_RETRY_ELIGIBLE_CASE_COUNT ≥ 13 (HIGH).** Additional UNKNOWN mismatches (e.g. 背/杯, 小城/小陈, 更易是龟仔/更衣室) are likely Model3-scope but left **UNKNOWN/LOW** without fabricating labels.

**Conclusion:** RETRY=0 is **not** explained by empty target set.

---

## ANCHOR VISIBILITY

| Metric | Value |
|--------|------:|
| Error spans total (audit lower bound) | 48 |
| Inside Anchor | 0 |
| Non-Anchor | 14 |
| No FineSpan target | 3 |
| ANCHOR_EXCLUSION_RATE | **0** (on classified audit rows) |

Anchors present on 51/53 utterances (acceptance summary) and correctly mask Anchor spans from RETRY. Probe targets (背/烟/成/顺/苏/…) are **non-Anchor** FineSpans that still receive strong KEEP.

**Verdict:** Anchor exclusion is **NOT** the primary cause of zero RETRY. Contract-correct Anchors may still leave repairable non-Anchor text (ARCHITECTURE_TRADEOFF if any residual), but audited eligible errors are already outside Anchor.

---

## FINESPAN TARGET DISTRIBUTION

### All runtime non-Anchor spans (dialog_200 margins, n=3733)

| Length | Count | % |
|--------|------:|--:|
| 1-char | 3620 | 97.0 |
| 2-char | 113 | 3.0 |
| 3+ | 0 | 0 |

### High-confidence RETRY-eligible FineSpan targets (Model3 receives)

| Length | Count |
|--------|------:|
| 1-char | 14 |
| 2+ | 0 |

**Note:** Multi-char *error regions* (顺便向木李, 苏和步, …) map to **1-char FineSpan surfaces** in first-pass Model3 input; region resegment is only after RETRY. Target availability for Model3 is therefore mostly 1-char EXACT_TARGET / OVERSEGMENTED relative to multi-char reference regions — not “no FineSpan.”

---

## TRAINING DATA DISTRIBUTION

Frozen checkpoint: `seed_2026082520` (`MODEL3_SYNTHETIC_V1`).

| Metric | Value |
|--------|-------|
| Architecture | Small BiGRU, ~238k params |
| Synthetic test KEEP (tn) | 190451 |
| Synthetic test RETRY (tp) | 2802 |
| KEEP ratio (eligible) | ≈ **98.5%** |
| RETRY ratio (eligible) | ≈ **1.45%** |
| class_weight_retry | **1.0** (unweighted) |
| Auto class weight | OFF |
| LABEL_BALANCE_STATUS | **KEEP_HEAVY** |
| FineSpan.surface length in training | **100% 1-char** (Full100K + pilot stage2) |
| Synthetic val/test RETRY P/R/F1 | **1.0 / 1.0 / 1.0** |
| REAL_DOMAIN bucket | INSUFFICIENT (0 samples in metrics) |

---

## TRAINING VS RUNTIME COVERAGE

| Dimension | Training | Runtime dialog_200 | Coverage |
|-----------|----------|--------------------|----------|
| Span length 1 | ~100% | ~97% non-Anchor | ADEQUATE volume |
| Span length 2 | 0% | ~3% | **INADEQUATE** |
| Span length 3+ | 0% | 0% on Model3 decisions | N/A |
| Phonetic 1-char RETRY | Dominant | Present (背→杯 etc.) | PARTIAL (model never fires) |
| Multi-char malformed region | Corruption metadata MULTI_CHAR → 1-char spans | Real multi-char regions over 1-char FineSpans | **INADEQUATE** for region semantics |
| Synthetic validation | Perfect | Real RETRY=0 | **SYNTHETIC_TO_REAL_GENERALIZATION_GAP** |
| REAL_DOMAIN training | 0 | Production domains present | **INADEQUATE** |

**SPAN_LENGTH_COVERAGE:** PARTIAL (runtime mostly 1-char like training, but 2-char runtime exists with zero training; multi-char *regions* not represented as Model3 targets).

**MALFORMED_REGION_COVERAGE:** **INADEQUATE** — pilot marks MULTI_CHAR corruptions but Model3 always sees length-1 surfaces; real dialog_200 needs region RETRY without requiring exact-span lexical reachability.

---

## LABEL SEMANTICS

### Generation (`stage2_common.py::label_spans`)

RETRY only if **all** of:

1. non-Anchor  
2. `referenceSurface != surface`  
3. `phoneticCompatible == true`  
4. `referenceReachable == YES` (exact current FineSpan Recall)  
5. not orthographic 的/地/得  

Else KEEP (classes A/B/D).

### phoneticCompatible

| Classification | **TRAINING_ONLY_LABEL_GUARD** |
|----------------|-------------------------------|
| Runtime Model3 feature | NO |
| Affects sample inclusion/labels | YES |

**TRAINING_LABEL_SEMANTIC_PARITY: PARTIAL_DRIFT → MAJOR_DRIFT risk**

- Training encodes: “exact FineSpan is a phonetic, Recall-reachable repair unit.”  
- Frozen runtime Retry means: “local interpretation suspicious → **bounded region** re-segment + re-recall.”  
- Labels that require `referenceReachable=YES` on the **current** FineSpan reject region-level RETRY examples where the exact 1-char window cannot itself recall the multi-char reference.

**LABEL_COVERAGE_CONSTRICTION: YES** (phoneticCompatible + exact-span reachability).

---

## MODEL OUTPUT DISTRIBUTION

Decision rule (host): `RETRY iff retry_logit > keep_logit`; `margin = retry_logit - keep_logit`.

### dialog_200 all non-Anchor (n=3733)

| Stat | Value |
|------|------:|
| margin min | -23.52 |
| margin p50 | **-17.61** |
| margin p95 | -14.88 |
| margin max | **-5.19** |
| margin > 0 (would RETRY) | **0** |
| \|margin\| < 1 (near threshold) | **0** |
| Strong KEEP (margin < -5) | **3733 / 3733** |

### RETRY-eligible probe subset (examples)

| Case | Surface | margin | decision |
|------|---------|-------:|----------|
| d002 | 背 | -16.41 | KEEP |
| d003 | 烟 | -19.00 | KEEP |
| d019 | 成 | -15.72 | KEEP |
| d160 | 顺 | -17.19 | KEEP |
| d179 | 限 | -18.47 | KEEP |

**Near-threshold KEEP: NO.** All outputs are **strong KEEP**.

**MODEL_KEEP_BIAS_EVIDENCE: STRONG**

---

## DECISION CONTRACT

| Item | Finding |
|------|---------|
| Threshold | Logit compare `retry > keep` (no external threshold knob) |
| Class index | logits[...,0]=KEEP, logits[...,1]=RETRY |
| Runtime decoder | `model3_inference_host.py` L207–209 |
| Training packing | Same FEAT_NAMES / dim / encode_surface |
| Sign/inversion | No evidence of inversion |

**DECISION_CONTRACT_PARITY: PASS**  
Not a calibration-threshold bug: model is far from the decision boundary.

---

## FEATURE PARITY

| Feature | Train | Runtime | Status |
|---------|-------|---------|--------|
| isAnchor | sample | span.isAnchor | MATCH |
| span_len_log1p | surface len | surface len | MATCH |
| span_rel_position | index/(n-1) | index/(n-1) | MATCH |
| first_pass_cand_log1p | recallEvidence | PathFineSpan candidates | MATCH (wiring) |
| current_cjk_len_log1p | CJK count | CJK count | MATCH |
| pinyin_channel_avail | featureAvailability | globalSyllables.length>0 | MATCH |

**MODEL3_REQUEST_PARITY: PASS** (field mapping client→host).  
**RUNTIME_FEATURE_DISTRIBUTION: MATCH_ENOUGH** for allowlist dims; zero RETRY is not explained by missing tensors / zero-fill of core features. Distribution shift of *content* (real ASR vs synthetic) remains the generalization issue.

---

## REAL PROBE MATRIX

| case | span | audit expected | actual | margin | notes |
|------|------|----------------|--------|-------:|-------|
| d002 | 背 | RETRY-eligible (phonetic) | KEEP | -16.4 | SUFFICIENT 1-char |
| d003 | 烟 | RETRY-eligible | KEEP | -19.0 | lexicon/tone gaps secondary |
| d019 | 成 | RETRY-eligible | KEEP | -15.7 | single-char contract later |
| d160 | 顺 | RETRY-eligible region | KEEP | -17.2 | needs region resegment |
| d099 | 苏 | RETRY-eligible region | KEEP | -19.6 | SOHO outside lexicon |
| d012 | — | KEEP | KEEP | strong | NO_ERROR control |

---

## MULTI-CHAR MALFORMED REGION

| Plane | Finding |
|-------|---------|
| Training examples | MULTI_CHAR corruptions exist in pilot metadata; **FineSpan.surface always len=1** |
| Runtime targets | d160/d142/d179/… multi-char ASR regions over sequences of 1-char FineSpans |
| MALFORMED_REGION_COVERAGE | **INADEQUATE** |

---

## CONTROLLED TEST SEMANTICS

**CONTROLLED_RETRY_SOURCE: FORCED**

`model3-retry-region.controlled-validation.test.ts` and ASR-env harness **inject** `decision: RETRY` by span index. They validate Retry **consumer** / region / Recall — **not** Model3 trigger quality.

---

## HARNESS STATE PERSISTENCE

**HARNESS_STATE_PERSISTENCE: PERSISTENT**

`ensureServicePreferencesForAcceptance()` writes  
`%APPDATA%/lingua-electron-node/electron-node-config.json` → `servicePreferences`  
and does **not** restore prior values. Nonblocking governance debt (not Model3 architecture).

---

## ZERO RETRY ROOT CAUSE MATRIX

| Cause | evidence_for | evidence_against | affected | confidence | blocking | action |
|-------|--------------|------------------|----------|------------|----------|--------|
| NO_REAL_RETRY_TARGETS | — | 13+ HIGH eligible; 47 mismatches | 0 | HIGH | no | reject |
| ANCHOR_EXCLUDES | many utterances have anchors | eligible probes are non-Anchor; exclusion rate 0 on audit | low | MEDIUM | no | monitor |
| FINESPAN_TARGET_GAP | multi-char regions → 1-char Model3 spans | Model3 still receives FineSpans for error sites | medium | HIGH | secondary | data/region semantics |
| TRAINING_DATA_COVERAGE_GAP | 100% 1-char train; REAL_DOMAIN=0; synthetic≠real | length-1 overlaps runtime majority | high | HIGH | **yes** | redesign data |
| TRAINING_LABEL_BIAS / SEMANTIC_DRIFT | phoneticCompatible + exact-span reachability | business SSOT still phonetic-class RETRY | high | HIGH | **yes** | redesign labels+data |
| MODEL_KEEP_BIAS | all 3733 margins ≤ -5.19; probes KEEP | — | all paths | HIGH | **yes** | follows from data |
| FEATURE_DRIFT / WIRING | — | 6-dim allowlist MATCH; contract PASS | 0 | HIGH | no | none |
| THRESHOLD_CONTRACT_ERROR | — | logit compare correct; not near threshold | 0 | HIGH | no | none |
| CALIBRATION_QUESTION | far from boundary | not a small threshold tweak | — | MEDIUM | no | not first lever |
| TRACE_INTERPRETATION_ERROR | — | decisions_retry=0 matches margins | 0 | HIGH | no | none |

---

## ARCHITECTURE GOVERNANCE

Model3 / FineSpan / Retry / Recall / Domain Vote / Assembly / JobResult / Training code: **unchanged this phase.**  
Frozen architecture remains valid; problem is **training distribution + label semantics vs real mainline**, not ACP.

---

## TRAINING GATES

| Gate | Status |
|------|--------|
| ARCHITECTURE_TRAINING_GATE | **OPEN** |
| DEVELOPMENT_SEQUENCE_GATE | **OPEN** (Retry correction acceptance stands) |
| TRAINING_EXECUTION_GATE | **HOLD** |

Training may start only after targeted data/label redesign is specified and reviewed.

---

## IF RETRAINING — PRECISE DATA CORRECTION PLAN (NOT EXECUTED)

1. **Preserve:** Anchor-conditioned KEEP/RETRY role; text-only allowlist; no Model3 Lexicon/Recall ownership.  
2. **Retire / reduce:** Labels that require exact-span `referenceReachable=YES` when the intended RETRY is **region reinterpretation**.  
3. **Increase:**  
   - malformed 2–5 char non-Anchor regions between Anchors (structural pattern)  
   - real-distribution phonetic substitutions that match dialog_200-like ASR  
   - mix of FineSpan lengths matching runtime (~3% 2-char)  
4. **Label semantics:** RETRY = non-Anchor suspicious local interpretation where bounded Retry Region could help — **not** “current FineSpan alone recalls reference.”  
5. **Do not** memorize dialog_200 references; use as diagnostic / held-out eval only.  
6. **Balance:** address KEEP_HEAVY (~1.5% RETRY) with sampling/weighting only after label semantics fixed.  
7. **Eval:** build formal real RETRY eval set covering the 13 HIGH + curated UNKNOWN mismatches.

---

## NEXT PHASE

**MODEL3_V1_TARGETED_TRAINING_DATA_REDESIGN**

Do not train in that phase until redesign SSOT is frozen; do not change Model3 runtime / FineSpan / Retry consumer.

---

## CHECKLIST

- [x] no production/model/training modified  
- [x] Retry/FineSpan architecture not reopened  
- [x] real RETRY targets counted (≥13 HIGH)  
- [x] Anchor / FineSpan / span length / labels / phoneticCompatible audited  
- [x] raw margins inspected (strong KEEP)  
- [x] decision contract PASS  
- [x] feature parity PASS  
- [x] controlled = FORCED  
- [x] harness persistence = PERSISTENT  
- [x] root-cause matrix + gates produced  

---

## Artifacts

1. This report  
2. `model3_real_retry_target_inventory.csv`  
3. `model3_training_runtime_coverage_matrix.csv`  
4. `model3_training_coverage_audit_summary.json`  
5. `model3_training_coverage_audit_governance.json`
