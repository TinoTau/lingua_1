# Lingua — Model3 V2 Retry Reinterpretation Signal-Loss Audit

Date: 2026-09-01  
Phase: `MODEL3_V2_RETRY_REINTERPRETATION_SIGNAL_LOSS_AUDIT`  
Mode: READ-ONLY CAUSAL AUDIT (frozen harness replay)

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| **Verdict** | **`RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_LOCAL_RESEGMENTATION`** |
| **Primary first-fail owner** | **`LOCAL_RESEGMENTATION`** (84 / 141 proven rescuable) |
| **Secondary owners** | LEXICON_COVERAGE (39), MODEL3_TRIGGER (12), RETRY_REGION (6) |
| **BASELINE_WRONG** | **166** (frozen 170 rescuable claim **not** revalidated) |
| **Proven MODEL3_RESCUABLE** | **141** (strict repairability) |
| **Final IMPROVED / REGRESSED** | 1 / 0 (1 case ASR-run variance vs frozen 0/0) |
| **Architecture** | PASS (no invariant violations observed) |
| **S3** | Unchanged, identity exact |
| **Next phase** | **`MODEL3_V2_LOCAL_RESEGMENTATION_CORRECTION_DESIGN_AUDIT`** |

**Previous RETRY_REGION primary assignment is NOT supported.** Only **6 / 141** rescuable cases first-fail at Retry-region geometry; **131** prior count is **unsupported** as first-fail owner.

Do **not** implement fixes in this phase.

================================
PREVIOUS CLASSIFICATION CORRECTION
==================================

| Prior claim | Audit result |
|-------------|--------------|
| MODEL3_RESCUABLE = 170 | **Recomputed: 141** (29 reclassified: 25 NO_REPAIRABLE_TARGET + 4 baseline-wrong boundary shift) |
| BASELINE_WRONG implicit 170 | **166** (34 baseline already correct vs prior 30) |
| RETRY_REGION primary, 131 cases | **Unsupported** — first-fail RETRY_REGION = **6** |
| ASSEMBLY defect = 17 | **Partially supported** — 11 CONFIRMED_ASSEMBLY_LOSS, 4 TRACE_CLASSIFICATION_ERROR, 2 NOT_ASSEMBLY_LOSS |

Prior broad “RETRY_REGION_NO_USEFUL_REINTERPRETATION” mixed **any-candidate-return ≠ target return** with region geometry; this audit separates them.

================================
REPAIRABILITY
=============

| Class | Count (P0=200) |
|-------|---------------:|
| BASELINE_ALREADY_CORRECT | 34 |
| **BASELINE_WRONG** | **166** |
| **MODEL3_RESCUABLE** | **141** |
| NO_REPAIRABLE_TARGET | 25 |
| OUTSIDE_MODEL3_SCOPE | 0 |
| REFERENCE_OR_ALIGNMENT_AMBIGUOUS | 0 |
| INSUFFICIENT_EVIDENCE | 0 |

Strict rescuable requires: baseline wrong + alignment-derived local correction units + non-Anchor FineSpan coverage + repair expressible via frozen Retry→Recall→Assembly→KenLM. **Not all baseline-wrong cases are Model3-rescuable.**

================================
MODEL3 TRIGGER
==============

Among **141** MODEL3_RESCUABLE (P2):

| Trigger class | Count |
|---------------|------:|
| TARGET_OVERLAP | 123 |
| TARGET_ADJACENT_SAME_LOCAL_REGION | 6 |
| UNRELATED_RETRY_ONLY | 3 |
| NO_RETRY | 9 |

**129 / 141** have target-relevant logical RETRY (overlap or adjacent). Model3 trigger is **not** the dominant first-fail blocker (12 first-fail only).

================================
RETRY REGION
============

| Coverage (best region vs error) | Count |
|---------------------------------|------:|
| PARTIALLY_COVERS_EXPECTED_ERROR | 114 |
| FULLY_COVERS_EXPECTED_ERROR | 9 |
| MISSES_EXPECTED_ERROR | 9 |
| NO_TARGET_REGION | 9 |

**123 / 141** regions cover error (full or partial). **First-fail RETRY_REGION = 6** — geometry alone does **not** explain most signal loss.

Anchor crossing / unrelated KEEP crossing: **0** observed.

================================
LOCAL RESEGMENTATION
====================

| Metric | Count |
|--------|------:|
| resegmentOk=true (any region) | 41 / 141 |
| First-fail LOCAL_RESEGMENTATION | **84 / 141** |

Dominant pattern: Model3 triggers and Retry region often covers error, but **bounded regional lattice fails to expose a repair-capable segmentation** (`resegmentOk=false` or surfaces unchanged). This is the **first proven loss stage** for most rescuable cases.

Multipath retained in traces; no first-path-only collapse observed in audit samples.

================================
LEXICON REACHABILITY
====================

Lexicon checked read-only (exact surface + pinyin, frozen bundle).

| Metric | Count |
|--------|------:|
| First-fail LEXICON_COVERAGE | 39 / 141 |
| Funnel: all lexical units in lexicon | 0 / 141 |

No rescuable case had **all** alignment-derived expected lexical units confirmed in authoritative lexicon via exact lookup. Many failures are **multi-char correction units** or phonetically divergent targets — counts treat missing lexicon as **LEXICON_COVERAGE**, not Recall (HARD STOP D respected).

================================
RECALL REACHABILITY
===================

| Metric | Count (denominator = 141 rescuable) |
|--------|--------------------------------------:|
| ANY_CANDIDATE_RETURN | 120 |
| **TARGET_CANDIDATE_RETURN** | **21** |
| First-fail RECALL_QUERY | 0 (Recall not first-fail when upstream fails) |

**148 baseline-wrong + candidate return (prior)** ≠ **21 target candidate return (audit)**. Generic candidate return is **not** proof of correct-target recall.

================================
CANDIDATE SURVIVAL
==================

| Stage | PASS count |
|-------|----------:|
| PATH_RECOVERABLE (MaterializableTarget V1) | 0 |
| ASSEMBLY_MATERIALIZED | 0 |
| ASSEMBLY_CLOSER_PROXY (REFERENCE_CLOSER_PROXY) | 19 |
| KENLM_AVAILABLE | 0 |
| FINAL_IMPROVED | 1 |

Downstream survival is rare because upstream local resegmentation / lexicon gates fail first.

================================
ASSEMBLY — PREVIOUS 17 REVALIDATION
===================================

| Outcome | Count |
|---------|------:|
| CONFIRMED_ASSEMBLY_LOSS | 11 |
| TRACE_CLASSIFICATION_ERROR | 4 |
| NOT_ASSEMBLY_LOSS | 2 |

Prior “17 Assembly drops” **overstates** confirmed Assembly defects. Closer-to-reference proxy often fired **without** target candidate reaching Assembly input.

================================
KENLM
=====

KenLM first-fail: **0** (no case reached KenLM with viable repair sentence). Prior 1 pool fingerprint change remains downstream of upstream signal loss.

================================
FIRST-FAIL OWNER DISTRIBUTION (141 rescuable)
=============================================

| Owner | Count |
|-------|------:|
| **LOCAL_RESEGMENTATION** | **84** |
| LEXICON_COVERAGE | 39 |
| MODEL3_TRIGGER | 12 |
| RETRY_REGION | 6 |

Loss is **MULTI_STAGE** across the rescuable set, but **first-fail** prioritization yields **LOCAL_RESEGMENTATION** as highest-value proven blocker.

================================
ARCHITECTURE INVARIANTS
=======================

| Check | Result |
|-------|--------|
| Second Domain Vote | 0 |
| Anchor RETRY actionable | 0 |
| Recursive Model3 | 0 |
| Candidate cap >16 | 0 |
| JobResult | unchanged |

================================
GOVERNANCE
==========

Model3 / Retry / Recall / Lexicon / Assembly / KenLM / JobResult / ASR / training / dataset: **NO change**.

Audit script only: `run-retry-reinterpretation-signal-loss-audit.mjs` (read-only collector + analyzer).

================================
REQUIRED DECISIONS (D1–D46)
===========================

| ID | Answer |
|----|--------|
| D1 | YES — S3 SHA exact |
| D2 | YES — harness V1_20260831 |
| D3 | YES — 166 BASELINE_WRONG (not 170 rescuable) |
| D4 | **141** proven MODEL3_RESCUABLE |
| D5 | **25** NO_REPAIRABLE_TARGET |
| D6 | **0** OUTSIDE_MODEL3_SCOPE |
| D7 | **0** alignment ambiguous |
| D8 | **129** target-relevant RETRY |
| D9 | **3** unrelated RETRY only |
| D10 | **9** no RETRY |
| D11 | **9** full region cover |
| D12 | **114** partial cover |
| D13 | **9** miss |
| D14 | **0** Anchor crossing |
| D15 | **0** unrelated KEEP crossing |
| D16 | **41** viable resegmentation exposed |
| D17 | **84** first-fail LOCAL_RESEGMENTATION |
| D18–D19 | Lexicon: **0** all-units-in-lexicon; **39** first-fail missing |
| D20–D23 | Target reachability: **21** returned; filtering not first-fail |
| D24–D26 | Eligibility/budget/path: blocked upstream |
| D27–D28 | Assembly input rare; **0** materialized target sentences |
| D29 | **11** confirmed Assembly loss of 17 |
| D30–D32 | KenLM: **0** viable input / selection |
| D33 | Distribution above |
| D34 | **NO** — RETRY_REGION not primary |
| D35 | **YES** — LOCAL_RESEGMENTATION primary |
| D36 | Secondary — LEXICON_COVERAGE (39) |
| D37 | **NO** — Recall not primary first-fail |
| D38 | **NO** |
| D39 | **NO** — Assembly not primary (11 confirmed subset) |
| D40 | **NO** |
| D41 | **YES** — multi-stage loss across population |
| D42 | **YES** — prior 131 RETRY_REGION unsupported |
| D43 | **NO** violations |
| D44 | **NO** architecture change required (design audit next) |
| D45 | `RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_LOCAL_RESEGMENTATION` |
| D46 | `MODEL3_V2_LOCAL_RESEGMENTATION_CORRECTION_DESIGN_AUDIT` |

================================
NEXT PHASE
==========

**`MODEL3_V2_LOCAL_RESEGMENTATION_CORRECTION_DESIGN_AUDIT`**

Design-only audit of bounded regional lattice / resegmentation exposure — **do not execute automatically**.  
Do not retrain Model3, change Retry merge policy, or patch Lexicon without user review.

Wait for user review.
