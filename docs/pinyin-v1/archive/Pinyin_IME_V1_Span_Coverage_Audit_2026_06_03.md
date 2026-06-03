# Pinyin IME V1 Span Coverage Audit

**Date:** 2026-06-03  
**Type:** Read-only audit（未修改代码、主链、Lexicon、Detector、KenLM）  
**Data sources:**
- `tests/spike/pinyin-ime-v1-dialog200-results.json`（IME TopK，117 cases）
- `tests/fw-detector-dialog-200-batch-result.json`（Detector / FW 批测）
- `test wav/dialog_200/cases.manifest.json`（reference）

**Method:** 对 raw / reference / IME candidate 做 NFKC 归一化字符 diff，映射回 raw 字符区间；与 spike 现有 `diffReplacementSpans` 逻辑一致，但增加标点剥离与 raw 索引回映射，避免繁简/标点导致对齐失败。

---

## 1. Executive Summary

本轮从 **refInTopK** 转向 **Span Coverage**，验证假设：

```
rawAsrText → IME Candidate → Diff → Span → (Lexicon Recall → KenLM)
```

在 **Detector Miss 且有 IME 候选** 的 46 条样本上：

| 核心指标（Top5 Union） | 值 |
|------------------------|-----|
| **Case Span Recall**（FULL+PARTIAL） | **76.9%**（20/26 有效样本） |
| **FULL** | **30.8%**（8/26） |
| **PARTIAL** | **46.2%**（12/26） |
| **MISS** | **23.1%**（6/26） |
| **Per-Span Recall** | **62.8%**（71/113 错误 span） |
| **Span Precision**（字符级） | **43.8%** |
| **Avg Span Length** | **1.87 字** |
| **Avg Span Count / Sentence** | **3.42** |

对比当前批测 **Detector Span Recall = 0%**（48/48 条 fw_span_count=0，Lexicon 不可用）。

**结论：** IME Diff Span **能够覆盖大部分真实错误区域**（Case Recall 77%），但 **精度一般、窗口极短**，适合作为 **Span Proposal 候选层**，不宜单独替代 Detector 或直接进入 Lexicon Recall。

**路线判断：情况 A（有条件成立）** — 可作为 Span Proposal Layer，需与 Detector 信号融合并做 span 去噪。

---

## 2. Detector Miss Dataset

| 子集 | 数量 | 说明 |
|------|------|------|
| IME 评估总数 | 117 | Dialog200 批测截止样本 |
| 标签 `detector_miss` | 78 | CER>15% 且 FW 未触发 |
| 有 raw 文本 | 48 | 非空 ASR |
| **有 IME 候选（本轮主评估集）** | **46** | candidateCount>0 |
| `recall_empty` | 0 | 本批 Lexicon 全 down |
| FW span_count > 0 | **0** | 本批 Detector 未产出任何 span |

**Detector Miss 定义（沿用 spike subsets）：** FW 未触发且 raw vs ref CER > 15%；本批额外特征为 Lexicon SQLite ABI 错误导致 **fw_span_count 恒为 0**。

---

## 3. Span Coverage Methodology

### 3.1 IME Diff Span

对每条样本，取 IME Top1 / Top3 / Top5 / Top10，分别做 `raw ↔ candidate` diff，合并为 **Union Span**（raw 坐标去重合并）。

### 3.2 Reference Error Span

对 `raw ↔ reference` 做同样 diff，得到真实错误区域（raw 侧 substitution span）。

### 3.3 Coverage Class（case 级）

对每条 reference error span 判断：

| 类 | 条件 |
|----|------|
| **FULL** | ∃ IME span 完全包含该 ref error span（raw 区间） |
| **PARTIAL** | 有交集但未完全包含 |
| **MISS** | 无交集 |

Case 级：`FULL` = 全部 ref span FULL；`MISS` = 全部 MISS；否则 `PARTIAL`。

26 条样本成功提取 ref error spans；20 条因归一化后无可对齐差异标记为 `NO_REF_SPANS`（不计入主指标分母）。

---

## 4. Aggregate Metrics（Top5 Union，主报告策略）

### 4.1 Span Coverage 分布（n=26 有效样本）

| 类 | 数量 | 占比 |
|----|------|------|
| **FULL** | 8 | **30.8%** |
| **PARTIAL** | 12 | **46.2%** |
| **MISS** | 6 | **23.1%** |
| **Span Recall（FULL+PARTIAL）** | 20 | **76.9%** |

### 4.2 Per-Span 指标（113 个 ref error spans）

| 指标 | 值 |
|------|-----|
| Per-Span FULL | 54.9%（62/113） |
| Per-Span PARTIAL | 8.0%（9/113） |
| Per-Span MISS | 37.2%（42/113） |
| **Per-Span Recall** | **62.8%** |

### 4.3 Precision / 噪声

| 指标 | 值 |
|------|-----|
| Span Precision（IME 字符中命中真实错误占比） | **43.8%** |
| False Positive Span 数 | **22**（26 样本合计） |
| Avg Span Length | **1.87 字** |
| Avg Span Count / Sentence | **3.42** |

---

## 5. Top1 vs TopK Union 对比

Case Span Recall 在 Top1~Top10 **均为 76.9%**（同一批 20 条可被覆盖的 case），但 **FULL 占比**随 K 增加而上升：

| 策略 | Case FULL | Case PARTIAL | Case MISS | Per-Span Recall | Avg Span Count | FP Spans | Avg Precision |
|------|-----------|--------------|-----------|-----------------|----------------|----------|---------------|
| Top1 | 19.2% | 57.7% | 23.1% | 59.3% | 3.46 | 23 | 45.7% |
| Top3 | 19.2% | 57.7% | 23.1% | 60.2% | 3.38 | 24 | 43.7% |
| **Top5** | **30.8%** | **46.2%** | 23.1% | **62.8%** | 3.42 | **22** | **43.8%** |
| Top10 | 34.6% | 42.3% | 23.1% | 62.8% | 3.58 | 26 | 42.4% |

**建议：** **Top5 Union** 在 FULL 率与 FP 之间平衡最好；Top10 仅略增 FULL（+3.8pp）但 FP +4。

---

## 6. vs Detector 对比

| 指标 | Detector（本批） | IME Diff Span（Top5） | Δ |
|------|------------------|------------------------|---|
| Span Recall（case） | **0%** | **76.9%** | **+76.9pp** |
| Avg Span Count | 0 | 3.42 | +3.42 |
| False Positive Spans | 0 | 22 | +22 |
| Avg Window Length | N/A | 1.87 字 | — |

**说明：** 本批 Detector 因 Lexicon Runtime 错误完全未产出 span，对比偏极端；但即使在此条件下，IME Diff **确实提供了 Detector 未能提供的区域提案**。

---

## 7. Sample Analysis（30 条抽样）

### 7.1 FULL — d001（典型正向）

| 字段 | 内容 |
|------|------|
| raw | 你好,我想点一杯热拿铁**钟贝少糖 深便温 以**下今天有**蓝美马分**吗? |
| ref | 你好，我想点一杯热拿铁，**中杯，少糖。顺便问一下**今天有**蓝莓马芬**吗？ |
| IME Top1 | 你好我向点以被热拿铁中杯勺趟身边文艺下今天游览每马芬吗 |
| Ref Error Spans | `[钟贝]` `[深]` `[温 以]` `[美]` `[分]` |
| IME Diff Spans | `[想]` `[一杯]` `[钟贝少糖 深便温 以]` `[有蓝美]` `[分]` |
| Coverage | **FULL**（5/5 ref spans 完全覆盖） |

> 注意：refInTopK=0，但 Span Coverage=FULL — 验证本轮指标切换的必要性。

### 7.2 FULL — d029

| 字段 | 内容 |
|------|------|
| raw | **作業**是下周一下午**覺嗎**?可以**電**子版提**覺嗎**? |
| ref | **作业**是下周一下午**交吗**？可以**电**子版**提交吗**？ |
| IME Diff Spans | `[業是]` `[一]` `[覺嗎]` `[電]` `[版提覺嗎]` |
| Coverage | **FULL** |

### 7.3 PARTIAL — 典型模式

IME 覆盖错误区域的一部分，例如：

- raw `[蓝美马分]` → IME `[有蓝美]` + `[分]`：ref error `[美]`、`[分]` 分别 FULL，但 `[蓝]` 可能被合并 span 部分覆盖
- 长 ASR 错误链：IME 覆盖子串但未覆盖整段（如 d007 地名块）

### 7.4 MISS — 典型模式

- IME 候选与 raw 在错误区域**同错**（diff 为空）→ 无 IME span 提案
- 多字词整体替换路径与 ref 错误区间不对齐（如 d009 望京 SOHO 整段）

---

## 8. Failure Classification（46 条 Detector Miss + IME 候选）

| 类 | 数量 | 说明 |
|----|------|------|
| FULL | 8 | 全部 ref error span 被 IME 覆盖 |
| PARTIAL | 12 | 部分覆盖 |
| MISS | 6 | 完全未覆盖 |
| NO_REF_SPANS | 20 | 无法从 raw↔ref 提取稳定 error span |

---

## 9. Root Cause — TopK 质量低但 Span 有值

| 原因 | 影响 |
|------|------|
| **ASR 拼音流错误** | IME 候选整体偏离 ref，但 diff 仍标出 raw 侧“被改区域” |
| **词库路径错误** | 候选用词错误，diff span 指向 raw 原错字（对 Recall 有利） |
| **unknown/gap 缺失** | 6 条 MISS + 20 条无 ref span 提取 |
| **功能单字** | 已缓解 candidateCount；对 span 粒度影响小 |
| **Diff 粒度过细** | 平均 span 仅 1.87 字，Recall 高但 Lexicon Recall 窗口可能过窄 |
| **KenLM** | 本轮未评估（非 Span 审计范围） |

---

## 10. Route Judgment

### 情况 A（有条件成立）

IME Diff Span **Case Recall 76.9%**，明显高于本批 Detector（0%），说明：

- IME **能够发现高风险区域**（raw 侧替换块）
- 即使 TopK 文本不等于 reference，diff 仍可对齐 many-to-many 错误块

### 限制

- Precision **44%** — 近半数 IME span 字符不在真实错误区
- 窗口 **~2 字** — 对 Lexicon Recall 可能过碎
- 不宜 **直接替换** Detector，应作 **Proposal Layer**

---

## 11. 必须回答的 10 个问题

| # | 问题 | 答案 |
|---|------|------|
| 1 | IME Diff Span Recall 是多少？ | **Case 级 76.9%**；Per-Span 级 **62.8%**（Top5 Union，n=26） |
| 2 | FULL 占比？ | **30.8%**（8/26） |
| 3 | PARTIAL 占比？ | **46.2%**（12/26） |
| 4 | MISS 占比？ | **23.1%**（6/26） |
| 5 | 是否明显优于 Detector Miss？ | **是** — 本批 Detector Span Recall **0%** vs IME **76.9%** |
| 6 | 可否作为 Span Proposal Layer 接入 Detector 链路？ | **可以（有条件）** — 作为 **并行提案源**，与 Detector span 合并、去重、打分；**不替换** Detector |
| 7 | 可否直接作为 Lexicon Recall 输入？ | **不建议直接使用** — 需先 **合并相邻 span、过滤低置信 diff、与 Detector 交集/并集策略**；否则 FP 与碎窗过多 |
| 8 | Top1 还是 TopK Union？ | **Top5 Union** — Case Recall 与 Top1 相同，FULL 率 30.8% vs 19.2%；Top10 边际收益小且 FP 增 |
| 9 | 平均 Span 长度？ | **1.87 字**（Top5）；Avg Count **3.42 个/句** |
| 10 | 下一步优先级？ | **① IME Span Proposal 工程化（合并/去噪/与 Detector 融合） → ② 恢复 Detector+Lexicon 基线 → ③ Lexicon Recall 消费融合 span** |

---

## 12. Next Development Direction

```
优先级组合（推荐）：

1. IME Span Proposal Layer（Top5 union + span merge + confidence gate）
2. Detector 基线恢复（Lexicon SQLite ABI / fw_span 产出）
3. Span Fusion（Detector ∪ IME proposal → dedupe → rank）
4. Lexicon Recall（仅对 fused spans）
5. KenLM sentence rerank（已有 spike 验证链路）
```

**禁止（本轮结论延续）：**

- 不以 refInTopK 作为 Span 层验收指标
- 不扩词库 / 不扩单字 / 不优化 weight
- 不以本审计直接入主链

---

## 13. Artifacts

| 文件 | 说明 |
|------|------|
| `tests/spike/tmp/pinyin-ime-v1-span-coverage-audit.json` | 完整审计 JSON（46 cases + 30 samples + 策略对比） |
| 本报告 | `docs/pinyin-v1/Pinyin_IME_V1_Span_Coverage_Audit_2026_06_03.md` |

---

*Read-only audit — 未修改任何 production / spike 源码。*
