# Lingua Model2 — Invocation Granularity and Single-Char Batching Audit

**Date:** 2026-08-19  
**Stage:** `MODEL2_INVOCATION_GRANULARITY_AND_SINGLE_CHAR_BATCHING_PREDEVELOPMENT_AUDIT`  
**Type:** AUDIT ONLY / READ ONLY  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/model2_invocation_granularity_single_char_batching_audit_2026_08_19/`

未改 production 代码、未训练、未改 Model2 / Recall / FineSpan / Lexicon / Assembly / KenLM / Budget / JobResult / minPrior。未重跑 ASR。

权威基线：Candidate-Set Interface V1 PASS；Ambiguity head training **HEAD_ONLY_INSUFFICIENT**；P/D 冻结无回归；checkpoint `expA_frozen_trunk.pt` sha256 `d66847be…beda`。实验 ambiguity 权重不得进入本性能方案。

---

## 主问题答案

可以。单字 N>1 决策应在 **已有 utterance / path Recall 结束处收集**，用 **同一 sidecar** 一次 batch `disambiguate`，而不是每个 length-1 FineSpan 一次 IPC。

**不要**为了「整句一次 inference」去重写已经 per-FineSpan 的 P/D 生命周期。P/D 今天已经是 FineSpan 线性（dialog_200：P50=20 次 `infer`）。单字只允许 **额外 IPC ≤ 1**。

---

## 当前生命周期（真实代码）

`expandActiveCandidatesWithModel2` 对 **每个 path 的每个 FineSpan** `await host.infer`。Python `infer` 里 **一次** `model.forward` 同时出 P 与 D（`one_inference: true`）。Node→Python JSONL FIFO，不能并行。

`disambiguate` 已存在，生产 Recall **未调用**；无训练 head 时 fail-closed ABSTAIN。

UserProfile：每 job 注入 `JobContext`，但每个 span 的 infer JSON **重复序列化** profile 字段。dialog_200 无 profile → P retrieval 全 0。

单字 context（左右 `rawText`）在 FineSpan/window 已存在；冻结 `encode()` 仍不含汉字。本轮不设计 encoder。

收集点：`recallSpanTopKV2` 已挂 `singleCharAmbiguousSet`。自然位置是 lattice/path materialization 之后、Domain Vote 之前，仍属 Recall 内部。禁止 Recall → SingleCharService → Model2 → Recall2。

---

## 频率

4477 个 1-char **window** ≠ Model2 次数。其中 N>1 = 1046（23.4%）。当前生产单字 Model2 调用 = **0**（fail-closed + minPrior）。若按 window 做 per-span 附加调用，约 **+5.2 IPC/句** 叠在已有 ~20 次 P/D 上。

---

## 选项

- **A per-span：** REJECT。IPC 风暴。
- **B utterance batch：** ACCEPT。最少合同（`requests[]`），infer JSON 不动。
- **C merge P/D infer：** 技术上 PARTIAL（该 span 反正会 infer），但破坏 Stage 1 infer 冻结，且 head 不可用。NOT_WORTH_COMPLEXITY。
- **D 复用 h：** 不能补汉字上下文。REJECT。

---

Model2 Invocation Granularity Audit:
PERFORMANCE_RISK_FOUND


================================================
CURRENT MODEL2
================================================

Model2 Models:
1


Sidecars:
1


P Calls Per Utterance:
P50 20 (same forward as D; P retrieval executed P50 0 on dialog_200)
P95 31
MAX 37


D Calls Per Utterance:
forward P50 20 (shared); D retrieval executed P50 5 / P95 9 / MAX 10


Total IPC Round Trips Per Utterance:
P50 20  P95 31  MAX 37  (cmd=infer only; disambiguate=0)


Total Model Inferences Per Utterance:
P50 20  P95 31  MAX 37  (not 2× for P+D)


Current Model2 Latency:
P50 ~3 ms per warm sidecar infer (jest); training-harness P P50 52 ms is NOT this path
P95 ~4 ms per warm infer; utterance total NOT IN TRACE (estimate ~20× IPC sequential)


================================================
CURRENT GRANULARITY
================================================

P:
PER_SPAN (shared forward)


D:
PER_SPAN (shared forward)


Current Batch Support:
PARTIAL


Profile Payload:
PER_UTTERANCE on Node; PER_SPAN serialized into infer JSON


================================================
SINGLE CHAR FREQUENCY
================================================

Length-1 Windows:
4477


Actual N>1 Ambiguity Sets:
1046 (collector MULTIPLE_TONE_EXACT_CANDIDATES)


Ambiguity Per Utterance:
P50 ~5 (1046/200 mean 5.23; window proxy)
P95 not in per-dialog histogram
MAX unbounded by window count


Estimated Additional Calls If Per-Span:
~5 mean extra IPC on top of 20 existing


================================================
OPTION A — PER SPAN
================================================

Additional IPC:
~5 / utterance mean (proxy)


Additional Inference:
~5


Latency Risk:
HIGH


Complexity:
LOW code / HIGH runtime


Verdict:
REJECT


================================================
OPTION B — UTTERANCE BATCH
================================================

Additional IPC:
0 or 1


Additional Inference:
1 (internal batch allowed)


Code Change:
host batch wrapper + Recall collect (not this round)


Complexity:
LOW / MEDIUM


Verdict:
ACCEPT


================================================
OPTION C — MERGE WITH EXISTING P/D
================================================

Technically Feasible:
PARTIAL


Requires P/D Contract Change:
YES


Inference Can Be Shared:
YES (same span already inferred)


Expected Benefit:
0 extra IPC


Regression Risk:
MEDIUM


Complexity:
MEDIUM


Verdict:
NOT_WORTH_COMPLEXITY


================================================
OPTION D — FEATURE / INFERENCE REUSE
================================================

Feasible:
encode() reuse yes; decision quality no


Expected Benefit:
none vs HEAD_ONLY_INSUFFICIENT


Complexity:
MEDIUM


Verdict:
REJECT


================================================
RECOMMENDATION
================================================

Recommended Invocation Strategy:
Utterance (or path) single-char disambiguateBatch; keep P/D per-span


Reason:
P/D already FineSpan-linear. Do not add another linear term. One extra IPC is enough. Do not rewrite P/D.


Expected Max Additional Model2 Calls Per Utterance:
1


Candidate-Set Interface V1:
KEEP


Main Chain:
UNCHANGED


Single-Char Logic Remains Inside Lexicon Recall:
YES


Second Model:
NO


Second Pipeline:
NO


================================================
PERFORMANCE CONTRACT
================================================

Per-Single-Char-Span Model2 Call:
FORBIDDEN


Batch Ambiguities Per Utterance:
YES


Merge Into Existing Model2 Call:
NOT_WORTH_COMPLEXITY


Recommended Additional IPC Limit:
<= 1 per utterance


Recommended Trace Metrics:
model2_total_calls, model2_p_calls, model2_d_calls, single_char_ambiguity_count, single_char_model2_calls, model2_total_latency_ms


================================================
FROZEN
================================================

Lexicon Owns Candidates:
YES


Recall Owns Retrieval:
YES


Model2 Owns Decision Only:
YES


FineSpan Change:
NO


Assembly Change:
NO


KenLM Change:
NO


Candidate Budget Change:
NO


JobResult Change:
NO


Training:
NO


================================================
DECISION
================================================

Performance Architecture Ready:
YES


Development Required:
YES (batch transport later; not until representation/head is viable)


Recommended Next Phase:
Shared-representation / Han-context audit (HEAD_ONLY_INSUFFICIENT). Do not implement batching or unfreeze trunk this round.
