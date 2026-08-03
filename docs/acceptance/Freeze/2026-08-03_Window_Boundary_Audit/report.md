# Syllable Alignment & Window Boundary Audit Report

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Nature | **READ ONLY** |
| Freeze | **FW_V4_FREEZE_2026_08_03** |
| Changed | **None** |
| Verdict | **WINDOW_ALIGNMENT_CORRECT** |

---

## 1. 审计范围

只确认：

```text
ASR Raw → Pinyin → Syllable → Sliding Window → Recall 入口
```

不审计 Tone 预测是否“准”。

---

## 2. 调用链 / 字段归属

详见 `window_callgraph.md`。

| 字段 | 决定者 |
|------|--------|
| `globalSyllables` | `buildUtteranceSyllableCoordinate` ← `textToSyllables(CJK run)` on **Raw** |
| `syllableStart` / `syllableEnd` | `buildLexicalWindowQueries` 双重循环 |
| `windowText` / `rawStart` / `rawEnd` | `buildWindowDescriptorForRange` + `syllableRangeToRawCharRange` |
| `windowPinyinKey` (plain) | `globalSyllables.slice(start,end).join("\|")` |
| 保留/丢弃 | `latticeHardBlockFilter`（本批 6 Case 全部保留） |

---

## 3. 音节如何切出来？（以「我们正在」噪声为例）

ASR Raw：`我闷蒸在...`

```text
buildUtteranceSyllableCoordinate(rawText)
  → CJK run 整段
  → textToSyllables("我闷蒸在升级…")
  → wo | men | zheng | zai | …
```

| Char | Stream syllable |
|------|-----------------|
| 我 | wo |
| 闷 | men |
| 蒸 | zheng |
| 在 | zai |

**不是**把「我们」错切成「我+闷」。  
Raw 字形本就是「我闷」；`闷` 的 plain 恰与 `们` 同为 `men`。  
Expected「我们正在」的 plain 流与 Raw **相同**（`rawEqualsExpectedSyllables=true`），差异在字形/声调，不在音节边界错位。

---

## 4. 失败 Case — 关键 Window（Trace）

全量见 `window_trace.csv`。下列为正确修复所需的 **plain-key** 窗（均已生成且未 blocked）：

| Case | 目标 | windowText | plain | windowId | Recall 入口 |
|------|------|------------|-------|----------|-------------|
| nn-train-01 | 我们 | 我闷 | wo\|men | 0:2 | YES |
| nn-train-01 | 正在 | 蒸在 | zheng\|zai | 2:4 | YES |
| nn-train-01b | 正在 | 蒸在 | zheng\|zai | 2:4 | YES |
| snack-01 | 小食 | 消失 | xiao\|shi | 12:14 | YES（命中「消失」） |
| sync-01 | 已经 | 已精 | yi\|jing | 6:8 | YES |
| sync-01 | 同步 | 通步 | tong\|bu | 8:10 | YES |
| trigger-01 | 触发 | 出发 | chu\|fa | 8:10 | YES（命中「出发」） |
| threshold-01 | 阈值 | 阈之 | yu\|zhi | 4:6 | YES |

**正确字形窗**（`windowText===小食` 等）：**不存在** —— Raw 无该字形，Window Builder 不会发明字符。

生成计数：每 Case `generated === theoretical`（1..5 全量滑动）；`blockedWindowCount=0`。

---

## 5. Sliding Window / 剪枝

合同见 `boundary_contract.md`。剪枝阶段见 `window_pruning.csv`。

```text
生成 (1..5 全量)
  → length 已在循环内满足
  → latticeHardBlockFilter（本批全部 pass）
  → recallTopKForWindows
```

**本批未触发**的硬剪：raw_gap / whitespace / punct / sentence / non_cjk / asr_word_gap。

**Window 生成阶段没有**：TopK、Beam、`maxCompleteSegmentationPaths`。  
`maxGlobalWindowCount=120` 用于 LTR `blocked-window-filter`，**不**裁剪 Lattice `buildLexicalWindowQueries`。

---

## 6. Alignment

见 `syllable_alignment.csv`。

- 关键噪声区：字符与音节 **1:1**（`runLen === sylCount`）。
- CSV 中 `charPinyinMatchesStream=false`（调/重/校）：孤立单字读音 ≠ 整句上下文读音（多音字），**不是切分错位**。
- 旁注：`normalizeSyllable` 去掉 ü →「率」变成 `l`（内容缺陷，仍 1 字 1 音节；**不**导致「阈值」窗缺失——`4:6:阈之` 已存在）。

---

## 7. Q1–Q5

### Q1 音节切分是否正确？

**相对 ASR Raw：正确。**  
按 Raw 字形做 `textToSyllables`；非 Expected 文本驱动。

### Q2 正确 Window 有没有生成？

| 含义 | 结果 |
|------|------|
| `windowText === 正确词` | 基本 **没有**（Raw 字形不同） |
| `plainPinyin === 正确词 lexicon plain` | **全部有**（上表） |

### Q3 哪些 Window 被提前剪掉？

本批 6 Case：**无** hard-block。关键 plain 窗均进入 Recall。

### Q4 失败因为 Window 还是 Tone？

**不是 Window 缺失。**  
Trace：plain 窗已在 → Recall 发出噪声 Tone 联合键（Query Builder 审计 Mode C）→ 命中噪声词/空。  
归属：**Tone/Query Key**，非 Window Builder。

### Q5 Window Builder 是否符合冻结架构？

**是。** Lattice：`buildLexicalWindowQueries`（1..5）+ `latticeHardBlockFilter` + `recallTopKForWindows`，与 `lattice-fine-span-runtime` 一致。

---

## 8. Final Verdict

```text
WINDOW_ALIGNMENT_CORRECT

音节按 ASR Raw 正确切分（1:1）。
滑动窗全量生成；关键 plain-key Window 存在且未剪枝。
失败不在 Window / Syllable Alignment，而在后续 Tone 联合 Query Key。
```
