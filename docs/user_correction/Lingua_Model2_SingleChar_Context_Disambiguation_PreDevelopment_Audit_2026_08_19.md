# RETIRED / HISTORICAL / SUPERSEDED BY MODEL2 P/D ROLLBACK DECISION (2026-08-20)

**Status:** RETIRED. Not authoritative Model2 architecture. Model2 is P/D ONLY.
Do not re-enable this capability without a new Architecture Change Proposal and explicit user approval.

---

# Lingua Model2 — Single-Char Context Disambiguation Pre-Development Audit

**Date:** 2026-08-19  
**Stage:** `MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_PRE_DEVELOPMENT_AUDIT`  
**Type:** AUDIT ONLY / READ ONLY — ACP draft, no implementation  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/model2_single_char_context_disambiguation_predev_audit_2026_08_19/`  
**ACP:** `docs/user_correction/MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_ACP.md`

未改 production code、Model2 权重、词库、SQLite、minPrior、collector、FineSpan、Assembly、KenLM、Candidate Budget、Domain Vote、JobResult。未训练。未用 dialog_200 expectedText 作 runtime 输入。

---

## 0. Authoritative reconstruction

当前冻结主链（代码 + `STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1` + `FW_REPAIR_V4_POST_TRACE_FREEZE_V1` + Stage J freeze 2026-08-18）：

```
ASR → FineSpan → Lexicon Recall → Model2 P/D retrieval expansion
  → materialize/merge → DomainAwareAssembly → KenLM → JobResult → NMT
```

- **ONE** `RetrievalPolicyV3(with_domain_head=True)`，checkpoint `expA_frozen_trunk.pt` sha256 `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda`，47210 params。
- Model2 实际职责：在 FineSpan + UserProfile 上选择 **有界检索原语**（7 个 BOUND 拼音关系 + `domain_soft:{slot}` / `domain_none`），不是选汉字。
- Length-1：独立 unique-tone collector（`recall-span-topk-v2.ts` L641+）。歧义 fail closed。Model2 **会**对该 FineSpan 做 P/D 推理，但 **看不到** 已被丢掉的同音同调集合。
- 独立 HOLD（前几轮，本轮不解）：Repair lexicon 未冻结；minPrior 与 IME prior 不兼容；CLD GPL。

用户批准的新边界：**Lexicon 拥有候选宇宙；Model2 仅在无法唯一确定时做上下文消歧。** 这是 ACP，不是 drift。

---

## 1. Feasibility

同一 sidecar、同一模块、**新增有界 select/abstain head**（类比 Stage D 的 `domain_action_head`），冻结 trunk 以防 P 回退。不需要第二模型、第二主链、LLM、规则表。

现有 `action_head` **不能**直接当候选排序器（Option B REJECT）。

开发顺序 **B**：先 candidate-set 接口 + 合成候选集训练，再绑定运营词库。禁止 1125 维字符 class。

生产上线仍依赖：Repair lexicon 冻结 + minPrior/prior ACP（均为 HOLD）。

---

Model2 Single-Char Context Disambiguation Audit:
FEASIBLE_WITH_SMALL_CHANGE


================================================
CURRENT MODEL2
================================================

Production Models:
1 × RetrievalPolicyV3(with_domain_head=True) @ expA_frozen_trunk.pt sha256 d66847be…beda params=47210. Tone CNN / KenLM are separate frozen subsystems, not Model2.


Single Model Confirmed:
YES


Current Responsibility:
Bounded retrieval policy: Stage P phonetic-relation actions + Stage D domain_soft/none. Not vocabulary, not character generation, not sentence correction.


Current Action Space:
50 action_head (identity + 7 single BOUND relations + 42 composed_pair; runtime decodes SINGLE only, query_budget_op=1) + 13 domain actions (domain_none + 12 slots).


Candidate-Set Decision Already Supported:
NO


Abstain Supported:
NO


Context Already Available:
PARTIAL


================================================
CURRENT SINGLE-CHAR PATH
================================================

Lexicon Owner:
base_lexicon length-1 rows sourced from IME 2510 (not a wordhood-validated repair lexicon)


Candidate Generation Owner:
Recall collectBaseOnlySingleCharCandidate (unique-tone / surface-exact; cap=1; no fuzzy; no domain)


Model2 Currently Involved:
YES


Correct Model2 Insertion Point:
After lexicon eligible set (collectBaseOnlySingleCharCandidate), only if N>1; before unique-only collapse and before Assembly. Not before lexicon query. P/D orchestrator hook KEEP separately.


Existing Materialization Reusable:
YES


================================================
AMBIGUITY
================================================

0 Candidate:
existing fallback; Model2 MUST NOT invent


1 Candidate:
materialize; Model2 MUST NOT run


Multiple Same-Pinyin-Tone:
current MULTIPLE_TONE_EXACT_CANDIDATES fail-closed; PRIMARY Model2 case (select/abstain)


Polyphonic:
schema multi-row PK (pinyin_key, word) OK; collector does not union readings; Model2 not required unless Recall later unions


Tone Missing:
tone not ready → no SQL (1.1C); Model2 MUST NOT invent; KEEP frozen fallback


Cases Requiring Model2:
C only (N>1 same acoustic pinyin+tone). Not A/B/E. D/G only if a later Recall ACP unions readings.


================================================
LEXICON CONTRACT
================================================

Separate Repair Lexicon Required:
YES


Operations Own Membership:
YES


Operations Own Pronunciation Metadata:
YES


Model2 Can Generate New Character:
NO


Model2 Can Change Lexicon:
NO


Vocabulary Update Requires Retraining:
NO


================================================
MODEL2 CONTRACT
================================================

Model2 Role:

CONTEXT_DISAMBIGUATION_ONLY


Input Candidate Set:
Lexicon/Recall bounded eligible list for the acoustic queryTonePinyinKey (N>=2, cap<=8); deterministic order; no invented surfaces


Context Inputs:
existing rawText left/right slices + span syllables + optional UserProfile/domain evidence as rank-only features (no new context service)


Output:
SELECT / ABSTAIN


Open Vocabulary:
NO


Second Model Required:
NO


Second Pipeline Required:
NO


================================================
TRAINING
================================================

Existing Model Can Support Task:
YES


Training Extension Required:
YES


New Head Required:
YES


New Model Required:
NO


Existing Task Interference Risk:
MEDIUM


Held-Out Generalization Required:
YES


================================================
DOWNSTREAM
================================================

FineSpan Change:
NO


Recall Change:
YES


Materialization Change:
NO


Assembly Change:
NO


KenLM Change:
NO


Candidate Budget Change:
NO


JobResult Change:
NO


================================================
FROZEN COMPONENTS
================================================

Model2 Existing P/D Behavior:
KEEP


FineSpan:
KEEP unless explicitly required


Assembly:
KEEP


KenLM:
KEEP


Candidate Budget 16:
KEEP


Domain Vote:
KEEP


IME 2510 Inventory:
KEEP


================================================
ACP
================================================

Architecture Change Required:
YES


Recommended Architecture:
OPTION A — same RetrievalPolicyV3, conditional ambiguity task, new select/abstain head, candidate-relative features, invoke only when length=1 and N>1. Keep P/D hook. One main chain.


Smallest Required Code Change:
Recall: emit internal bounded set when N>1 instead of dropping. Model2 host: extra tensors + ambiguity_head; fail closed on error. Materialize 0 or 1 via existing WindowCandidate/bind. No JobResult fields.


Smallest Required Training Change:
Freeze trunk + P/D heads; train new head on synthetic varied candidate sets with ABSTAIN; held-out characters/combinations/contexts. Not dialog_200. Not 1125-way char softmax.


Rejected Alternatives:
Option B reuse action_head as candidate ranker; Option C second model/LLM; Option D rule/regex/polyphonic table; shadow/dual/compatibility paths; Model2 open-vocab; in-place replace IME 2510; frequency Top1.


================================================
DECISION
================================================

Proceed To Development:
NO


Proceed To Training:
NO


Lexicon Must Be Finalized First:
NO


Recommended Development Order:
B — candidate-set interface + synthetic-set training, then bind Operations lexicon. Production still needs later lexicon freeze + minPrior ACP (independent HOLDs). Do not train a closed character inventory.


Recommended Next Phase:
WAIT_USER_CONFIRM_ACP then CANDIDATE_SET_INTERFACE_V1 (still no sqlite import, no minPrior change, no training until ACP confirmed)
