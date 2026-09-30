# Lingua Model3 V1 — Training / Runtime FineSpan Representation Audit

**Phase:** `MODEL3_V1_TRAINING_RUNTIME_FINESPAN_REPRESENTATION_AUDIT`  
**Date:** 2026-08-28  
**Mode:** READ-ONLY  
**Result:** **TRAINING_REPRESENTATION_GAP**

---

## Verdict

Production Model3 **does** receive multi-character `FineSpan.surface` values (dialog_200: **113 / 3733 = 3.03%** length-2).  
Frozen training materialization (Full100K / STRICT / pilot) is **100% length-1**.

Root finding: **`RUNTIME_MULTI_CHAR_AND_TRAINING_GENERATOR_LIMITED`**

This is **not** a business ban on multi-char FineSpans. Lattice windows allow 1–5 syllables; fallback edges are 1-syllable. Training synthetic inputs + path`[0]` fragmentation bias fail to emit the multi-char edges that real ASR paths sometimes select.

**Prior pilot “MULTI_CHAR” gap is two different things:**

| Concept | Reality |
|---------|---------|
| Multi-char **corruption / char-diff region** | Common in EVAL_PROXY (often PARTIAL_OVERLAP / MULTIPLE_FINESPANS) |
| Multi-char **Model3 FineSpan.surface** | Exists in production (~3% len-2); **absent** in training (0%) |

---

## A. Production FineSpan (actual Model3 inputs)

**Source:** `model3_v1_runtime_margin_analysis.csv` (dialog_200 Model3 decisions).

| Length | Count | % |
|-------:|------:|--:|
| 1 | 3620 | 96.97 |
| 2 | 113 | 3.03 |
| 3 | 0 | 0 |
| 4+ | 0 | 0 |
| **Total** | **3733** | 100 |

All 3733 decision rows have `isAnchor=False` (export = non-anchor Model3 decisions).  
Anchor adapter surfaces in feature-contract jsonl include **112× length-2** anchors (masked from RETRY).

**Production supports multi-char FineSpan: YES**

Evidence path: `rawText.slice(span.rawStart, span.rawEnd)` in `model3-feature-pack.ts` / `run-model3-path-step.ts`. Length comes from lattice **LexicalEdge** (window 1–5) or **fallback** (1 syllable)—not from a “must be char” contract.

---

## B. Frozen EVAL_PROXY (153) → production FineSpan mapping

Do **not** treat char-diff length as FineSpan length.

| Mapping | Count |
|---------|------:|
| EXACT_ONE_FINESPAN | 56 |
| PARTIAL_OVERLAP | 54 |
| MULTIPLE_FINESPANS | 20 |
| NO_RETRYABLE_FINESPAN | 23 |
| **Total** | **153** |

**MULTI_CHAR_REPLACEMENT (68):** mostly `PARTIAL_OVERLAP` (45) + `MULTIPLE_FINESPANS` (18); only 5 exact one FineSpan. Many matched FineSpans are length-1 while proxy region is longer.

**INSERTION (5):** MULTIPLE_FINESPANS / PARTIAL_OVERLAP — maps to existing FineSpans, not a new gap type.

**DELETION (3):** all `PARTIAL_OVERLAP`. Production does not expose an “empty gap FineSpan”; deletion regions attach to neighboring spans.

**CHARACTER_FORM_VARIANT (13):** `NO_RETRYABLE_FINESPAN` / non-Model3 ownership — consistent with prior audit.

---

## C. Training FineSpan lengths

| Corpus (sampled) | RETRY 1-char | RETRY 2+ | KEEP 1-char | KEEP 2+ |
|------------------|-------------:|---------:|------------:|--------:|
| Full100K train | 679 | **0** | 160886 | **0** |
| STRICT reconstruction | 2500 | **0** | 58790 | **0** |
| Natural KEEP / NO_ANCHOR proxy | — | **0** | (all 1-char) | **0** |
| Hard KEEP | Reuses Full100K/STRICT KEEP universe | | length-1 | |
| Real-distribution pilot | 4512 | **0** | 20322 | **0** |

**Why length-1:** `DATA_GENERATOR_LIMITATION` (primary).

- Synthetic V1 historically generated **1-char phonetic** RETRY corruptions.
- `stage2_materialize` calls **production** `runLatticeFineSpanGeneration` but only `pathFineSpanViews[0]`; path ranking prefers **more lexical edges** → finer fragmentation on short synthetic text.
- Probe: even lexicon words like「医院」in templates still materialized as two length-1 FineSpans under stage2.
- **Not** `BUSINESS_CONTRACT` forbidding multi-char FineSpans (architecture allows 1–5 syllable windows).

---

## D. Training / runtime parity

| Aspect | Parity |
|--------|--------|
| Span identity | PASS |
| Surface semantics | PASS |
| **Length semantics** | **FAIL** |
| Offsets | PASS |
| Ordering | PASS |
| Anchor | PASS |
| Candidate / pinyin features | PASS (after feature-contract fix) |
| **Overall** | **FAIL** |

---

## E. `phoneticCompatible` ownership

| Plane | Used? |
|-------|------:|
| Training generation (`isPhonetic`) | YES |
| Stage2 materialization | YES |
| Label assignment (`label_spans`) | YES |
| Runtime Model3 features | **NO** |
| Recall API | **NO** (reachability probed separately) |

**Ownership: MIXED**

- **Business SSOT:** YES — RETRY is for repairable pronunciation/acoustic-class sites (`model3_training_label_contract_v1.md`, `model3_retry_contract_v1.md`).
- **Boolean field:** training-only materialization guard + paired with `referenceReachable=YES` (Recall reachability proxy). Allowlist: `model_visible: false`.
- Distinguishes: “Model3 should RETRY phonetic-class errors” ≠ “runtime consumes a phoneticCompatible feature bit.”

**Do not remove in this phase.**

---

## F. Pilot status

`MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT` — **unchanged**.

| Item | Status |
|------|--------|
| Integrity | PASS |
| Training readiness | **HOLD_REPRESENTATION_GAP** |

Pilot MULTI_CHAR metadata covers multi-position corruption patterns on **1-char** FineSpans. It does **not** close the production multi-char FineSpan.surface gap (~3% len-2).

Deletion pilot rows: accepted via overlapping 1-char RETRY labels — flag **Deletion Representation Mismatch: YES** (training fabricates local RETRY targets; production deletion is PARTIAL_OVERLAP on neighbors, not gap FineSpans).

---

## G. Decision

| Item | Value |
|------|-------|
| Train pilot now | **NO** |
| Primary blocker | Training length-1-only vs runtime multi-char FineSpan presence + multi-span error composition |
| Smallest next correction | Training-only: make stage2 outputs emit multi-char PathFineSpans matching production length mix **without** changing production FineSpan/Model3 architecture |
| Next phase | `MODEL3_V1_TRAINING_FINESPAN_LENGTH_PARITY_CORRECTION` |

**Architecture:** Model / Feature / Runtime FineSpan / Architecture change required: **NO**.  
Training materializer / path-selection **potentially** required: **YES** (if input construction alone cannot yield multi-char edges).

---

## Governance

Read-only. No runtime / training / dataset / model / architecture edits.  
Artifacts: **5**. HARD STOP — await review.
