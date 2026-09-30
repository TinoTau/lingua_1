# RETIRED / HISTORICAL / SUPERSEDED BY MODEL2 P/D ROLLBACK DECISION (2026-08-20)

**Status:** RETIRED. Not authoritative Model2 architecture. Model2 is P/D ONLY.
Do not re-enable this capability without a new Architecture Change Proposal and explicit user approval.

---

# Lingua Model2 — Single-Char Minimal Context V2 Development and Training

**Date:** 2026-08-19  
**Stage:** `MODEL2_SINGLE_CHAR_MINIMAL_CONTEXT_REPRESENTATION_V1` + `AMBIGUITY_HEAD_RETRAIN`  
**Verdict:** **CONTEXT_STILL_INSUFFICIENT**  
**Production Ready:** NO  

Artifacts: `training/model2_v3/experiments/v3_single_char_minimal_context_v2/`

本轮只增加隔离的局部文本表示 `MinimalContextEncoderV1`，并训练新的 `AmbiguityHeadV2`。未从失败实验 `retrieval_policy_v3_single_char_ambiguity_v1.pt` 继续调参。未解冻 trunk / P / D。未实现 production batch。未导入 Repair Lexicon。未改 minPrior。未使用 dialog_200 `expectedText`。未针对 failure examples 补训。未覆盖 `expA_frozen_trunk.pt` 与 V1 失败 checkpoint。

---

## 1. Frozen product

| 项 | 状态 |
|---|---|
| Main chain ASR→…→NMT | 未改 |
| Lexicon / Recall 所有权 | 未改 |
| Candidate-Set Interface V1 | KEEP |
| ONE Model2 / ONE sidecar | YES |
| 默认生产 load | 仍 `with_ambiguity_head=False`（47210，strict expA） |
| Utterance batch | NOT_IMPLEMENTED |
| Per-span extra IPC | FORBIDDEN（本轮未引入） |

Parent checkpoint: `expA_frozen_trunk.pt`  
sha256 `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda` MATCH，未覆盖。

V1 失败实验 sha256 `076390abdd19c485a26a7199fa40ae7b328aade3d3f5d46bc63d8369d63770fc` 未覆盖、未作 init。

---

## 2. Architecture

```
RetrievalPolicyV3
├── existing frozen shared trunk → P / D
└── single-char decision
       ├── MinimalContextEncoderV1
       └── AmbiguityHeadV2
```

- Encoder 输出不进入 `encode()` / P / D。
- `forward()` 键集不变，无 `ambiguity_logits`。
- 同一 `RetrievalPolicyV3` 对象、同一 checkpoint 文件、同一 sidecar 进程。无第二模型、无 BERT/Transformer/LLM。
- 输出仍为相对下标 SELECT / ABSTAIN；维度 9；开放 bucket 嵌入，不是 1125 类汉字分类器。
- 代码：`training/model2_v3/policy/minimal_context_encoder_v1.py`、`ambiguity_head_v2.py`；`model.py` 仅在 `with_ambiguity_head=True, ambiguity_version="v2"` 时挂接。

隔离测试：`training/model2_v3/tests/test_ambiguity_head_v2_isolation.py` + skeleton 测试 ALL_OK。

---

## 3. Context encoder

| 项 | 值 |
|---|---|
| Type | char-bucket Embedding + masked mean pool + Linear(48→64) ReLU |
| Window | left 4 + right 4 |
| Vocab | PAD + 2048 hashed buckets（新字进 bucket，不改输出维） |
| Encoder params | 52312 |
| Ambiguity head（不含 encoder） | 12674 |
| Added | 64986 |
| Total with V2 | 112196 |
| Baseline P/D | 47210 |
| Separate service | NO |
| Feeds P/D | NO |
| MACs | ~2e5 ops / request（估计） |

禁止的大型 sequence model 未添加。

---

## 4. Trainable / hash gate

训练前 inventory：`single_char_context_v2_trainable_params.csv`  
仅 `ambiguity_head.*`（含 `ambiguity_head.encoder.*`）`requires_grad=True`。

| Shared trunk | P | D | item_mlp / attn |
|---|---|---|---|
| NO | NO | NO | NO |

训练后 named-parameter SHA 与 frozen expA 一致：

- trunk `7a3c9a80…523b`
- action_head `b0b97d1a…3a9f`
- domain_action_head `de3429ec…7a7c`

P/D packed dummy + sample rows logits `allclose`。记录 P RR 0.954 / D val 0.304 未重算全量 699（哈希+logits 门）。

---

## 5. Data

来源（仓库内）：新闻 raw、wiki raw、CLD audit CSV **仅 metadata**（`utf-8-sig`）。dialog_200：**未用**。

| 项 | 值 |
|---|---|
| Context | 从句子中切真实左右窗口（最多 8 字，编码取 4） |
| Contrast group emits | 7593（同 candidate set、不同 context → 不同 gold） |
| Contrast SELECT rows | 15186 |
| Dedup | 34832 → 30977 |
| Unique contexts / families | 16013 / 16462 |
| Train / dev / test | 13752 / 1719 / 1719 |
| Train unique chars | 2836 |
| Polyphonic | **POLYPHONIC_DATA_GAP**（0；不硬编码银行/行） |

未把相对 index 当输入；训练时 permute candidates。

---

## 6. Training

- Script: `training/model2_v3/scripts/run_v3_single_char_minimal_context_v2_train.py`
- Loss: CE over ABSTAIN+C0..C7；非法 slot `-1e9`
- Adam 1e-3，batch 96，seed 20260819，early stop epoch 7（best DEV score epoch 4）
- 未用 V1 weights
- Operating point **仅 DEV**：precision-first 选出 tau=2.4（coverage 被压到很低）

DEV tau=0（未作 test tuning）accepted_decision_accuracy **0.377**，select_precision **0.308**，wrong_select_rate **0.619**。

新 checkpoint（实验，非默认生产）：  
`retrieval_policy_v3_single_char_ambiguity_v2.pt`  
sha256 `d844ab483de18e09090207ef721d9784ef23b450c3a8c8f7cdeb4fb4b17dd497`

---

## 7. Why CONTEXT_STILL_INSUFFICIENT

与 V1 同一硬门：**必须显著优于 candidate-identity baseline**。

| 系统 | accepted_decision_accuracy | select_precision | wrong_select_rate |
|---|---|---|---|
| Random | 0.2356 | 0.2605 | 0.573 |
| Majority | 0.2688 | 0.2688 | 0.7312 |
| Identity | **0.4084** | 0.2927 | 0.5876 |
| No-context (PAD, candidates kept) | 0.1652 | n/a (always ABSTAIN) | 0 |
| Ambiguity V1 published | 0.4133 | 0.3218 | 0.5666 |
| Ambiguity V2 (DEV tau=2.4, test) | **0.2077** | 0.3238 | 0.1105 |
| Ambiguity V2 DEV tau=0 | 0.377 | 0.308 | 0.619 |

V2 未超过 identity。tau=2.4 把多数 SELECT 变成 ABSTAIN，coverage 0.1635；`wrong_select_given_select` 仍 0.6762。tau=0 则 wrong-select 仍约 0.62。

**Context contribution FAIL（非虚假提升）：**  
no-context 在 PAD 窗口上 always-ABSTAIN，因为训练把空窗口标成 insufficient-context ABSTAIN，模型把 PAD 当 abstain 信号。候选特征仍在。这**不能**计作 “full > no-context” 的有效证明。DEV tau=0 带上下文仍低于 identity（0.377 vs 0.4084）。

Learnable local embedding 没有把局部搭配变成可泛化的 SELECT。停止。不添加 Transformer / BERT / LLM，不解冻 trunk，不增加第二模型。

---

## 8. Generalization（均未过硬门，且禁止对 held-out 补训）

| Split | n | select_precision | Gate |
|---|---|---|---|
| Held-out character | 8000 | 0.1882 | FAIL |
| Held-out candidate set | 2746 | 0.2606 | FAIL |
| Held-out context | 3345 | 0.1055 | FAIL |
| Unseen char + known context | 2815 | 0.2541 | FAIL |
| Known char + unseen context | 3198 | 0.1039 | FAIL |
| Permutation consistency | 1435 | 1.0，out-of-set 0 | PASS |

Permutation PASS 只说明相对下标合同成立，不挽救决策质量。

---

## 9. ABSTAIN / precision-first

Test（tau=2.4）：abstain_precision 0.185，abstain_recall 0.9366，false_select_on_abstain 18。高 recall 来自过度 ABSTAIN，不是可用的 abstain 质量。Gate FAIL。

Failure buckets（未用于补训）：ABSTAIN_FALSE_NEGATIVE 1172，WRONG_CONTEXT_INTERPRETATION 172，WRONG_SELECT 18。

---

## 10. Performance

Warm in-process `judgeSingleChar`（n=200）：P50 **1.031 ms**，P95 **1.619 ms**，P99 **1.8 ms**。轻量，latency 本身不是失败原因。

Batch 维：encoder/head 支持 `[B,…]`。生产 `requests[]`：**未实现**。

---

## 11. Governance

| Check | Result |
|---|---|
| architecture / one model / one sidecar | PASS |
| main chain / lexicon / recall | UNCHANGED |
| open-vocab hanzi classifier | NO（bucket 嵌入 + 相对 SELECT） |
| dialog_200 leakage | NO |
| batch implemented | NO |
| minPrior | UNCHANGED HOLD |
| second pipeline | NO |

---

## 12. Decision

Minimal isolated context 已实现并训练。表示**不足以**支撑 candidate-set 上的可靠 SELECT。按 ACP §67：停止并重新评估 Model2 是否应承担该辅助任务。下一步不是 batch transport（那只是 transport），也不是生产开启。

**Recommended next phase（审查，非本轮执行）：** 产品层重新评估 “Model2 是否值得承担单字辅助决策”。在该评估完成前：不 unfreeze、不加外部 LM、不启用生产、不实现 utterance batch。
