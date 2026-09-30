# Lingua Model3 — Contract and Training Design Report

**Date:** 2026-08-23  
**Stage:** `MODEL3_CONTRACT_AND_TRAINING_DESIGN`  
**Verdict:** **PASS**

**Contract SSOT:** `docs/user_correction/model3/MODEL3_ARCHITECTURE_CONTRACT_V1.md`  
**Artifacts:** `training/model2_v3/experiments/model3_contract_and_training_design_20260823/`  
**Prior audit:** `Lingua_Model3_PreDevelopment_Architecture_Audit_2026_08_23.md` (`PASS_WITH_GAPS`)

**This round:** contracts · training design · trace design · stage plans · SSOT order sync only.  
**Not done:** Model3 runtime · training · retry · corpus generation · JobResult / Recall / Model2 / Domain Vote / Assembly / KenLM / Single-Char V1 behavior changes.

---

## Summary

Closed remaining Model3 contracts so Stage1 can proceed with **zero final-text behavior change**:

- Anchor sources frozen: **DOMAIN / MODEL2 / DOMAIN_AND_MODEL2** only; no scores.
- Input/output/retry/trace/label contracts frozen; Model3 stays KEEP/RETRY trigger.
- Active Architecture SSOT + orchestrator **header comment** updated to CODE_REALITY order including Model2 before Domain Vote.
- Training: RETRY requires repairability; hard negatives + contrast pairs required; BiGRU baseline preferred.

---

## Required Verdict Block

```
Model3 Contract & Training Design:
PASS


================================================
ROLE
================================================

Model3 Role:
Anchor-Conditioned Acoustic-Linguistic Repair Trigger


Anchor Discovery:
FORBIDDEN


Anchor Mutation:
FORBIDDEN


Text Generation:
FORBIDDEN


Lexicon Lookup:
FORBIDDEN


Final Judge:
NO


================================================
ANCHOR
================================================

Allowed Sources:

DOMAIN
MODEL2
DOMAIN_AND_MODEL2


Other Sources:
FORBIDDEN


Domain Anchor Rule:
Member of retained SameDomain bucket for bucketDomain ∈ vote.retainedDomains;
domain-eligible graphSource; in current active candidate state; Base alone NEVER anchors.


Model2 Anchor Rule:
Materialized retained WindowCandidate with retrievalProvenance ∈
{PROFILE_PRONUNCIATION, PROFILE_DOMAIN} and originSpanId binding;
inference-only / non-materialized FORBIDDEN.


Anchor Score:
NONE


================================================
INPUT
================================================

Granularity:
One inference per eligible path-local span sequence (≤1 retry-enabling call/utterance)


Required Fields:
spanId; surface; offsets; isAnchor; anchorSource; targetMask;
retainedDomainEvidence; pinyinEvidence(+provenance); toneEvidence(+provenance);
acousticEvidence(status); pronunciationEvidence(Model2-compressed); recallEvidence


Full UserProfile:
NO


Span Provenance:
fineSpanId / originSpanId only — no text reconstruction


Tone Provenance:
ACOUSTIC_REBIND | RECALL_CANDIDATE | ABSENT (no invented confidence)


Pinyin Provenance:
TEXT_DERIVED_SYLLABLE_KEY | ABSENT (never labeled acoustic)


================================================
OUTPUT
================================================

Allowed Action:

KEEP
RETRY


Scores In Business Contract:
NO


Anchor Retry:
FORBIDDEN


================================================
TRIGGER
================================================

Deterministic:
YES


Minimum Conditions:
hasAnchor AND hasEligibleNonAnchorTarget
(+ optional existing tone/length1/Model2 repair signals; no score stack)


Weighted Score:
NO


KenLM Trigger:
NO


================================================
RETRY
================================================

Model3 Calls:
MAX 1


Retry Cycles:
MAX 1


Anchor Modified:
NO


Domain Re-Vote:
NO


Existing Recall:
REUSED


Second Recall Pipeline:
NO


Candidate Cap:
16


================================================
ASSEMBLY / KENLM
================================================

Assembly:
REUSED


KenLM:
ONE FINAL PASS


Model3 Replaces KenLM:
NO


================================================
TRAINING LABEL
================================================

ASR != Reference Means RETRY:
NO


RETRY Requires Repairability:
YES


Anchor Masked From Loss:
YES


Hard Negatives:
REQUIRED


Contrast Pairs:
REQUIRED


================================================
MODEL
================================================

Baseline Candidate:
Small BiGRU


Comparison Candidate:
Tiny Transformer Encoder


Large LM:
FORBIDDEN


Generation Decoder:
NO


================================================
PERFORMANCE
================================================

Inference Granularity:
ONE PER ELIGIBLE UTTERANCE


Initial Model Budget:
5–15ms CPU p50 engineering target


Trigger Rate:
TO_MEASURE


================================================
TRACE
================================================

MODEL3_RETRY_TRACE_V1:
FROZEN


JobResult Change:
NO


End-to-End Debuggable:
YES (when Stage1 emits contract fields)


================================================
DEVELOPMENT STAGES
================================================

Stage1:
Anchor + provenance + trace
NO BEHAVIOR CHANGE


Stage2:
Offline labels


Stage3:
Offline baseline training


Stage4:
Generalization


Stage5:
Shadow runtime


Stage6:
One-shot retry


Stage7:
Acceptance


Stage8:
Freeze


================================================
SSOT
================================================

Current Runtime Order Updated:
YES


Model3 Contract SSOT:
docs/user_correction/model3/MODEL3_ARCHITECTURE_CONTRACT_V1.md


Single-Char V1:
UNCHANGED


Model2:
P_D_ONLY


================================================
DECISION
================================================

Contracts Ready:
YES


Safe To Start Stage1:
YES


Recommended Next Phase:
MODEL3_STAGE1_ANCHOR_PROVENANCE_TRACE_DEVELOPMENT
```

---

## Artifact Index

| Area | Path |
|------|------|
| Architecture contract | `docs/user_correction/model3/MODEL3_ARCHITECTURE_CONTRACT_V1.md` |
| Anchor / Input / Output / Retry | `docs/user_correction/model3/model3_*_contract_v1.md` |
| Trace | `docs/user_correction/model3/model3_retry_trace_v1_contract.md` |
| Training | `docs/user_correction/model3/model3_training_*` |
| Model / Perf | `docs/user_correction/model3/model3_baseline_model_candidate_plan.md`, `model3_performance_contract_v1.md` |
| Stage1–3 plans | `training/.../model3_contract_and_training_design_20260823/model3_stage*_*.{csv,md}` |
| Governance checks | `training/.../model3_no_*.json`, `go_summary.json` |

---

## Hard Stop

Contract + training design complete. **No Model3 implementation, training, or retry.**  
Await user approval for **`MODEL3_STAGE1_ANCHOR_PROVENANCE_TRACE_DEVELOPMENT`**.
