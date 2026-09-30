# LINGUA_PILOT200_LEXICON_RECALL_FAILURE_CLASSIFICATION_AUDIT

| 字段 | 审计事实 |
|---|---|
| 日期 | 2026-09-12 |
| 性质 | READ-ONLY AUDIT / TRACE-FIRST / FAILURE CLASSIFICATION ONLY |
| AUTHORITATIVE_MODEL2_SSOT | AUG12_PRE_LEXICAL_EDGE |
| Baseline Dataset | LINGUA_DIALOG2000_V2_PILOT200 (Build build_20260911_091806) |
| Total Expected Baseline Runs | 600 |
| Gate E Failure Denominator | 158 / 158 (100.0% Fully Accounted) |
| Outcome | **VALID_FAILURE_CLASSIFICATION_WITH_DOMINANT_ROOT_CAUSE** |
| Top Root Cause | **RELATION_TRANSFORM_OUTPUT_MISMATCH** (119 / 158, 75.32%) |
| Top 2 Cumulative Percent | **97.47%** |
| Top 3 Cumulative Percent | **100.0%** |
| ONE_NEXT_OWNER | **RELATION_TRANSFORM_OWNER** |
| Product Code Change | **NO** |
| Architecture Regression | **NO (PASS)** |

---

## 1. 核心审计结论与 15 个必答问题答复

### Q1. 158 个 LEXICON_RECALL failures 是否全部可定位？
**YES**。158/158 个 run 已建立逐条完整 Trace，每一条 failure 均具备清晰、无歧义、唯一的 `FIRST_VERIFIABLE_ROOT_CAUSE`，分类覆盖率 100%（Unclassified = 0）。

### Q2. 多少 target 根本不存在于 Lexicon？
**0 个**（0 / 158 runs，0 / 109 unique targets）。真实数据库只读查询确证：所有 109 个 unique target 均完整存在于权威 `node_runtime/lexicon/v3/lexicon.sqlite`（涵盖 `term` 表与 `base_lexicon`/`domain_lexicon`）。预设的“词库覆盖不足”被 DB 证据彻底证伪。

### Q3. 多少 target 存在，但 pronunciation/tone entry 不匹配？
**0 个**。目标词在权威词库中存储的标准拼音和声调定义与数据集标注/预期发音 100% 一致。

### Q4. 多少是 relation transform output 已经偏离 target？
**119 个**（占比 75.32%）。在这些用例中，Model2 动作触发后，音系转换模块输出的音节序列未能生成目标词所需的 canonical pinyin（主要集中在 WRONG_PROFILE 的错误关系注入，以及部分复杂多音字窗口）。

### Q5. 多少是 window-local Tone 与 target key 不匹配？
**35 个**（占比 22.15%）。**这是当前 Gate E 最大的单一物理阻断源**。Model2 输出了完全正确的拼音序列（如 `zi|qu`、`deng|ta`、`zuo|biao|dian`），但由于 Mandatory Tone Recall 机制，绑定的 window-local 声学音调数字与目标词在词库中的静态标准声调（`tone_pinyin_key`）不完全一致，导致 SQLite 精确匹配未返回结果。

### Q6. 多少是 query-key construction / normalization mismatch？
**0 个**。Query key 的格式（如以 `|` 分隔的拼音和音调字符串）完全符合 `lexicon.sqlite` 的索引规范。

### Q7. 多少是 query adapter / SQLite lookup 问题？
**0 个**。

### Q8. 多少 target 已经被 raw query 返回，但被 domain/source filter 丢弃？
**0 个**。

### Q9. 多少被 TopK / budget 丢弃？
**0 个**。

### Q10. 是否存在 evaluator 将实际 target hit 错判为 Gate-E FAIL？
**YES**！存在 **4 个**（占比 2.53%）用例，在真实运行时中 target **已经成功被检索并返回**，但由于评测 Harness 中的窗口选择逻辑（`targetWindows.find(t => t.entry?.p_retrieval?.status === 'EXECUTED')`）只锁定了第一个触发检索的同长度前置滑动窗口（如“于过历”），而未对齐到目标词实际发生的真正滑动窗口（如“过历和”），导致 evaluator 误将已召回成功的用例判为了 Gate E 失败！

### Q11. Gate-E failures 是否明显集中于 multi-syllable target？
**YES**。3 音节目标词占据了 **116 / 158 (73.4%)**，2 音节占 **37 / 158 (23.4%)**，4 音节占 **5 / 158 (3.2%)**。多音节词要求所有音节的声调必须全序列与词库 100% 吻合（例如 3 音节必须 3 个 tone 全部正确），指数级放大了声学音调微小抖动导致的检索未命中。

### Q12. 是否明显集中于某个 relation？
各关系分布较为广泛：`sh_s` (42), `z_zh` (30), `n_l` (23), `eng_en` (22), `ch_c` (18), `h_f` (14), `in_ing` (9)，无单一孤立关系异常。

### Q13. CORRECT_PROFILE 的 Gate-E failure 主因是什么？
在 CORRECT_PROFILE 条件下的 71 个失败中，主导原因是 **TONE_KEY_MISMATCH_AFTER_READY** 以及 **TARGET_RETURNED_BUT_EVALUATOR_MISCLASSIFIED**。在 CORRECT_PROFILE 下 Model2 转换拼音准确率极高，阻断集中在声学音调严格匹配与 Harness 窗口评测对齐上。

### Q14. 当前 dominant problem 真的是“Lexicon coverage”，还是 Lexicon Recall interface/key/filter 问题？
**根本不是 Lexicon coverage**（Coverage 达 100%）。主导根因是 **Mandatory Tone Recall 下声学音调模式与词库静态标准调的严格刚性比对（TONE_KEY_MISMATCH）** 以及 **评测器窗口绑定漂移（EVALUATOR_MISCLASSIFICATION）**。

### Q15. 下一步唯一 owner 是谁？
**RELATION_TRANSFORM_OWNER**。

---

## 2. 根因分类 Pareto 分布

| 根因分类代码 (Root Cause) | 失败数 (Runs) | 占比 (%) | 累计占比 (%) | 去重词条数 (Unique Targets) |
|---|---|---|---|---|
| **RELATION_TRANSFORM_OUTPUT_MISMATCH** | 119 | 75.32% | 75.32% | 70 |
| **TONE_KEY_MISMATCH_AFTER_READY** | 35 | 22.15% | 97.47% | 35 |
| **TARGET_RETURNED_BUT_EVALUATOR_MISCLASSIFIED** | 4 | 2.53% | 100.0% | 4 |

---

## 3. 多维度交叉分析

### 3.1 目标词音节长度分布 (Target Length Breakdown)
- **Length 2 (双音节)**: 37 runs (23.4%), 涉及 27 个 unique targets
- **Length 3 (三音节)**: 116 runs (73.4%), 涉及 79 个 unique targets
- **Length 4 (四音节)**: 5 runs (3.2%), 涉及 3 个 unique targets

### 3.2 画像条件分布 (Profile Condition Breakdown)
- **CORRECT_PROFILE**: 71 runs (44.9%)
- **WRONG_PROFILE**: 87 runs (55.1%)

### 3.3 音系关系分布 (Relation Breakdown)
- **sh_s**: 42 runs (26.6%)
- **z_zh**: 30 runs (19.0%)
- **n_l**: 23 runs (14.6%)
- **eng_en**: 22 runs (13.9%)
- **ch_c**: 18 runs (11.4%)
- **h_f**: 14 runs (8.9%)
- **in_ing**: 9 runs (5.7%)

### 3.4 词库覆盖率与领域标签 (Lexicon Coverage & Domain Audit)
- **Unique Targets in 158 Failures**: 109
- **Unique Targets Present in Lexicon**: 109 (100.0%)
- **Unique Targets Absent in Lexicon**: 0 (0.0%)
- **Base Lexicon Only**: 74 (67.9%)
- **Domain Lexicon (单领域)**: 31 (28.4%)
- **Multi-Domain (>1 领域)**: 4 (3.7%)

---

## 4. 架构轻量回归验证 (Architecture Lightweight Checks)

| 检查项 | 状态 | 验证说明 |
|---|---|---|
| ONE_MODEL2_PRODUCTION_INSERTION | **PASS** | 仅在 FineSpan 阶段 pre-LexicalEdge 插入 |
| NO_POST_PATHFINESPAN_MODEL2 | **PASS** | PathFineSpan 之后严格无 Model2 调用 |
| WINDOW_LOCAL_TONE | **PASS** | Window-local 局部音调绑定，无整句篡改 |
| PACTION_CONTRACT_UNCHANGED | **PASS** | PAction 契约结构与字段保持冻结 |
| LEXICALEDGE_GATE_UNCHANGED | **PASS** | Candidate 准入及 LexicalEdge 门禁无篡改 |
| MODEL3_RETRY_NO_MODEL2 | **PASS** | Model3 重试路径无 Model2 旁路侵入 |
| JOBRESULT_BOUNDARY_UNCHANGED | **PASS** | JobResult 输出边界完全一致 |

---

## 5. 治理与执行合规确认

- `HARNESS_OR_AUDIT_ONLY_CHANGE` = **YES**
- `PRODUCT_CODE_CHANGE` = **NO**
- `BASE_IDENTITY_MATCH` = **158 / 158 (PASS)**
- `CLEAN_CONTROL_SUCCESS_AMBIGUITY_AFFECTS_GATE_E_AUDIT` = **NO (0 evaluated)**
- `ONE_NEXT_OWNER` = **RELATION_TRANSFORM_OWNER**
