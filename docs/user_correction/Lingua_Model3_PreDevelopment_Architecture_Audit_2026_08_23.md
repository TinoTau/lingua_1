# Lingua Model3 — Pre-Development Architecture Audit

**Date:** 2026-08-23  
**Stage:** `MODEL3_PREDEVELOPMENT_ARCHITECTURE_AUDIT`  
**Verdict:** **PASS_WITH_GAPS**

**Artifacts:** `training/model2_v3/experiments/model3_predevelopment_architecture_audit_20260823/`

**Audit mode:** READ-ONLY — no production code, training, or Model3 implementation.

---

## Executive Summary

Current FW Repair V4 + Model2 Stage-J production-like path **can** host Model3 as an **anchor-conditioned acoustic-linguistic repair trigger** with **minimum insertion** after Domain Vote / SameDomain anchor formation and **before** sentence assembly and KenLM. Existing Lexicon Recall (`recallSpanTopKV2`), Assembly, and KenLM are **reusable** without a second pipeline.

**Gaps** (closure in contract phase, not main-chain redesign): anchor adapter + provenance persistence before assembly strip, `MODEL3_RETRY_TRACE_V1`, deterministic trigger gate, offline KEEP/RETRY label generator.

Single-Char Repair V1 remains **CLOSED** — Model3 must not reopen length-1 or Model2 single-char paths.

---

## CODE_REALITY vs DOCUMENTED_SSOT

| Topic | Documented SSOT | Code reality | Resolution |
|-------|-----------------|--------------|------------|
| Pipeline order | FW freeze snapshot (2026-08-05) lists Tone/Recall/Vote/Assembly/KenLM without Model2 | **Model2 runs after compatibility, before Domain Vote** (`span-assembly-v4-orchestrator.ts` L332–392) | **CODE_REALITY** — Model2 Stage-J reports supersede |
| Orchestrator header comment | `Tone → Vote → Bucket → Assembly` | **Model2 inserted before Vote** | **ORDER_DRIFT (comment only)** |
| Single-char | V1 freeze 1125 STRICT | bundle 14 active; Model2 absent on length-1 | **Aligned** |
| Model3 | Not created | Not in codebase | **Aligned** |
| JobResult carries internals | Multiple audits: internal only | Model2/trace via `extra` env gates | **Aligned — no JobResult change for Model3** |

---

## Q1–Q22 Explicit Answers

**Q1. Current real ASR post-processing order?**  
ASR → FW normalize → CoarseSpan → FineSpan lattice + **Recall** → per-path: Tone rebind → Compatibility → **Model2 P/D** → **Domain Vote** → **SameDomain** → per-span budget → Assembly → cross-path merge (≤16) → **KenLM** → apply → JobResult. See `model3_current_pipeline_inventory.csv`.

**Q2. Domain Anchor from current SameDomain / Vote?**  
**YES, with adapter (PARTIAL today).** Membership in `DomainFilteredSpanSet.sameDomainCandidates` + `bucketDomain ∈ vote.retainedDomains` + `graphSource ∈ {domain_term, passive_domain_weak}`. No new score; no `anchorSource` field yet.

**Q3. Model2 Anchor from current P/D?**  
**YES, with adapter (PARTIAL).** `WindowCandidate` with `retrievalProvenance ∈ {PROFILE_PRONUNCIATION, PROFILE_DOMAIN}` and `originSpanId`. Lost after assembly strip.

**Q4. Anchor maps to spanId?**  
**PARTIAL.** `fineSpanId` / `PathFineSpan.spanId` stable through Vote; Model2 uses `originSpanId`. **Not** recoverable from `SpanReplacementPick` alone → **SPAN_PROVENANCE_GAP at assembly boundary**.

**Q5. Acoustic/tone evidence per span?**  
**PARTIAL.** `AcousticToneSlice[]`, `toneRebindTrace`, candidate `toneCompatible/tonePenalty`; join via syllable range. No native per-span timestamp. ASR segment confidence **PARTIAL**.

**Q6. Model3 read full user profile?**  
**NO.** Reuse Model2-compressed pronunciation evidence (`selectedActions`, infer result per span). Avoid duplicate `UserProfileV1` parsing.

**Q7. Minimum insertion point?**  
After `runDomainAwareAssembly` (anchors known), **before** `buildSentenceCandidates` — in `span-assembly-v4-orchestrator.ts` per-path loop (~L391+).

**Q8. Model3 before or after first KenLM?**  
**Before first KenLM (recommended).** Option A: conditional Model3 → optional retry → **one** assembly + **one** KenLM. Option B always pays KenLM twice on trigger (~538ms p50 each). Code has no second KenLM path today.

**Q9. One Model3 inference per utterance?**  
**YES — achievable** via `model3Invoked` flag in retry coordinator (CREATE).

**Q10. One retry cycle max?**  
**YES — achievable** via `retryCycleDone` flag; no recursive paths in design.

**Q11. Existing Recall locally reusable?**  
**YES.** `recallSpanTopKV2` / `recallTopKForWindows(subset)` + utterance cache.

**Q12. Retry keeps cap=16?**  
**YES** if single `mergeCrossPathSentenceCandidates` after retry re-assembly — do not stack 16+16.

**Q13. Assembly reusable?**  
**YES** — full re-run `runDomainAwareAssembly` + `buildSentenceCandidates`; no incremental API.

**Q14. KenLM reusable?**  
**YES** — `runFwSentenceRerankFromPrefilled`; single pass after retry recommended.

**Q15. JobResult change?**  
**NO.** Consumers need `text_asr` / translation / TTS only. Model3 via internal trace (Model2 precedent).

**Q16. Trace sufficient for train/debug?**  
**PARTIAL.** Missing anchor mask, Model3 I/O, retry pass id (see Single-Char V1 length1 collector gap).

**Q17. Automatic KEEP/RETRY labels?**  
**PARTIAL.** dialog_200 + traces support measurement; full auto labels need span-reference alignment + counterfactual policy.

**Q18. Real training sources?**  
dialog_200 (primary), Model2 training rows (P/D metadata only), Stage-J JSONL traces. See `model3_training_source_inventory.csv`.

**Q19. Minimum model candidate?**  
**Small BiGRU** utterance encoder + span KEEP/RETRY heads; Transformer only if distant-anchor ablation requires it.

**Q20. Local KenLM collapse risk?**  
**YES if mis-designed.** Prevent via acoustic/tone/pronunciation input channels + training contract forbidding n-gram-only features. Role audit flag: **MODEL3_ROLE_COLLAPSE_TO_LOCAL_LM** if phrase-frequency-only.

**Q21. Old Detector / Suspicious conflicts?**  
`detectSuspiciousSpansV1` archived; `shadowBeamSpanSets` removed; `selectKenlmSuspiciousSpans` test-only — **do not reintroduce** as Model3. length1 fail-closed **must not be bypassed**.

**Q22. Minimum files to add/modify?**  
**MODIFY:** `span-assembly-v4-orchestrator.ts` (hook only). **CREATE:** `model3-runtime/*` (types, anchor adapter, inference host, retry coordinator, trace). **DO_NOT_TOUCH:** recall-span-topk-v2, Model2 runtime, Domain Vote SSOT, Single-Char V1, bundle 14. See `model3_development_target_list.csv`.

---

## Required Verdict Block

```
MODEL3_PREDEVELOPMENT_ARCHITECTURE_AUDIT:
PASS_WITH_GAPS
```

```
Model3 Pre-Development Architecture Audit:
PASS_WITH_GAPS

================================================
CURRENT CHAIN
================================================

Actual Runtime Order:
ASR → FW → CoarseSpan → FineSpan+Recall → ToneRebind → Compatibility → Model2 P/D → Domain Vote → SameDomain → Assembly → Merge(≤16) → KenLM → Apply → JobResult

Architecture Drift:
YES (orchestrator comment + stale freeze snapshot; runtime matches Stage-J docs)

================================================
ANCHORS
================================================

Domain Anchor Ready:
PARTIAL

Model2 Anchor Ready:
PARTIAL

Stable Span Provenance:
PARTIAL

Anchor Discovery By Model3:
FORBIDDEN

================================================
EVIDENCE
================================================

ASR/FW Evidence:
PARTIAL (segments, slices; no per-span native confidence object)

Tone Evidence:
PARTIAL (acousticTonePattern, toneRebind, candidate tone fields)

Pinyin Evidence:
AVAILABLE (windowPinyinKey — text/syllable derived; must label provenance)

User Pronunciation Evidence:
PARTIAL (UserProfileV1 via Model2; Model3 should reuse Model2 snapshot)

Major Evidence Gaps:
Assembly strips provenance; no anchor export; length1 collector trace env-only

================================================
MODEL3
================================================

Role:
Anchor-conditioned Acoustic-Linguistic Repair Trigger

Input Granularity:
Utterance-level span sequence + anchor mask + evidence features

Inference Granularity:
ONE PER TRIGGERED UTTERANCE

Output:
KEEP / RETRY

Anchor Mutation:
FORBIDDEN

Text Generation:
FORBIDDEN

Lexicon Lookup:
FORBIDDEN

================================================
INSERTION
================================================

Recommended Insertion Point:
After runDomainAwareAssembly; before buildSentenceCandidates (per path loop)

Before/After First KenLM:
BEFORE (single KenLM after optional retry)

Reason:
Anchors available; avoids double KenLM; retry reuses same assembly/merge/cap path

================================================
RETRY
================================================

Existing Recall Reusable:
YES

Second Recall Pipeline Required:
NO

Retry Cycles:
MAX 1

Model3 Calls:
MAX 1

Candidate Cap:
16

================================================
DOWNSTREAM
================================================

Assembly Reusable:
YES (full re-run)

KenLM Reusable:
YES (single rerank)

Model3 Final Judge:
NO

================================================
TRAINING
================================================

Automatic Label Generation:
PARTIAL

Real Training Sources:
dialog_200; Stage-J traces; Model2 rows (metadata)

Synthetic Pipeline Available:
PARTIAL

Major Training Gaps:
Anchor mask export; span-ref alignment; retry counterfactual label policy

================================================
PERFORMANCE
================================================

Current Baseline:
Stage-J p50: ASR 2252ms, FW step 1947ms, Model2 29ms, KenLM 538ms, postprocess 5884ms

Model3 Trigger Rate:
NOT_MEASURED

Recommended Model Budget:
5-15ms inference per trigger; + partial recall + single KenLM if retry

Candidate Architecture:
Small BiGRU (preferred preliminary)

================================================
TRACE
================================================

Current Trace Sufficient:
PARTIAL

Minimum New Trace Fields:
MODEL3_RETRY_TRACE_V1 (anchor, model3Decision, retryPassId, reRecall, kenlm)

JobResult Change:
NO

================================================
CONFLICTS
================================================

Old Detector Conflict:
ARCHIVED SuspiciousSpan — do not re-wire

Old Single-Char Model2 Logic:
REMOVED — do not revive

Shadow Retry Path:
NONE in production

================================================
DEVELOPMENT SCOPE
================================================

KEEP:
Recall, Model2, Domain Vote, Assembly, KenLM, Single-Char V1

MODIFY:
span-assembly-v4-orchestrator.ts (hook only)

CREATE:
model3-runtime (adapter, inference, retry coordinator, trace)

DELETE_LATER:
legacy suspicious-span archive (reference only)

DO_NOT_TOUCH:
recall-span-topk-v2, Model2 training, bundle 14, JobResult schema

================================================
DECISION
================================================

Safe To Develop Model3:
YES

Required Gaps Before Development:
Anchor adapter; MODEL3_RETRY_TRACE_V1; trigger gate contract; label generator

Architecture Change Proposal Required:
NO

Recommended Next Phase:
MODEL3_CONTRACT_AND_TRAINING_DESIGN
```

---

## Diagrams

- Current: `model3_current_pipeline_diagram.md`
- Target: `model3_target_pipeline_diagram.md`
- Dataflow: `model3_dataflow_diagram.md`

---

## Hard Stop

Audit complete. **No Model3 code, training, or production changes made.** Await user review before `MODEL3_CONTRACT_AND_TRAINING_DESIGN` or `MODEL3_GAP_CLOSURE`.
