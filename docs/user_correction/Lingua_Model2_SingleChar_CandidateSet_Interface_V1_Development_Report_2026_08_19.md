# RETIRED / HISTORICAL / SUPERSEDED BY MODEL2 P/D ROLLBACK DECISION (2026-08-20)

**Status:** RETIRED. Not authoritative Model2 architecture. Model2 is P/D ONLY.
Do not re-enable this capability without a new Architecture Change Proposal and explicit user approval.

---

# Lingua Model2 — Single-Char Candidate-Set Interface V1 Development Report

**Date:** 2026-08-19  
**Stage:** `MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_STAGE1_CANDIDATE_SET_INTERFACE_V1_AND_AMBIGUITY_HEAD_SKELETON`  
**ACP:** `MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_ACP` (approved)  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/model2_single_char_candidate_set_interface_v1_2026_08_19/`

未训练 ambiguity head；未导入 CLD / Strict / Balanced；未改 2510 IME、sqlite 词表、minPrior、priorScore、FineSpan、Assembly、KenLM、Budget 16、Domain Vote、JobResult、冻结 checkpoint。

## What landed

内部合同 `SingleCharDisambiguationContractV1`：相对 `candidate_index`，输出只能是 SELECT/ABSTAIN。

Recall：N≥2 且非截断、且 unique-only 未命中时，构造 cap≤8 的内部集合 `singleCharAmbiguousSet`。**hits 仍为 0 或 1**（默认安全语义 `MULTIPLE_TONE_EXACT_CANDIDATES` 保留）。集合不进入 Assembly。

同一 sidecar 新增 `cmd=disambiguate`。现网 `infer` JSON 不变。无验收权重时一律 **ABSTAIN / HEAD_NOT_AVAILABLE**（不 argmax 未训练 logits，不选 candidate0）。

`RetrievalPolicyV3(..., with_ambiguity_head=False)` 为默认；`forward()` 不含 ambiguity。冻结 `expA_frozen_trunk.pt` 仍 strict load，params=47210。

Test-only decider：`SELECT_TERM_ID` / `SELECT_INDEX` / `ABSTAIN`。生产路径不使用。

Jest 13/13 PASS。Python frozen-load + optional-head isolation PASS.

## Success criterion

Architecture boundary 已安全落地；单字纠错 **尚未工作**（无训练权重）。Production Ready: **NO**。

---

Single-Char Candidate-Set Interface V1:
PASS


================================================
ARCHITECTURE
================================================

ONE Model2:
YES


Second Model:
NO


Second Pipeline:
NO


Lexicon Owns Candidate Universe:
PASS


Model2 Context Disambiguation Only:
PASS


Open Vocabulary:
NO


================================================
ROUTING
================================================

N=0:
existing fallback; no request


Ambiguity Invocation Count:
0


N=1:
existing unique/surface-exact materialization


Ambiguity Invocation Count:
0


N>1:
internal bounded set; sidecar/test decider; production ABSTAIN


Ambiguity Invocation:
YES


ABSTAIN:
PASS


Fail Closed:
PASS


================================================
CONTRACT
================================================

Candidate-Relative:
YES


Fixed Hanzi Classes:
NO


Candidate Reorder Safe:
PASS


Output Always In Candidate Set:
PASS


Candidate Limit:
8


================================================
MODEL2
================================================

Same Sidecar:
YES


Ambiguity Head Skeleton:
PRESENT


Real Ambiguity Weights:
NO


Frozen P/D Checkpoint Still Loads:
YES


P/D Behavior Changed:
NO


================================================
DOWNSTREAM
================================================

Existing Materialization Reused:
YES


Assembly Changed:
NO


KenLM Changed:
NO


Candidate Budget Changed:
NO


Domain Vote Changed:
NO


JobResult Changed:
NO


================================================
LEXICON
================================================

Production Repair Lexicon Imported:
NO


IME 2510 Changed:
NO


CLD Imported:
NO


================================================
MINPRIOR
================================================

minPrior Changed:
NO


priorScore Changed:
NO


Still Independent HOLD:
YES


================================================
TRAINING
================================================

Training Performed:
NO


Training Interface Ready:
YES


Label Contract:
ABSTAIN + RELATIVE_INDEX


Held-Out Character Gate Defined:
YES


================================================
GOVERNANCE
================================================

ACP Conformance:
PASS


Architecture Drift:
NO


Shadow Path:
NO


Compatibility Path:
NO


Fixed-Case Logic:
NO


================================================
DECISION
================================================

Stage 1 Development:
PASS


Ready For Ambiguity Training:
YES


Production Ready:
NO


Recommended Next Phase:

MODEL2_SINGLE_CHAR_AMBIGUITY_HEAD_TRAINING_V1
