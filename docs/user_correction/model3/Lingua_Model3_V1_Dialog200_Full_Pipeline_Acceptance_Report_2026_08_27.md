# Lingua Model3 V1 — dialog_200 Full Pipeline Acceptance Report

**Phase:** `MODEL3_V1_DIALOG_200_FULL_PIPELINE_ACCEPTANCE`  
**Date:** 2026-08-27  
**Verdict:** `PASS`

---

## 1. Scope

Validation only. No retrain, tuning, Domain Vote / Model2 / Recall / Assembly / KenLM / budget changes.

Authorities read: Synthetic V1 freeze/seal, mainline integration report/bundle/governance/acceptance CSV, rollback manifesto, corrected plan.

SSOT doc fixes (this phase):

- `MODEL3_SYNTHETIC_V1_FROZEN.md` — removed stale “Production RETRY OFF / not wired”; roadmap no longer defaults to Shadow Integration.
- `README.md` — same roadmap correction.

Observation-only (not business logic): `dialog200_path_trace.paths[].model3` under `MODEL2_DIALOG200_TRACE=1`.

---

## 2. Environment

| Component | Status |
|-----------|--------|
| ASR (faster-whisper-vad :6007) | READY |
| Node test server :5020 | READY |
| Lexicon V2 | READY |
| Model2 Stage-J | READY |
| Model3 sidecar `MODEL3_SYNTHETIC_V1` | READY (hash verified) |
| KenLM | READY |

Weights SHA256 `9d25234a…24b815` / config hash `f32e3de4…22830` — **YES**.

Unit tests before batch: **12/12 PASS**.

---

## 3. Coverage

| Metric | Value |
|--------|------:|
| dialog_200 total | 200 |
| Attempted | 200 |
| Completed | 200 |
| Failed | 0 |
| Skipped | 0 |
| Full acceptance dataset | **YES** |
| Wall clock | 1378 s (~23 min) |

Runner: `electron_node/electron-node/tests/run-dialog200-model3-acceptance.mjs` (reuses start-node / `/run-pipeline-with-audio`).

---

## 4. Integration invariants (live)

| Invariant | Result |
|-----------|--------|
| Domain Vote calls per path | **1** (all paths) |
| Second vote violations | **0** |
| Stale pool violations | **0** (no RETRY mutation) |
| Anchor retry attempts | **0** |
| Anchor mutation violations | **0** |
| Recursive Model3 | **0** |
| Global KenLM pool >16 | **0** |

---

## 5. Anchor distribution

| Metric | Value |
|--------|------:|
| Utterances with Anchor | 53 |
| Utterances without Anchor | 147 |
| Domain Anchors | 103 |
| Model2 Anchors | 60 |
| Dual-source Anchors | 60 |
| Anchors / utterance | 0.515 |
| Rejected pre-vote domain evidence | 0 |

---

## 6. Model3 behavior

| Metric | Value |
|--------|------:|
| Paths processed | 411 |
| Non-anchor spans | 9811 |
| KEEP | 9811 |
| RETRY | **0** |
| RETRY rate | **0** |
| RETRY spans / utterance | 0 |
| Trigger precision / recall / F1 | **N/A** (zero RETRY positives) |

**Interpretation:** On this Piper-TTS dialog_200 ASR set, Model3 never requested RETRY. The RETRY→Recall→rescue chain was **not exercised**.

---

## 7. Recall rescue

| Metric | Value |
|--------|------:|
| Retry attempts | 0 |
| Candidate yield | N/A |
| Zero-candidate rate | N/A |
| Reference reachability after retry | N/A |
| Rescue rate | **0** (no RETRY) |

---

## 8. Final text (PRIMARY)

Classification: normalized Levenshtein to `expectedText` — final vs raw ASR.

| Class | Count | Rate |
|-------|------:|-----:|
| IMPROVED | 66 | **0.33** |
| UNCHANGED | 134 | 0.67 |
| REGRESSED | **0** | **0** |
| UNDETERMINED | 0 | 0 |

**Critical attribution:**

- `improved_with_model3_retry` = **0**
- All 66 IMPROVED cases had `decisions_retry = 0`

Therefore mainline final-text gains are from **existing** post-ASR path (normalization / Model2 / Assembly / KenLM), **not** Model3 RETRY.

Offline Synthetic F1 ≈0.968 is **not** used as the acceptance criterion.

---

## 9. Failure ownership

| Class | Count |
|-------|------:|
| ANCHOR_ERROR | 0 |
| MODEL3_TRIGGER_ERROR | 0 (no harmful wrong RETRY; under-trigger noted separately) |
| RECALL_NO_RESCUE | 0 |
| ASSEMBLY_ERROR | 0 |
| DOWNSTREAM_SELECTION_ERROR | 0 |
| ASR_UNRECOVERABLE | 0 |
| TEST_INFRA_ERROR | 0 |
| NONE | 200 |

No REGRESSED cases to tabulate.

---

## 10. Latency (real pipeline)

| Metric | ms |
|--------|---:|
| Model3 p50 | 7 |
| Model3 p95 | 12 |
| Model3 p99 | 18 |
| KEEP-only delta p50 | 10 |
| KEEP-only delta p95 | 52 |
| Retry path p50/p95 | 0 / 0 (unused) |
| Total post-ASR Model3+retry delta p50 | 10 |
| Total post-ASR Model3+retry delta p95 | 52 |

Selective-cost design: KEEP path stays low-ms; no RETRY overhead observed.

---

## 11. Decision

| Question | Answer |
|----------|--------|
| Mainline integration safe on dialog_200? | **YES** (0 regression, invariants hold) |
| Model3 RETRY useful on dialog_200? | **NO** (0 RETRY) |
| Recall rescue effective? | **N/A** (not exercised) |
| Rollback recommended? | **NO** |
| Ready to freeze as “trigger proven”? | **NO** — KEEP-path proven; RETRY unproven on this corpus |
| Primary bottleneck | **MODEL3** (under-activation on this EVAL set) |
| Recommended next phase | `MODEL3_V1_RUNTIME_TRIGGER_ERROR_AUDIT` on harder / real-error ASR (or accept KEEP-path freeze separately) |

**Verdict `PASS`:** full-pipeline acceptance completed; architecture holds; no material regression; Model3 identity/hash verified. Effectiveness gap is **trigger under-use**, not integration breakage.

---

## 12. Artifacts (6)

1. This report  
2. `model3_v1_dialog200_acceptance_summary.json`  
3. `model3_v1_dialog200_case_results.csv`  
4. `model3_v1_dialog200_failure_analysis.csv`  
5. `model3_v1_dialog200_latency.csv`  
6. `model3_v1_dialog200_governance.json`  

Consolidated case trace also retained as `model3_v1_dialog200_raw_cases.jsonl` (single file, not per-utterance spam).
