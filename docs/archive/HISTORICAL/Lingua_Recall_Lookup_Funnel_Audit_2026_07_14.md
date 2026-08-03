<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lingua_Recall_Lookup_Funnel_Audit_2026_07_14.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lingua Recall Lookup Funnel Audit (SSOT V2)

**Date:** 2026-07-14  
**Audit Type:** Read-only · Recall 内部漏斗 · 不改代码 · 不扩词库 · 不重训 KenLM · 不改 Tone / Runtime  
**Upstream SSOT:** [Lingua_ASR_Repair_Success_Funnel_Audit_2026_07_14.md](./Lingua_ASR_Repair_Success_Funnel_Audit_2026_07_14.md)  
**Evidence Run:** `asr_e2e_20260714_crnn_v3` · dialog_200 · 200/200 · Variant C  
**Analysis JSON:** `tmp/asr_e2e_quality_validation/asr_e2e_20260714_crnn_v3/recall_lookup_funnel_analysis.json`  
**Scripts:** `electron_node/electron-node/tests/experiments/analyze-recall-lookup-funnel-v3.py` · `finalize-recall-lookup-ownership.py`  
**Traces:** `electron_node/electron-node/tests/trace-d001.json` · `trace-d048.json`  
**Lexicon:** `node_runtime/lexicon/v3/lexicon.sqlite`

---

## Final Verdict（唯一瓶颈）

# **Ranking**

| 证据 | 数值 |
|------|------|
| Span OK → Recall Hit 主跌落 | **145 → 21**（丢失 124） |
| Primary Ownership among 124 | **Ranking 95 / 124 = 76.6%** |
| 次级 | Lookup 29 / 124 = 23.4% |
| Tone 硬删除 / Domain 硬过滤 / Merge 去重丢词 | **全部 = 0（case 级）** |
| 下一步唯一模块 | **Sentence Assembly** |

Success Funnel 外层「Recall 69.3%」在本轮拆成：**不是词库空白为主，而是 repair-grade 正确 Candidate 未能变成 Stage2 keyword\|sentence Hit——主因在 Ranking / TopK 输出路径（含进句后仍达不到 Stage2）。**

---

## 0. 冻结与定义

### 0.1 冻结

全部冻结：FW · Node · Tone · Span · Feature · Runtime · Lexicon DB · KenLM · Sentence Assembly · Domain Vote Logic。本轮只读。

### 0.2 Success Funnel 对齐

| 量 | 定义 |
|----|------|
| Correct Span | need-repair 且 Stage1 Span OK → **145** |
| Recall Hit | fixture keyword **或** exact sentence 进入存储 KenLM 候选（≤5）→ **21** |
| Recall Miss | **124** |

### 0.3 repair-grade Target

本轮「正确 Candidate」= expected 中、FW raw 未覆盖、且存在于 **domain_lexicon / term / domain-tier ngram** 的词（**排除** base-only 高频词如「这块」「请问」噪声）。

Runtime 查库路径：`pinyin_key`（tone-first）→ base/domain/idiom/ngram merge → `exactTopK=2` + `parentFragmentTopK=3` → `minPrior=0.5`。

---

## 1. Recall Lookup Funnel（真实漏斗）

```text
145  Correct Span
 │
 ├─ SQLite Lookup (存在 ≥1 repair-grade missing term)
 │     116 / 145 = 80.0%
 │     丢失 Lookup ........ 29
 │
 ├─ Pinyin Match
 │     116 / 145 = 80.0%
 │     丢失 Pinyin ........ 0（case 独占；见 §5 词级反例）
 │
 ├─ Tone Match（硬过滤）
 │     116 / 145 = 80.0%
 │     丢失 Tone .......... 0
 │
 ├─ Domain Expansion（硬过滤）
 │     116 / 145 = 80.0%
 │     丢失 Domain ........ 0
 │
 ├─ Candidate Merge（去重丢独立词）
 │     116 / 145 = 80.0%
 │     丢失 Merge ......... 0
 │
 ├─ Term ∈ 存储句候选文本
 │      77 / 145 = 53.1%
 │     （Ranking 子桶：term 从未进 cand = 39）
 │
 └─ Ranking / TopK Output → Stage2 Recall Hit
        21 / 145 = 14.5%
       （Ranking 子桶：term 已在 cand 但仍 Stage2 miss = 56）
```

### 1.1 级间丢失量

| 环节 | 丢失 | 说明 |
|------|-----:|------|
| Lookup | **29** | expected 无可锚定的 repair-grade 缺失词 |
| Pinyin / Tone / Domain / Merge | **0** | case 独占归因无 |
| Ranking（term 未进存储 cand） | **39** | 词库有词 + SQL 有活动，但句候选文本无该词 |
| Ranking（term 已在 cand，Stage2 仍失败） | **56** | 未形成 exact sentence；且多数 case 无 fixture keyword |
| → Recall Hit | **21** | Success Funnel Stage2 |

---

## 2. SQLite Lookup

### 2.1 表规模

| Table | Rows |
|-------|-----:|
| base_lexicon | 50000 |
| domain_lexicon | 10100 |
| idiom_lexicon | 22192 |
| term_pinyin_ngrams | 220242 |
| term | 10000 |

### 2.2 Case 级覆盖（Span OK = 145）

| 状态 | Count | Rate |
|------|------:|-----:|
| Lookup Success（≥1 repair-grade missing term） | 116 | 80.0% |
| Lookup Empty（无 repair-grade 锚定） | 29 | 20.0% |
| Lookup Timeout / Exception | **0** | — |

### 2.3 Cafe 对照词（全部命中 domain/term）

| Term | Found | domain 行 | pinyin_key |
|------|:-----:|----------:|------------|
| 中杯 | Y | ≥1 | `zhong\|bei` |
| 少糖 | Y | ≥1 | `shao\|tang` |
| 蓝莓 | Y | ≥1 | `lan\|mei` |
| 马芬 | Y | ≥1 | `ma\|fen` |
| 拿铁 | Y | ≥1 | `na\|tie` |
| 美式 | Y | ≥1 | `mei\|shi` |
| 燕麦 | Y | ≥1 | `yan\|mai` |
| 热拿铁 | Y | ≥1 | `re\|na\|tie` |
| 蓝莓马芬 | Y | ≥1 | `lan\|mei\|ma\|fen` |

**空查原因（当 Lookup Empty）：** expected 相对 raw 的可修差异 **没有**落在 domain/term 词形上（不是「DB 打不开」）。常见于无 fixture keyword 的口语短差异，或差异碎片无法对齐 repair-grade 词条。

**不是：** 咖啡馆核心词缺失（上述 9/9 均在库）。

---

## 3. Pinyin Match（Trace 实侧 · 不可合并）

窗口 SQL 命中 survivor（过 `min_prior`）按来源桶：

| 桶 | d001 | d048 |
|----|-----:|-----:|
| Exact | **49** | **42** |
| Fuzzy | 0 | 0 |
| Alias | 0 | 0 |
| SingleChar | 0 | 0 |
| Phrase (parent_fragment) | 0* | 0* |

\*本轮两份 trace 的 survivor 标注桶上 Phrase=0；V3 架构仍可返回 `parent_fragment`，本样本未落入该桶。

d001 tone-lookup stage：`plain_fallback=17` · `plain_only_no_pattern=2` · `tone_exact`（hit 级）未占 survivor 主导。

**词级反例（d001）：** `少糖` · `美式` · `燕麦` · `热拿铁` 在库，但 preFilter **0** → 窗口拼音键未打到对应 `pinyin_key`（Pinyin Miss @ term），不抬升为 case Primary（同句另有 Top1 词）。

---

## 4. Tone Match（只统计 Lookup 变化，不算 Accuracy）

### 4.1 架构事实

Tone **不硬删** Candidate；仅 `tonePenalty` 重排。`filterStage=tone_penalized` = **保留**。

### 4.2 d001 Before → After

| 量 | 值 |
|----|---:|
| Before（SQL preFilter hits） | 53 |
| Removed（min_prior） | 4 |
| Removed（Tone） | **0** |
| Added | **0** |
| ReRank（tone_penalized） | **44** |
| After survivors | 49 |

### 4.3 Cohort B→C 句候选集合（Span OK）

| | Count |
|--|------:|
| 集合发生变化的 case | 128 |
| keyword 因 Tone 新进入 | 4 |
| keyword 因 Tone 丢失 | 4 |

**结论：** Tone 不是 145→21 的主砍刀。

---

## 5. Domain Expansion

| 量 | 结果 |
|----|------|
| Before → After 硬删 case | **0**（无独占 Domain ownership） |
| Cross-domain merge | 正常多 domain 行并存（如 `中杯` coffee/bakery/…） |
| Unknown Domain 导致空召回（case Primary） | **0** |

Domain Vote 在 summary diagnostics 下无法证明过度过滤；本轮 **不**列为 Primary。

---

## 6. Candidate Merge

| Trace | survivor unique | post unique | 去重丢掉的独立词 |
|-------|----------------:|------------:|-----------------:|
| d001 | 31 | 31 | **0** |
| d048 | 24 | 24 | **0** |

Merge = domain>alias>base 合并同源词，**不是**正确 Candidate 主丢失点。

---

## 7. Candidate Ranking（Term → Stage2）

### 7.1 Ownership（124 miss · 互斥）

| Owner | Count | % |
|-------|------:|--:|
| **Ranking** | **95** | **76.6** |
| Lookup | 29 | 23.4 |
| Pinyin / Tone / Domain / Merge | 0 | 0 |

### 7.2 Ranking 内拆

| 子桶 | Count | 含义 |
|------|------:|------|
| Term 从未出现在存储句候选文本 | **39** | 真正没把正确词送进 cand |
| Term 已在 cand，但 Stage2 keyword\|sentence 仍失败 | **56** | 多为无 fixture keyword + exact sentence 未成形 |

### 7.3 Trace：期望 cafe 词窗口秩

| Term | bestRank (d001) | @Top2 | @Top5/@10/@20/@50 |
|------|----------------:|------:|-------------------|
| 中杯 | **1** | Y | 相同集合 |
| 蓝莓 | **1** | Y | 相同 |
| 马芬 | **1** | Y | 相同 |
| 拿铁 | **1** | Y | 相同 |
| 蓝莓马芬 | **1** | Y | 相同 |
| 少糖 / 美式 / 燕麦 / 热拿铁 | — | 未进 preFilter | — |

**要点：** 多枚正确词已在窗口 **Top1**，扩大 TopK 不会增加它们；Stage2 仍失败 → 瓶颈在 **窗后组装 / 句 TopK 定义路径**，不是「词埋在第 20 名」。

---

## 8. TopK Sensitivity（只模拟，不改代码）

常量：`exactTopK=2` · `parentFragmentTopK=3` · 窗 cap=5。

| K | d001 仍覆盖的 cafe 词集合 |
|--:|---------------------------|
| 5 | 中杯, 拿铁, 蓝莓, 蓝莓马芬, 马芬 |
| 10 | 同上 |
| 20 | 同上 |
| 50 | 同上 |

**裁决：当前 window TopK 不是限制 Recall Hit 的主因。**  
（对已在 bestRank=1 的词，5→50 **零增量**。）

存储句候选深度本 run ≤5；Success Funnel @10/@20 与 @5 相同（上界截断），问题仍是「多数从未以 keyword/exact sentence 形式进入」，而非埋深。

---

## 9. SQL Coverage

```text
Span OK 145
 ↓
Lookup 锚定成功 116
 ↓
Found（repair-grade）116
 ↓
No Entry 29
```

| No Entry 真因 | 说明 |
|---------------|------|
| 词库缺失（相对 raw 的可修差异无 domain/term 词） | **29 case** — 次级瓶颈 |
| 拼音不同（词在库但窗键未命中） | 词级存在（d001 少糖等），非 case Primary |
| Tone 不同导致空 | **否**（plain fallback 补；硬删 0） |
| Domain 不同导致空 | **否**（非 Primary） |

---

## 10. Recall Ownership（Primary · 禁止 Multiple）

| Owner | Count | Primary? |
|-------|------:|:--------:|
| SQLite Miss (Lookup) | 29 | |
| Pinyin Miss | 0 | |
| Tone Filter | 0 | |
| Domain Filter | 0 | |
| Merge | 0 | |
| **Ranking** | **95** | **是** |

---

## 11. Primary Bottleneck（唯一）

# Ranking

支持数据：

1. 124 miss 中 **76.6%** 独占归 Ranking。  
2. 漏斗最大跌落在 `after_merge 116 → after_ranking_topk 21`（经 term∈cand 77 的中间态）。  
3. Trace 显示正确词可在窗内 Top1，**扩 TopK 无增益** → 不是「TopK 数值过小」单一问题，而是 **候选进入 Stage2 keyword\|sentence 输出失败**。  
4. Lookup 仅 23.4%，不足以改写 Primary。

---

## 12. 下一步（唯一模块）

# **Sentence Assembly**

理由：

- Ranking 子桶 56 = repair-grade 词已在句候选文本中，但仍达不到 Success Funnel Stage2（exact sentence / fixture keyword）。  
- 子桶 39 = 词未进入句候选 — 组装选词/路径枚举仍属装配链，而非先扩词库。  
- **禁止**作为本轮结论：重训 KenLM · 扩大 Tone · 改 Runtime。  
- Lexicon 仅覆盖 29 Lookup miss，排第二。

---

## 13. Final Verdict（八问）

1. **Recall 真正掉在哪一级？** → **Ranking / TopK Output**（145→116 之后的主跌落到 21）。  
2. **正确 Candidate 为何没进 TopK？** → 分两支：**(A) 39** 未写入存储句候选文本；**(B) 56** 已在文本中但未成为 Stage2 的 keyword/exact sentence。窗内多名 cafe 词已是 Top1，说明不是「分太低被 exactTopK=2 切掉」单因。  
3. **是否词库覆盖不足？** → **部分是（29/124）但不是 Primary。** Cafe 核心词 9/9 在库。  
4. **是否 TopK 过小？** → **否（对主证据集）。** 5→50 模拟零增量；Stage2 存储深度≤5 是度量上界，不是窗外扩 K 能修的主因。  
5. **是否 Tone 过滤过强？** → **否。** 硬删 0；仅 ReRank。  
6. **是否 Domain 过滤过强？** → **否。** 无 case Primary。  
7. **是否 Merge 导致 Candidate 丢失？** → **否。** unique 词前后 31→31 / 24→24。  
8. **下一步唯一应开发哪个模块？** → **Sentence Assembly。**

---

## 14. 与 Success Funnel SSOT 的关系

| 层 | 结论 |
|----|------|
| Success Funnel | Primary = **Recall 69.3%**（外层） |
| 本轮 Lookup Funnel | Recall 内 Primary = **Ranking 76.6%** |
| 下一步 | Success Funnel 曾写「Recall/Lookup」→ 本轮收缩为 **Sentence Assembly**（在 Ranking 主导下），**不是**先重训 KenLM / 扩 Tone / 改 Runtime |

自本报告起，讨论「Recall 69.3%」必须继续拆到 **Lookup / Ranking** 两级，不得再用一句「Recall Failure」代替。
