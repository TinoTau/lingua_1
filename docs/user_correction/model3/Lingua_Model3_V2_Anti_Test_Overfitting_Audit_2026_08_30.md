# Lingua Model3 V2 Acoustic Training-State Anti-Test-Overfitting Audit

**Phase:** `MODEL3_V2_ACOUSTIC_TRAINING_STATE_ANTI_TEST_OVERFITTING_AUDIT`  
**Date:** 2026-08-30  
**Mode:** READ-ONLY — no code/test change · no Gate0 acceptance · no dataset · no training  

================================
MAIN VERDICT
============

Audit verdict: **SELF_FULFILLING_GATE_FOUND**

Business logic test-overfitted: **PARTIAL**  
(formal harness owner chain is largely production-shaped; Gate0/tests can accept injected flags without independent proof)

Known-case logic found: **NO in business path** (IDs only in holdout registry / exclusion)

Self-fulfilling Gate risk: **YES** (hardcoded Gate0 flags + string-search “wired” + injectable `ownerExecution`)

Protected holdout leakage: **NO** (exclusion / collision only)

Formal/runtime owner parity: **MOSTLY SAME_OWNER** (Model2/Domain/pack/normalize/lattice present; cand counted on lattice FineSpan as production first-pass)

Architecture drift: **NO** (orchestration-only; JobResult untouched)

Central question answer: **Not fully.** Removing current tests/fixtures would leave the formal harness plausible, but **Gate0 as written can still “pass” on empty/injected batches** without proving live owner outcomes. Gate0 evidence independence must be corrected before acceptance.

================================
KNOWN CASE SEARCH
=================

case IDs (`d002`…`d195`):
- **holdout_registry.py / protection registry only** → class **A** (exclude/collision)
- formal harness / orchestrator / serializer / tests: **no ID literals**

known surfaces (背/烧/对/…):
- **no matches** in acoustic_training, formal harness, or `test_acoustic_training_state.py`

business-path dependencies: **none (no category C)**

================================
FIXTURE / INJECTION
===================

`materialize_utterance_from_parts(..., lattice=...)` accepts a full injected lattice including `ownerExecution`.  
Used by unit tests to avoid live Electron/Model2 hang.

- Formal fresh path (`materialize_fresh_batch`) calls harness with `lattice=None` → **no bypass branch inside CJS**.
- Same Python API is Gate0-feedable: injected `ownerExecution=true` would be trusted by Gate0 → **TEST_SUPPORT API on shared entrypoint = injectability risk** (not a CJS `if fixture` bypass).

No formal-path `if injected → skip expandActiveCandidatesWithModel2`.

================================
ENVIRONMENT / BYPASS
====================

| Variable | Formal effect | Test/smoke effect | Equivalence |
|----------|---------------|-------------------|-------------|
| `TONE_P10_VAD_CPU` | recorded in manifest only (`orchestrator`); not read by CJS harness | prior probe env | AUTHORIZED_RUNTIME_OPTION when set by operator; **not defaulted by Gate0 code** |
| `MODEL2_RUNTIME_DISABLED` | **not set by formal modules**; Model2 owner still respects it inside production expand (load fail → UNAVAILABLE) | used in one **manual smoke** during implementation, not in unit tests | AUTHORIZED_RUNTIME_OPTION / operational; must **not** be Gate0 default |
| `ELECTRON_RUN_AS_NODE` | harness launch | same | tooling |
| `PROJECT_ROOT` | lexicon/runtime root | same | tooling |

No `*_TEST` / `*_MOCK` / `*_FORCE` formal defaults found in `acoustic_training/`.

No BUSINESS_PATH_BYPASS env that skips Domain/Model2/Tone in formal CJS.

================================
MODEL2
======

owner invocation proof: **YES in formal CJS** — `await expandActiveCandidatesWithModel2({...})` inside path loop after lattice/compat; output `expanded.candidates` fed to vote + `materializeModel3Anchors`.

status derivation:
- `MODEL2_ANCHOR_OWNER_WIRED: true` constant in harness response object (static)
- `MODEL2_ANCHOR_OWNER_EXECUTED = true` set **immediately before** await (means “attempted”, even if throw → catch sets UNAVAILABLE)
- `HOST_AVAILABLE` / `HIT_OBSERVED` / `model2AnchorStatus` derived from diagnostics / anchors

test-specific bypass: **none in CJS**; unit tests inject lattice flags without calling expand.

Gate0 “WIRED” check: source contains `"expandActiveCandidatesWithModel2"` **and** `"MODEL2_ANCHOR_OWNER_WIRED"` — second clause is **tautological** (searches for the flag name the harness writes).

================================
DOMAIN / ANCHOR
===============

Domain: `voteUtteranceDomainFromPool(toVotePoolsFromActive(...))` then `materializeModel3Anchors` — real owner calls.  
`toVotePoolsFromActive` is orchestration adapter (not a fake Domain Vote).

Anchor NONE: `anchorById.has(spanId) ? source : "NONE"` after owners run — means no qualifying evidence, not “skipped owners”.  
Skipped owners rejected in Python provenance if WIRED but not EXECUTED.

UNAVAILABLE vs NONE: Model2 host fail → `model2AnchorStatus=UNAVAILABLE`; span `anchorSource` can still be NONE — **distinct fields** (OK). BLOCKED = HARD_REJECT code when owners skipped.

================================
TONE / RECALL / CAND
====================

Tone: requires non-empty `acousticToneSlices` or `TONE_STATE_MISSING` (fail-closed). No dictionary-tone substitute in formal path.  
`mapToneEvidenceForRecall` + `resolveToneRecallReadiness` used (Mandatory Tone path).  
Risk: `readiness.state || "ready"` defaults empty state to **ready** (silent soften — P2/P1 edge).

Recall: lattice `runLatticeFineSpanGeneration` with acoustic slices; no Plain Recall restore in formal harness.

Cand: `model3FirstPassCandidateCount(s)` on lattice PathFineSpan (pre-Model2 merge onto span candidates) — matches production first-pass packing.  
Serializer `or 0` if count missing → **synthetic 0 risk** if incomplete spans serialized (should fail-closed) — P1.

================================
FINESPAN / MULTIPATH
====================

Formal CJS iterates **all** `pathFineSpanViews`; serializer emits **one sample per path**.  
No `paths[0]` / primary-only collapse in formal path.

================================
PACKER / FEATURES
=================

`packModel3SpanInferFields` called in CJS; serializer copies `packedInfer` / `packedInferFields`.  
No Python reimplementation of six formulas in `acoustic_training/`.  
Parity: **PASS** (assuming harness spans retained through label merge — orchestrator copies packed from harness spans onto labeled spans).

================================
ALIGNMENT / LABEL
=================

`label_spans_v2` only; no post-label KEEP/RETRY mutation; no surface/case rules.  
Error-family taxonomy not used for labels in formal modules.

================================
HOLDOUT
=======

Registry IDs/texts → `check_holdout` HARD_REJECT or source exclusion only.  
No flow into cand/Anchor/label/pack. **No PROTECTED_HOLDOUT_LEAKAGE.**

================================
SEMANTIC FAMILY / SPLIT
=======================

`semanticFamilyId = hash(referenceId|whitespace-stripped text)` — independent of labels/ASR/audio.  
`materializationRunId` not used in `assign_split`.  
Near-dup policy optional via `near_dup_key` but not auto-applied — coverage gap (P2), not overfitting.  
Different `referenceId` + identical text → different families (by design).

================================
GATE0 EVIDENCE INDEPENDENCE
===========================

| Gate0 signal | Raw evidence | Calculation | Injectability | Verdict |
|--------------|--------------|-------------|---------------|---------|
| formal_harness_exists | filesystem | `HARNESS.exists()` | low | OK |
| MODEL2_ANCHOR_OWNER_WIRED | harness **source text** | substring `expand…` **and** `MODEL2_ANCHOR_OWNER_WIRED` | medium (edit source / tautology) | **SELF_FULFILLING_RISK** |
| DOMAIN_ANCHOR_OWNER_WIRED | source text | substring vote+anchors | medium | weak but OK-ish |
| MODEL2/DOMAIN_*_EXECUTED | `utt.ownerExecution` | count flags | **high** via `lattice=` inject | **INJECTABLE** |
| HOST_AVAILABLE_ANY / HIT_* | same flags | boolean | **high** | **INJECTABLE** |
| cand_0 / cand_gt0 / retry_cand_gt0 | labeledPaths counts | derived | high if fixtures | OK if batch real |
| multipath_retention | pathCount | `>1` **or empty batch → True** | empty auto-pass | **SELF_FULFILLING_RISK** |
| semanticFamily_split_lock | family/split rows | `assert_split_locked` | medium | OK |
| semantic_exclude_distinguished | **none** | **`True` hardcoded** | n/a | **SELF_FULFILLING** |
| hard_reject_distinguished | **none** | **`True` hardcoded** | n/a | **SELF_FULFILLING** |
| empty-batch EXECUTED soft rule | WIRED && no samples | lines 87–89 | empty pass | **SELF_FULFILLING_RISK** |

================================
TEST QUALITY
============

| test | type | proves | does not prove |
|------|------|--------|----------------|
| PCM encode | CONTRACT | float→PCM nonzero | live ASR |
| family stable / no run in family | CONTRACT | split identity math | near-dup policy |
| holdout id / materialize reject | CONTRACT | exclusion gate | unlabeled protected text edge cases |
| text identity OpenCC / mismatch | CONTRACT | identity gate | live OpenCC via Node |
| NO_REPAIRABLE_TARGET | CONTRACT | SEMANTIC_EXCLUDE classifier | V2 region richness |
| harness wires Model2/Domain | CONTRACT / string | symbols exist in file | runtime invocation / host |
| legacy preferred | CONTRACT | both files exist | legacy unreachable forever |
| injected lattice supervise | FIXTURE_ONLY | Python post-harness path | live Model2/Tone/ASR |
| Model2 not executed HARD_REJECT | CONTRACT | provenance skip detect | live expand |
| Gate0 evaluate_structure | FIXTURE_ONLY | checker returns ids/flags | independent evidence |
| *(no REAL_PATH unittest)* | — | — | live expand+ASR+Tone e2e |

================================
MUTATION COVERAGE REVIEW
========================

| Mutation | Detected by current 13 tests? |
|----------|-------------------------------|
| cand silently forced 0 in serializer | **NO** (TEST_COVERAGE_GAP) |
| Model2 call removed from CJS | **partial** (string test only; not runtime) |
| Domain Vote removed | **partial** (string only) |
| paths collapsed to primary | **NO** |
| packer replaced by Python formulas | **NO** |
| fake Tone slices accepted as supervised | **NO** (only empty-slice hard reject) |
| protected case allowed | **YES** (id test) |
| familyId includes run hash | **YES** (family tests) |
| NO_REPAIRABLE_TARGET as HARD_REJECT | **YES** (classifier test) |

================================
PROBE → FORMAL PARITY
=====================

| step | probe (extension era) | formal | parity |
|------|----------------------|--------|--------|
| normalize | normalizeForFwRepairInput | same | SAME_OWNER |
| ASR/FW | /utterance | same (orchestrator) | SAME_OWNER |
| Tone | AcousticToneSlice same-run | same | SAME_OWNER |
| Mandatory Tone Recall | lattice+readiness | same | SAME_OWNER |
| FineSpan | runLatticeFineSpanGeneration | same | SAME_OWNER |
| multipath | all views | all views | SAME_OWNER |
| Model2 | **absent in legacy probe CJS** | **expandActiveCandidatesWithModel2** | FORMAL_ADDITION_EXPECTED |
| Domain Vote | voteUtteranceDomainFromPool | same (+ pool adapter) | SAME_OWNER |
| Anchor | materializeModel3Anchors | same | SAME_OWNER |
| packer | packModel3SpanInferFields | same | SAME_OWNER |
| alignment/label | V2 | V2 | SAME_OWNER |

================================
FINDINGS
========

**P0:** *(none)* — no protected→label leakage; no known-case business branches; no architecture redefinition of Model3/Tone/Recall/FineSpan.

**P1:**
1. **SELF_FULFILLING_GATE** — Gate0 hardcodes `semantic_exclude_distinguished` / `hard_reject_distinguished = True`; empty-batch multipath/EXECUTED soft-pass; WIRED check tautology on flag string.
2. **INJECTABLE Gate0 evidence** — `ownerExecution` / lattice injectable via shared `materialize_utterance_from_parts`; Gate0 trusts flags rather than requiring harness-run identity / Model2 diagnostics artifacts.
3. **Serializer `or 0` cand fallback** — missing count becomes synthetic valid 0 instead of fail-closed.

**P2:**
- No REAL_PATH unit test for live Model2 host / multipath / packer non-collapse.
- `readiness.state || "ready"` silent default.
- Near-duplicate family auto-policy not enforced.
- HOST_AVAILABLE formula edge (`inv || !model2Diag`).

**P3:**
- Legacy harness still on disk (labeled LEGACY; probes redirected) — cleanup clarity only.
- Gate0 WIRED should assert call-site AST/import, not flag identifier string.

================================
GOVERNANCE
==========

Model3 / Model2 / Tone / Recall / FineSpan / Anchor / Retry / JobResult **responsibility changed:** **NO**  
(formal code orchestrates existing owners; Model2 expand was missing from probe harness and is correctly added as orchestration)

================================
NEXT PHASE
==========

Exactly one: **`MODEL3_V2_GATE0_EVIDENCE_INDEPENDENCE_CORRECTION`**

Do not execute.
