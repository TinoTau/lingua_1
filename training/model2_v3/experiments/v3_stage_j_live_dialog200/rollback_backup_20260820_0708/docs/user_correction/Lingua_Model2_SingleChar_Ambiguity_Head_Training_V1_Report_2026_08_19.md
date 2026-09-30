# Lingua Model2 — Single-Char Ambiguity Head Training V1

**Date:** 2026-08-19  
**Stage:** `MODEL2_SINGLE_CHAR_AMBIGUITY_HEAD_TRAINING_V1`  
**ACP:** `MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_ACP`  
**Stage 1:** PASS（Candidate-Set Interface V1 已冻结）  
**Artifacts:** `training/model2_v3/experiments/v3_single_char_ambiguity_head_v1/`

本轮只训练 `AmbiguityHeadV1`。shared trunk / P head / D head 全程 `requires_grad=False`。未使用 dialog_200 `expectedText`，未针对失败 case 补训，未 unfreeze trunk，未导入正式 Single-Char Repair Lexicon，未改 minPrior / priorScore / FineSpan / Assembly / KenLM / Budget 16 / Domain Vote / JobResult / IME 2510。未覆盖 `expA_frozen_trunk.pt`。

---

## 1. Frozen baseline

| 项 | 值 |
|---|---|
| Checkpoint | `training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt` |
| sha256 | `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda` MATCH |
| Architecture | `RetrievalPolicyV3(with_domain_head=True)` |
| Params（无 ambiguity head） | 47210 |
| P RR vs P1 | 0.954 |
| Held-out P RR | 0.939 |
| D val Top1 | 0.304 |
| Runtime load | `with_ambiguity_head=False` 仍 strict load |

训练后 trunk / P / D 参数哈希与 baseline 完全一致；48 条 P 行 + 48 条 D 行 logits `allclose`；skeleton 三项测试 PASS。冻结文件未被覆盖。

## 2. Trainable inventory（训练前）

| 组件 | trainable |
|---|---|
| ambiguity head | YES（43778 params） |
| shared trunk / item_mlp / attn | NO |
| P：action / query_budget / cand_budget | NO |
| D：domain_action_head | NO |

未满足则 STOP：本轮满足，已开训。

带 head 的新 checkpoint 总参数 90988（47210 + 43778）。

## 3. 数据

来源（均已在仓库内，合法）：

- KenLM 简体新闻 `kenLM/corpus/archive_legacy_news_v0/zh_sentences.raw.txt`
- KenLM Wikipedia `kenLM/corpus/v1/corpus_v1.raw.txt`（扫描子集）
- CLD audit CSV **仅作训练期 candidate metadata**，未写入 sqlite，不是生产 lexicon

dialog_200：**未使用**。

| 项 | 值 |
|---|---|
| raw | 84413 |
| exact dedup | 78250 |
| deduplicated | 77373 |
| unique contexts | 48803 |
| unique families | 29260 |
| unique characters | 3290 |
| unique pinyin+tone groups | 796 |
| unique combinations | 16154 |
| SELECT / ABSTAIN | 60007 / 17366 |
| N=2/3/4/5/6/7/8 | 22075 / 18274 / 21474 / 7049 / 4187 / 2809 / 1505 |
| train/dev/test | 33091 / 4136 / 4137 |

ABSTAIN 类型：insufficient 2270、missing_true 2774、multi_plausible 2281、conflict 2313、weak 3813、ood 3915。

**多音字样本：0。** CLD audit CSV 每个 surface 只保留一条读音（例如「行」仅 `xing2`，「重」仅 `zhong4`），无法在 candidate-set 合同下构造真正的多发音 hypothesis。这是 metadata 缺口，不是 runtime 规则表。禁止用「银行→háng」硬编码补上。

训练中对同一 candidate set 做 permutation，label 随相对下标移动。未把相对 index 当作输入特征，避免 candidate_0 bias。

## 4. 训练

- Loss：mask 后的 CE（ABSTAIN + C0..C7）
- 非法 slot logit = `-1e9`；out-of-set = 0（所有 split）
- Adam 1e-3，batch 96，seed 20260819，early stop epoch 6（best epoch 3）
- DEV 上不存在可用的 precision-first 工作点：`select_precision` 从未在 coverage≥5% 时达到 0.58。曲线峰值约为 tau=1.3、precision 0.46、coverage 0.09。记录 tau=0.2 仅为 fallback，**不是生产阈值**。

## 5. 为什么判 HEAD_ONLY_INSUFFICIENT

冻结 trunk 的 `encode()` 只吃 span-pinyin hash + profile + state，**不编码左右汉字**。本轮允许把 rawText 切片 hash 进 head（`ctx_feat` + collocation hash），这不是第二编码器，也不是 unfreeze trunk。

结果：

1. Full model 标准测试 accepted accuracy **0.413**，candidate-identity-only（训练集字频）**0.613**。模型没有明显优于 identity，反而更差。
2. No-context / identity-neural ablation **coverage=0（永远 ABSTAIN）**。用它当「context contribution」会虚高。去掉 surface 后 SELECT 的 index0 占比 **1.0**：没有 surface hash 时 head 退化为选 slot 0。
3. Wrong-select rate **0.567**（precision-first 不可接受）。SELECT precision **0.322**。
4. Held-out character / combination / context family 全部失败；这与「head 没学到可迁移的上下文判别」一致，而不是「随机划分很好、只是泛化差」。
5. 按规范：head-only 无效则 **STOP**，本轮不得 unfreeze trunk。

Permutation 合同几乎保持（一致性 0.9994，out-of-set 0）。架构合同保持。P/D 无回归。这些不够构成 PASS。

dialog_200：泛化门未过，**未评**，也未用来调阈值。

## 6. 失败簇（不本轮补训）

标准测试错误归桶：WRONG_CONTEXT_INTERPRETATION 1101、CANDIDATE_ORDER_BIAS 632、WRONG_SELECT 362、CANDIDATE_IDENTITY_BIAS 249、ABSTAIN_FALSE_NEGATIVE 83。详见 `single_char_failure_examples.jsonl`。

## 7. 下一阶段（需用户审查后）

审计冻结 shared representation 是否缺少足够的汉字上下文信息。不要本轮开放 trunk。不要导入正式 repair lexicon。不要改 minPrior。不要针对失败 examples 特训。

Production Ready 即使将来 PASS 仍为 NO，直到 lexicon freeze + runtime integration + minPrior + dialog_200 full-path 完成。

新 checkpoint（实验用，非生产）：`retrieval_policy_v3_single_char_ambiguity_v1.pt`  
sha256 `076390abdd19c485a26a7199fa40ae7b328aade3d3f5d46bc63d8369d63770fc`

---

Model2 Single-Char Ambiguity Head Training V1:
HEAD_ONLY_INSUFFICIENT


================================================
ARCHITECTURE
================================================

ONE Model2:
YES


Second Model:
NO


Second Pipeline:
NO


Candidate-Relative:
YES


Open Vocabulary:
NO


Lexicon Ownership Changed:
NO


================================================
TRAINING
================================================

Training Samples:
33091


Unique Characters:
3290


Unique Candidate Combinations:
16154


Unique Context Families:
29260


Polyphonic Samples:
0


ABSTAIN Samples:
17366


Trainable Params:
43778


Shared Trunk Trainable:
NO


P Head Trainable:
NO


D Head Trainable:
NO


Ambiguity Head Trainable:
YES


================================================
STANDARD TEST
================================================

Samples:
4137


Select Precision:
0.3218


Select Recall:
0.3500


Wrong Select Rate:
0.5666


Abstain Precision:
0.8781


Abstain Recall:
0.6229


Coverage:
0.8354


Accepted Decision Accuracy:
0.4133


================================================
BASELINES
================================================

Random:
0.2408


Majority:
0.2606


Candidate Identity Only:
0.6132


No Context:
0.2321 (collapsed to always-ABSTAIN)


Full Model:
0.4133


Context Contribution:
FAIL


================================================
HELD-OUT CHARACTER
================================================

Characters:
329


Samples:
9000 (eval cap; split size 23767)


Select Precision:
0.2733


Wrong Select Rate:
0.5736


Coverage:
0.7892


Accepted Decision Accuracy:
0.3649


Gate:
FAIL


================================================
HELD-OUT CANDIDATE COMBINATION
================================================

Combinations:
(eval n=5993)


Samples:
5993


Metrics:
select_precision=0.3210 wrong_select_rate=0.5481 coverage=0.8073 accepted_decision_accuracy=0.4006


Gate:
FAIL


================================================
HELD-OUT CONTEXT
================================================

Context Families:
held-out families isolated from train


Samples:
4729


Metrics:
select_precision=0.3282 wrong_select_rate=0.5420 coverage=0.8067 accepted_decision_accuracy=0.2827


Gate:
FAIL


================================================
PERMUTATION
================================================

Samples:
1800


Relative Selection Consistency:
0.9994


Out-of-Set Selection:
0


Gate:
PASS


================================================
ABSTAIN
================================================

Abstain Rate:
0.1646


False Select On Abstain Cases:
362


False Abstain On Select Cases:
83


Fail-Closed Quality:
FAIL (coverage high, wrong-select 0.5666; no usable precision-first tau)


================================================
ABLATION
================================================

Full:
0.4133


No Context:
0.2321 (always ABSTAIN)


No Surface Identity:
0.3967 (SELECT index0 share = 1.0)


Candidate Identity Only:
0.6132 / neural=0.2321


Evidence Model Uses Context:
NO


Evidence Of Character Lookup:
YES (surface-off → always candidate_0; identity count beats neural head)


================================================
P/D REGRESSION
================================================

Shared Trunk Hash Changed:
NO


P Head Hash Changed:
NO


D Head Hash Changed:
NO


P Regression:
PASS


D Regression:
PASS


================================================
ARCHITECTURE REGRESSION
================================================

FineSpan Changed:
NO


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


IME 2510 Changed:
NO


Production Repair Lexicon Imported:
NO


minPrior Changed:
NO


================================================
MODEL ARTIFACT
================================================

New Checkpoint:
retrieval_policy_v3_single_char_ambiguity_v1.pt


SHA256:
076390abdd19c485a26a7199fa40ae7b328aade3d3f5d46bc63d8369d63770fc


Frozen Baseline Preserved:
YES


Architecture Version:
RetrievalPolicyV3 + AmbiguityHeadV1


================================================
DECISION
================================================

Head Learned Context Disambiguation:
NO


Held-Out Character Generalization:
FAIL


Fixed-Case Memorization Risk:
MEDIUM


Existing Model2 Regression:
NO


Ready For Runtime Integration:
NO


Production Ready:
NO


Recommended Next Phase:
Audit whether frozen shared encode() lacks usable Han context. Do not unfreeze trunk this round. Do not import production repair lexicon. Do not change minPrior. Do not mine failure examples into training.
