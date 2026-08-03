<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lingua_ASR_Repair_Success_Funnel_Audit_2026_07_14.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lingua ASR Repair Success Funnel Audit（Consumer Report · Historical）

**Date:** 2026-07-14  
**Status:** **DEPRECATED as Architecture SSOT** · Consumer Report only  
**Superseded Metrics SSOT:** Runtime Diagnostics → [Metrics Constraint Addendum](./Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md) · [analyze-metrics-ssot.mjs](../../electron_node/electron-node/tests/experiments/analyze-metrics-ssot.mjs)  
**Audit Type:** Read-only Success Funnel（历史口径）· 不改业务  
**Evidence:** `tmp/asr_e2e_quality_validation/asr_e2e_20260714_crnn_v3/asr_e2e_quality_validation.json`  
**Analysis JSON:** `tmp/asr_e2e_quality_validation/asr_e2e_20260714_crnn_v3/success_funnel_analysis.json`  
**Source Run:** `asr_e2e_20260714_crnn_v3` · dialog_200 · **200/200** · Variant C = Full Repair + CRNN V3

> **2026-07-14 Metrics Alignment：** 本文档保留为历史 Consumer Report。  
> **不得**再作为 Architecture / Ownership SSOT。阶段混用 Dump Exact / Stage2=Stage5 等问题见 Diagnostics Metrics Audit。

---

## Final Verdict（唯一瓶颈）— 历史结论，需经 Metrics SSOT 复核

# **Recall**（历史 Ownership 口径）

| 证据 | 数值 |
|------|------|
| Primary Ownership among Final Failures | **122 / 176 = 69.3%** |
| Need-repair 池 Span OK 后进入 Recall（词或句） | **21 / 145 = 14.5%** |
| Need-repair 池进入 Exact Sentence Candidate | **7 / 145 = 4.8%** |
| KenLM Fail（Sentence 已存在） | **仅 6 / 19 = 31.6% of sentence-present** · 占全部失败 **3.4%** |

**历史下一步：** Recall — 以 Metrics SSOT rematerialize（trace）后为准。

---

## 文档地位（已纠正）

**Runtime Diagnostics** 为唯一 Architecture SSOT。  
本 Funnel = Consumer Report，禁止反向定义 Runtime。

---

## 方法边界（必须读）

本轮基于冻结 E2E JSON 的**可观测字段**重建漏斗。以下限制影响精度，但不改变主瓶颈排序：

| 限制 | 影响 |
|------|------|
| 每例仅存 **≤5** 句级 candidates | Sentence/Recall@10/@20 **低估** |
| Diagnostics 为 **summary** | Domain Vote before/after **不可测** |
| Span 无 window 文本 dump | Correct Span = **专业词区域代理** |
| Tone 贡献 | 只计 **B→C TopK 集合差分**，不计 Tone Hit 计数 |
| A/B/C 独立 pipeline | FW raw 可跨 variant 漂移 |

---

## Stage Definitions（冻结口径）

| Stage | Success 定义 |
|-------|----------------|
| **0 FW Raw** | Variant A：`norm(fwRawText) == norm(expectedText)` |
| **1 Span** | 专业词：出现在 raw **或** 任一句候选中 → Correct Span；全无 → Wrong/Partial/Missing Span |
| **2 Pinyin Recall** | 专业词进入存储 TopK 句候选，**或** 整句 expected 进入 TopK |
| **3 Tone Influence** | B vs C 的 TopK **文本集合变化**（新增/删除）；另计「引入 expected/kw」 |
| **4 Domain Vote** | summary 级不可测 before/after；仅记录 triggered + 投后是否仍有候选 |
| **5 Sentence Candidate** | `norm(expected)` 出现在存储 TopK（≤5） |
| **6 KenLM** | **仅当 Stage 5 成功**：Final 是否正确；否则不得归因 KenLM |
| **7 Final** | Variant C：`exactMatch` |

---

# 1. Success Funnel（真实统计）

## 1.1 Absolute Success Counts（全 corpus · Variant C 路径）

```text
200  corpus
 ↓
 25  Stage 0  FW Raw Correct          (12.5%)
 ↓
170  Stage 1  Correct Span            (85.0%)
 ↓
 43  Stage 2  Recall Hit (kw|sentence) (21.5%)
 ↓
 19  Stage 5  Exact Sentence in Top≤5 ( 9.5%)
 ↓
 13  Stage 6  KenLM → Final OK given sentence (6.5% · /sentence = 68.4%)
 ↓
 24  Stage 7  Final Correct           (12.0%)
```

对照：Without Tone Final Correct = **25**（12.5%）。

> Final(24) 多来自 Stage 0 已正确；**真正靠修复链「救回来」的 need-repair Final 仅 2 / 175（1.1%）**。

## 1.2 Need-Repair Nested Funnel（主决策图 · n=175）

```text
175  Need Repair (FW Raw Wrong)
 │
 ├─ Span Success ................ 145 / 175 = 82.9%
 │
 ├─ Recall Hit (kw|sentence) ....  21 / 145 = 14.5%   ← 主跌落
 │     └─ of need-repair ........  21 / 175 = 12.0%
 │
 ├─ Exact Sentence Candidate ....   7 / 145 =  4.8%
 │     └─ of need-repair ........   7 / 175 =  4.0%
 │
 └─ Final Correct ...............   2 / 175 =  1.1%
```

### Stage 之间丢失量

| 环节 | 丢失数 | 说明 |
|------|------:|------|
| Span fail | **30** | Partial Span 11 · Wrong Span 19 |
| Span OK → Recall miss | **124** | 最大跌落 |
| Keyword in cand → Sentence miss | **24** | Sentence Assembly |
| Sentence present → KenLM/Final fail | **6** | KenLM（条件正确才可归因） |
| Tone Final 退化（B→C） | **3** | Tone Ownership |

---

# 2. TopK Funnel

存储候选深度 ≤5，故 @10/@20 与 @5 相同（上界被截断）。

| TopK | Exact Expected Sentence 进入存储候选 | Rate / 200 |
|------|-------------------------------------:|-----------:|
| @1 | 17 | 8.5% |
| @3 | 19 | 9.5% |
| @5 | 19 | 9.5% |
| @10 | 19（截断） | 9.5% |
| @20 | 19（截断） | 9.5% |

| 条件 | 值 |
|------|-----|
| Present count | 19 |
| Mean rank when present | **1.11** |

**解读：** 一旦 expected 进入存储 TopK，rank 极浅（≈Top1）；问题不是「埋在深处」，而是 **绝大多数从未进入**。

---

# 3. Professional Term Funnel

fixture 启发式专业词实例 **n=82**：

```text
82  Professional Term Instances
 ↓
34  In FW Raw                     (41.5%)
 ↓
43  Span|Cand Covered             (52.4%)
 ↓
32  In Candidate TopK (Without Tone B)  (39.0%)
34  In Candidate TopK (With Tone C)     (41.5%)
 ↓
29  In Final Without Tone         (35.4%)
29  In Final With Tone            (35.4%)
```

| 结论 | 数据 |
|------|------|
| Tone 对专业词入候选 | +2 实例（32→34） |
| Tone 对专业词 Final | **0** |
| Raw→Cand 缺口 | 大量专业词既不在 raw 也不进候选 |

---

# 4. Domain Funnel

```text
Before Vote  ......  UNAVAILABLE（summary diagnostics）
After Vote  .......  200/200 仍有句候选或 triggered 路径
Drop .............  UNAVAILABLE
```

| 可观测 | 值 |
|--------|-----|
| Domain Vote triggered（C） | 多数 case `triggered=true`（与 Span 管线绑定） |
| after_vote candidates present | **200/200** |

**裁决：** 本 run **不能**证明 Domain Vote 过度过滤；也 **不能**洗白。Domain 暂不列为 Primary Bottleneck（ownership 占比无法计入）。

---

# 5. KenLM Funnel（条件归因）

```text
Exact Sentence present in Top≤5 : 19
 ├─ Final Correct                : 13   (68.4%)
 └─ Final Wrong                  :  6   (31.6%)  ← 唯可归因 KenLM
```

| 规则 | 执行 |
|------|------|
| Sentence 不存在 | **禁止**归因 KenLM |
| Sentence 存在且 Final 错 | Primary Owner = KenLM（6 例） |

**平均 rank（present）：1.11** → KenLM 多半已看到接近 Top1 的正确句，但仍有 6 例未落地；体量远小于 Recall。

Without Tone Final Correct = 25 vs With Tone = 24 → 临时 KenLM 不是主矛盾。

---

# 6. Tone Influence（非 Hit 计数）

| 指标 | 值 |
|------|-----|
| B→C TopK 集合发生变化的 case | **176 / 200** |
| 新增候选文本（合计） | **664**（均值 3.32/case） |
| 删除候选文本（合计） | **639**（均值 3.20/case） |
| Tone 引入 expected 或专业词入 TopK | **15** |
| Final 改善（B→C exact） | **2** |
| Final 退化（B→C exact） | **3** |

**结论：** Tone **大量改写了 TopK 集合**，但 **几乎不转化为 Final Success**；Ownership 仅 **1.7%**。

---

# 7. Error Ownership（Primary · Final Failures n=176）

| Primary Owner | Count | % of Failures |
|---------------|------:|-------------:|
| **Recall** | **122** | **69.3%** |
| Span | 30 | 17.0% |
| Sentence Assembly | 14 | 8.0% |
| KenLM | 6 | 3.4% |
| Tone | 3 | 1.7% |
| FW | 1 | 0.6% |
| Domain Vote | 0* | — |

\* Domain Vote 因诊断缺失，本 SSOT **不分配** Primary Owner。

**禁止 Multiple：** 每失败 case 仅一个 Primary（归因规则：先 Span → Recall → Sentence → KenLM；B 对 C 错 → Tone）。

---

# 8. Primary Bottleneck Ranking（失败占比）

```text
Recall                 69.3%
  ↓
Span                   17.0%
  ↓
Sentence Assembly       8.0%
  ↓
KenLM                   3.4%
  ↓
Tone                    1.7%
  ↓
FW                      0.6%
```

---

# 9. 七问必答

| # | 问题 | 回答 |
|---|------|------|
| 1 | 真正掉最多的是哪一级？ | **Recall**：Span OK→Recall 丢失 **124**（need-repair）；Ownership **69.3%** |
| 2 | Recall 真正掉多少？ | Need-repair 中：Span 成功后仅 **14.5%** 进入 kw/sentence Recall；Exact Sentence **4.8%** |
| 3 | Tone 真正贡献多少？ | 改写 176 case TopK；引入 expected/kw **15**；Final **+2 / −3**；Ownership **1.7%** |
| 4 | Domain Vote 是否过度过滤？ | **本轮无法证实**（before/after 未采集） |
| 5 | Sentence Assembly 是否成瓶颈？ | **次要**：kw 在候选但整句缺失 **24**；Ownership **8.0%** |
| 6 | KenLM 真正影响多少？ | Sentence 存在时选对 **68.4%**；失败 **6** 例（**3.4%** 总失败） |
| 7 | 下一步开发哪一个模块？ | **只选 Recall** |

---

# 10. 与前序 E2E 结论对齐

| 前序结论 | Success Funnel 验证 |
|----------|---------------------|
| E2E Verdict C — Recall Coverage 主瓶颈 | ✅ Ownership 69.3% |
| KenLM = Temporary · 非主瓶颈 | ✅ 条件失败仅 3.4% |
| Tone 离线 83.56% 未转成 E2E | ✅ Final ± 净负 / Ownership 1.7% |
| 完整修复 need-repair 成功率极低 | ✅ **2 / 175 = 1.1%** |

---

# 11. Success Funnel 作为后续 SSOT 模板

任何后续实验报告必须填写：

```text
corpus_n
stage0_fw_correct
stage1_correct_span
stage2_recall_hit
stage5_sentence_candidate
stage6_kenlm_given_sentence
stage7_final_correct
primary_ownership_table
Δ_vs_this_baseline (asr_e2e_20260714_crnn_v3)
```

缺失 Domain before/after 的 run，**不得**宣称 Domain Vote Verdict。

---

## Appendix：Stage 1 Span Fail Breakdown

| Reason | Count |
|--------|------:|
| Wrong Span | 19 |
| Partial Span | 11 |
| Missing Span | 0（本代理口径下被归入 Wrong/Partial） |

---

**Signed SSOT:** Success Funnel frozen · Primary Bottleneck = **Recall** · Next module = **Recall only**.
