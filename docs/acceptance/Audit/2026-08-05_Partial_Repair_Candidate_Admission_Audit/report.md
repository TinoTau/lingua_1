# FW Repair V4 — Partial Repair Candidate Admission Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | `FW_V4_FREEZE_2026_08_03` |
| Nature | READ ONLY / PRE-DEVELOPMENT |
| Verdict | **PARTIAL_REPAIR_ADMISSION_DEFECT_CONFIRMED** |

已冻结前提（本轮不重审）：`生成` 在库但 Tone miss 未召回属允许失败；`生城/声城` 非正式词，来自 replacement + RAW_PRESERVED 邻接。

---

## 生产调用链（Sole Owners）

```text
runSpanAssemblyV4Orchestrator
  → LexicalEdge / Path / Domain Bucket
  → buildSentenceCandidates          ★ 首次生成完整 candidateText
  → mergeCrossPathSentenceCandidates ★ 正式进入 KenLM 池（exact dedupe + cap≤16）
  → kenlmSentenceCandidates.combinations
  → rerankFwSentences                ★ KenLM 评分/选句（不负责 admission）
```

| 问题 | 函数 | 文件 |
|------|------|------|
| 首次生成 `candidateText` | `buildSentenceCandidates` → `applyReplacementsRightToLeft` | `build-sentence-candidates.ts` |
| 进入正式候选池 | `mergeCrossPathSentenceCandidates` | `merge-cross-path-sentence-candidates.ts` |
| 送入 KenLM | `kenlmSentenceCandidates.combinations` → `rerankFwSentences` | orchestrator + `rerank-fw-sentences.ts` |

枚举行为（关键）：

```text
enumerateIntervalPaths:
  对每个 FineSpan slot，取 repairTarget 的全部非重叠子集
  （含空集 = 全 Raw）
  → 用 canonical_exact 填补 gap（Raw 保留）
  → 每个子集都成为 SentenceCombination
  → 按 sum(candidateScore) 排序后切片
```

**不存在** `repairStatus` / `PARTIAL_REPAIR` / completeness 字段 → **`NO_REPAIR_COMPLETENESS_CONTRACT`**。

---

## Q1 — 是否存在 Repair Completeness Contract？

**否。** `NO_REPAIR_COMPLETENESS_CONTRACT`。

现有字段仅有：`replacements[]`、`candidateScore`、`repairTarget`、`source`（如 `canonical_exact`）。无 `repairStatus` / `pathKind` completeness。

---

## Q2 — 「候选声城」在哪里登记为正式 Candidate？

1. **文本生成：** `buildSentenceCandidates`（子集 `{后选→候选}` + gap 保留 `声|城`）
2. **正式池：** `mergeCrossPathSentenceCandidates`（exact text 去重后进入 ≤16）

不是 KenLM 创造了该句；KenLM 只接收已录取池。

---

## Q3 — Raw fallback 是否同时承担连通与 Admission？

**是。** 分类：`RAW_FALLBACK_ADMISSION_COUPLING`。

| 职责 | 现状 |
|------|------|
| PATH_CONNECTIVITY | 需要（canonical/fallback 保覆盖） |
| FINAL_CANDIDATE_ADMISSION | **错误地等价** — 含 raw gap 的局部替换子集直接成为 KenLM 句 |

「候选 + 声 + 城」在系统中是 **三个独立 FineSpan 槽位的合法组合**（1 个 repair + 2 个 raw gap），**不是**被标记的同一损坏区局部修复。架构无 `repairRegion` / `damageSpan`。

---

## Q4 / Q5 — Partial 占比（75 Meaningful Competition Cases）

来自 `candidate_budget_distribution.csv` / `summary.json`：

| Metric | Value |
|--------|------:|
| RAW_ONLY | 75 |
| PARTIAL_REPAIR | 60 |
| MIXED_BUT_VALID | 73 |
| COMPLETE_REPAIR | 4 |
| Partial / 非 Raw | **~43.8%** |
| Top16 非 Raw 中 Partial | **~43.8%** |

→ **有限 16 槽被大量局部单点替换占用**（本模式证据充分）。

---

## Q6 — 是否偏向 single replacement？

**是（枚举+可达性双重）。**

- 枚举：每个 repair Edge 的单点子集必然生成。
- 可达性：损坏簇缺少第二原子（如 `生成` Tone miss）时，**无法**形成 COMPLETE，只留下 PARTIAL。
- 排序：`candidateScore` 为先验加和 — 单点 replacement（score>0）高于 Raw（0）；并非故意惩罚 multi，但 multi 常因缺 Edge 不存在。

Secondary：`SINGLE_REPLACEMENT_ENUMERATION_BIAS`。

---

## Q7 — Complete 是否因 cap/score/dedupe 被删？

对本模板（`后选声城/生城`）：**COMPLETE 从未形成**（无 `生成` Edge），故不是被 cap 删掉。

一般路径上：per-bucket `maxSentenceCandidates` + 全局 ≤16 + 双重 text dedupe **可能**截断靠后的多替换句（`cap_and_dedupe_matrix.csv`）。本轮未证明「完整句已生成后被挤掉」为该模板主因。

---

## Q8 / Q9 — 职责重叠与重复 Cap

| 发现 | 标记 |
|------|------|
| Assembly 用 lexicon prior 加和排序 | 轻度 `PRE_KENLM_RANKING_RESPONSIBILITY_OVERLAP` |
| CrossPath / KenLM | 无流畅度重复（符合冻结） |
| per-bucket cap + global ≤16 | 必要但层级重叠 |
| Assembly `uniqueByText` + CrossPath exact dedupe | 双重文本去重 |

---

## Q10 — 最小调整应在 Assembly 还是 CrossPath？

**优先 CrossPath Admission（Option B）**；若能精确定义 replacement cluster，可选 Assembly Admission（Option C）。  
详见 `minimal_adjustment_options.md`。

---

## Q11 — 不改 Tone/Recall/Domain/KenLM 能否提升质量？

**能。** 通过 Admission/预算：减少 Partial 占用 Top16，把槽位留给 MIXED_BUT_VALID / COMPLETE（及其他可达完整组合）。

不恢复 `生成`（Tone miss 允许失败）；目标是 **不把「候选声城」当作与完整修复同等资格的正式句**。

---

## Q12 — 是否足够进入开发前方案设计？

**是。** Primary Cause 已定位；选项边界已比较。

---

## 重点 Case

| 组 | Cases |
|----|-------|
| Focus Partial | d043 / d088 / d133 / d178（Runtime 同模） |
| 另见 | d019 等 `候选生城` 族；`partial_repair_case_trace.csv` |
| Complete 样本 | `complete_repair_case_trace.csv`（本轮审计类 COMPLETE 很少） |
| Raw 正确噪声 | humanDecision=RAW_CORRECT 的近音 alt（`_contrast_samples.json`） |

Primary Cause（Partial）：**`RAW_FALLBACK_ADMISSION_COUPLING`**  
Secondary：`NO_REPAIR_COMPLETENESS_CONTRACT` · `SINGLE_REPLACEMENT_ENUMERATION_BIAS`

---

## Final Verdict

```text
PARTIAL_REPAIR_ADMISSION_DEFECT_CONFIRMED

Raw fallback 的路径连通职责
与最终候选 Admission 发生耦合，
导致局部半修复句大量进入 CrossPath / KenLM。

已定位最小调整边界，
可以进入开发前方案设计。
```
