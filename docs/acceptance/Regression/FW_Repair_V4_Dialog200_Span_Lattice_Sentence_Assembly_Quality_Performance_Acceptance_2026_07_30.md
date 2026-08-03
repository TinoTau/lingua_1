<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_Dialog200_Span_Lattice_Sentence_Assembly_Quality_Performance_Acceptance_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — dialog_200 Span Lattice and Sentence Assembly Quality & Performance Acceptance

| 字段 | 值 |
|------|-----|
| Date | 2026-07-30 |
| Nature | TEST + TRACE AUDIT + QUALITY ACCEPTANCE（只读；仅新增 audit probe/报告） |
| Entry | `runSpanAssemblyV4Orchestrator` |
| Input | `test wav/dialog_200/cases.manifest.json` → `cases[].text` |
| Runtime boundary | **文本级 Span Assembly 子链** — 非 Electron Node / ASR / KenLM scorer E2E |
| Artifacts | `docs/tone-v2/_audit_scratch/dialog200_span_assembly_acceptance/` |

---

## 1. Executive Summary

对 dialog_200 **200/200** 使用真实生产 `runSpanAssemblyV4Orchestrator` + 真实 Lexicon SQLite 完成结构/候选传播/组装/性能验收。

核心结论：

1. **结构硬门通过**（Path 无 gap/overlap、Window 无越界、prefilled 定义、KenLM pool≤16、无组装重建失败）。探针误报的 `coordinateMappingFailure=4494` 已纠正为 **0**（字段名 `charStart/charEnd` 误读）。
2. **1..5 滑窗真实生成**（200/200 含 length-1）；候选在 Recall→Edge 层大体保留；**66.5%** case 存在多候选 Edge。
3. **KenLM 输入恒为 1 唯一文本** 的第一坍缩解释：多数为 **同表面多候选**（R9）；少数表面不同词在 Bucket/Select 被滤掉（R6/R7），**不是** Assembly `candidates[0]` 硬截断。
4. dialog_200 文本本身接近“已正确”，组装输出几乎全为 **RAW / NO_OP**；**不得**据此写纠错准确率。
5. **性能硬门与目标门均通过**（warm p50≈66ms，p95≈106ms，max≈137ms）。

---

## 2. Test Scope and Runtime Boundary

| 项 | 本轮 |
|----|------|
| Electron Node Runtime / Scheduler / Job | **未启动** |
| ASR / Tone Service / NMT / TTS | **未启动** |
| KenLM subprocess scorer | **未调用**（仅验证 prefilled pool） |
| 生产入口 | `runSpanAssemblyV4Orchestrator` |
| 观测入口 | 同套生产 API：`buildUtteranceSyllableCoordinate` / `buildLexicalWindowQueries` / `recallTopKForWindows` / `buildLexicalEdges` / `injectFallbackEdges` / `enumerateCompleteSegmentationPaths` / `materializePathFineSpans` |
| Mock | **无** |

---

## 3. Exact Production Call Chain

```text
runSpanAssemblyV4Orchestrator
  → buildUtteranceSyllableCoordinate
  → partitionCoarseSpans
  → runLatticeFineSpanGeneration
       → buildLexicalWindowQueries (1..5)
       → latticeHardBlockFilter
       → recallTopKForWindows (LexiconRuntimeV2 SQLite)
       → buildLexicalEdges
       → injectFallbackEdges
       → enumerateCompleteSegmentationPaths
       → materializePathFineSpans
  → per Path: rebindToneForFineSpan → runDomainAwareAssembly
       → voteUtteranceDomainFromPool → buckets → buildSentenceCandidates
  → mergeCrossPathSentenceCandidates → prefilledCombinations
```

证据：probe 直接 require dist 生产模块；`summary.json.entry`；case trace 含 `latticeTrace` / `pathAssemblyTraces` / `architectureCompliance`。

---

## 4. dialog_200 Dataset Description

| 项 | 值 |
|----|-----|
| casesTotal | 200 |
| 输入字段 | `text`（Sentence） |
| `expectedText` | 与 utterance/text **相同**（TTS 还原语料）→ **不是纠错金标** |
| WAV | 存在但本轮 **未读取** |

---

## 5. Trace Schema

路径：

```text
docs/tone-v2/_audit_scratch/dialog200_span_assembly_acceptance/
  cases/<caseId>.json
  summary.json
  performance.json
  representative_cases.md
  analysis_addendum.json
  case_index.json
```

每 case 含：coordinate / windows / recall / edges / paths / fineSpans / votes / buckets / assemblies（含 replacementOperations）/ crossPath / diversityFlags / firstCollapseLayer / structuralFailures / timing。

---

## 6. Coordinate and Window Validation

### Window（生产行为）

| 指标 | 结果 |
|------|------|
| 含 length-1 Window 的 case | **200/200** |
| d001 分布示例 | `{1:27,2:26,3:25,4:24,5:23}`（整句滑动 + 合法重叠） |
| invalidWindowRange | **0** |
| 句首→句尾滑动 | 是（`windowsPerStartPosition` 覆盖 0..N-1） |

### Coordinate

| 项 | 结果 |
|----|------|
| 探针误报 coordinateMappingFailure | 4494（**探针 bug**：读 `start/end`，真实字段为 run 级 `charStart/charEnd`） |
| 纠正后 | **0**（见 `analysis_addendum.json`） |
| 生产 coverageOk / Window raw 映射 | 正常 |

---

## 7. Recall Candidate Analysis

| 指标 | 值 |
|------|-----|
| casesWithRecallCandidate | 166 (83%) |
| casesWithMultipleRecallCandidates | 133 (66.5%) |
| multiDomainCandidateCount>0 | 46 cases |
| TopK / 多候选 | 存在；**未**在 Recall 阶段只留单一 winner（同窗可 >1） |

例 d001：`maxCandidatesPerWindow=3`，`totalCandidates=15`。

噪声例 d023：窗「地址」召回「低脂/地质」——词库/拼音歧义噪声，非整句金标纠错。

---

## 8. LexicalEdge Candidate Preservation

| 指标 | 值 |
|------|-----|
| casesWithMultiCandidateLexicalEdge | **133 (66.5%)** = 与 multi-recall 同集 |
| d001 recallCand vs edgeCand | 15 = 15 |
| 同 range Map 覆盖丢候选 | 未观察到系统性丢失 |
| fallback | 只补 coverage；LexicalEdge 不被覆盖 |

**结论：** Recall 多候选完整进入 Edge；多数“多候选”= **同表面不同 termId/domain**。

---

## 9. SegmentationPath Coverage and Diversity

| 指标 | 值 |
|------|-----|
| pathCoverageFailure | **0** |
| pathOverlapFailure | **0** |
| casesWithMultiplePaths | 30 (15%) |
| distinctEffectiveCandidatePathCount>1 | 30（与多 Path 一致——边界序列真实不同） |
| Path cap | 8/8 PROVISIONAL（未调整） |

---

## 10. PathFineSpan Materialization

FineSpan 保留 `candidates[]` 与 raw/syllable range；fallback span 空候选。  
Tone 前后 count：本轮无 acousticSlices → Evidence Unavailable 合法；**未**见 Tone 静默删候选主导坍缩。

---

## 11. Tone Rebind Impact

| 项 | 结果 |
|----|------|
| Tone Service | 未启动 |
| acousticToneSlices | 未传入 |
| rebind | 库内执行；证据 unavailable |
| 非法候选丢失 | 未发现主导模式 |

---

## 12. Domain Vote Validation

| 项 | 结果 |
|----|------|
| scope | per_path（architectureCompliance） |
| retentionRatio | **0.75**（未改） |
| casesWithMultipleRetainedDomains | 49 (24.5%) |
| base/fallback 计票 | Trace 中 base 列入 excluded；fallback 空候选 |

---

## 13. SameDomain Bucket Validation

| 项 | 结果 |
|----|------|
| casesWithMultipleBuckets | 72 (36%) |
| base + domain | Bucket terms 含单字 base + 领域词（如「热拿铁」） |
| 串桶 | 未发现跨 retained domain 非法混合输出句 |

表面不同噪声候选常在 Select 后不进 `selectedCandidates`（见 d023 `candidateExcludedFromAllBuckets`）。

---

## 14. Sentence Assembly Expansion Validation

| 项 | 结果 |
|----|------|
| casesWithMultipleAssemblyCombinations | 72（多 bucket/path 各生成组合，但文本常相同） |
| casesWithMultipleDistinctAssemblyTexts | **0** |
| 典型 classification | `NO_OP_REPLACEMENT` / `RAW_UNCHANGED` |
| grid | 多数 slot count=1 → `naiveCombinationPotential=1` |

**未发现** `buildSentenceCandidates` 在多 slot 多候选时强制 `slice(0,1)` 的证据；坍缩发生在 **进入 Assembly 之前的 Select/Bucket**，或候选表面本就相同。

---

## 15. Replacement Reconstruction Validation

| 检查 | 结果 |
|------|------|
| invalidReplacementRange / rebuild 失败 | **0** |
| textTruncation | **0** |
| 输出可由 replacementOperations 重建 | **是**（抽样 + 全量计数） |

---

## 16. Cross-Path Merge Validation

| 项 | 结果 |
|----|------|
| distinctTextsBeforeDedup | **恒为 1**（200/200） |
| kenlmInputN | **恒为 1** |
| kenlmInputOver16 | **0** |
| undefinedPrefilled | **0** |
| exact-text first-wins / dedup-before-cap | 满足（输入已唯一则平凡成立） |

---

## 17. Candidate Diversity Funnel

```text
casesTotal                                         200
↓ casesWithRecallCandidate                         166 (83%)
↓ casesWithMultipleRecallCandidates                133 (66.5%)
↓ casesWithMultiCandidateLexicalEdge               133 (66.5%)  ← Recall→Edge 未坍缩
↓ casesWithMultiplePaths                            30 (15%)
↓ casesWithMultipleEffectiveCandidatePaths          30 (15%)
↓ casesWithMultipleRetainedDomains                  49 (24.5%)
↓ casesWithMultipleBuckets                          72 (36%)
↓ casesWithMultipleAssemblyCombinations             72 (36%)
↓ casesWithMultipleDistinctAssemblyTexts             0 (0%)   ← 文本多样性在此归零
↓ casesWithMultipleDistinctCrossPathTexts            0 (0%)
↓ casesWithKenlmInputNAbove1                         0 (0%)
```

**第一次“不同文本”归零层：** Assembly 输出文本集（在 Edge 已有多候选之后）。

细分：

- **133**：Edge 多候选但 **replacement 字符串相同** → 文本不可能分叉  
- **10**：同窗表面不同词 → 在 Bucket/Select 被排除，Assembly grid 已是每槽 1 候选  

---

## 18. Candidate Diversity Root Cause

| Root cause | 影响 case | 首次坍缩层 | 代表 | 说明 |
|------------|-----------|------------|------|------|
| R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT（同表面多候选） | 133 | Edge 后 / Assembly 文本 | d001 拿铁×3 | 非丢候选，是表面等价 |
| R1_RECALL_ONLY_ONE_CANDIDATE | 67 | Recall | — | 无多候选可展开 |
| R6/R7_VOTE_BUCKET_SELECT（表面异词被滤） | 10 | Bucket/Select | d023 地址→低脂/地质 | 噪声词未进 selected；grid naive=1 |
| R8_ASSEMBLY_ONLY_USES_FIRST_CANDIDATE | **0 证实** | — | — | 无“grid 多候选却只取第一”证据 |
| R12/R13 数据/词库限制 | 主导 | Lexicon + 语料 | — | 金标文本 + 同形多标签 |

**KenLM 恒 1 的原因：** 进入 Cross-Path 前已无不同文本；非 Merge 误合并。

---

## 19. Automated Assembly Quality Results

| 指标 | 值 |
|------|-----|
| casesWithRawOnly | 200 |
| casesWithAnyModifiedCandidate | 0 |
| invalidAssemblyCount | 0 |
| truncatedTextCount | 0 |
| kenlmInputOver16 / undefinedPrefilled | 0 / 0 |

评价维度：

- **STRUCTURAL_CORRECTNESS**：通过  
- **PLAUSIBILITY**：输出=原文，对已正确语料合理  
- **SEMANTIC_GROUND_TRUTH**：无纠错金标 → **不计算准确率**

---

## 20. Representative Case Manual Review

见：`representative_cases.md`（20 case）。

抽样覆盖：单/多 Path、多 Recall、多领域、长句、标点、数字/Latin、高 fallback 相关场景。

启发式等级以 ACCEPTABLE/QUESTIONABLE 为主：结构完整；多样性受 R9/词库限制；**无 BAD 结构失败**。

例 d002：多候选 Edge 存在，但组装句=原文，replacement 为逐 span NO_OP。

---

## 21. Performance Methodology

| 项 | 值 |
|----|-----|
| Cold | 1×200 |
| Warm | 3×200（串行） |
| 计量对象 | `runSpanAssemblyV4Orchestrator` totalMs |
| 分层 | audit 外围包裹 coordinate/window/recall/edge/fallback/path/materialize |
| tone/vote/bucket/assembly/merge 分层 | **NOT_OBSERVABLE**（不侵入生产） |

---

## 22. Cold and Warm Performance Results

| Run | p50 | p95 | max |
|-----|-----|-----|-----|
| Cold | 66.7 ms | 108.2 ms | 137.1 ms |
| Warm merged (n=600) | **66.5 ms** | **106.4 ms** | **136.7 ms** |

分层（trace pass）：

| 阶段 | p50 | p95 | max |
|------|-----|-----|-----|
| recallMs | 48.0 | 82.3 | 119.0 |
| orchestratorMs | 58.9 | 98.4 | 129.7 |
| window/edge/path/… | ≪1–2 ms | — | — |

**瓶颈 = Recall / SQLite**，非 Assembly/Merge。

---

## 23. Slowest Cases Analysis

最慢 10 例（如 d109/d064/d019）：syllableCount≈38，windowCount≈180，recallMs>100ms，pathCount≤2，assemblyDistinct=1。  
性能与 **窗口数 / Recall** 正相关，与组合爆炸无关。

---

## 24. Structural Acceptance Results

```text
SPAN_ASSEMBLY_STRUCTURE_PASS
```

硬门（纠正探针坐标误报后）：

| 门 | 值 |
|----|-----|
| orchestratorFailure | 0 |
| invalidWindowRange | 0 |
| pathCoverage/Overlap | 0 |
| materializationFailure | 0 |
| invalidReplacement / truncation | 0 |
| undefinedPrefilled / kenlm>16 | 0 |

---

## 25. Quality Acceptance Results

```text
ASSEMBLY_QUALITY_PARTIAL
```

理由：

- 组装结构与重建正确；无证实的 R8 Assembly 缺陷  
- 候选文本多样性受 **词库同表面多标签 + 语料已正确 + 噪声召回被 SameDomain 滤除** 限制（DATA_OR_LEXICON_LIMITED）  
- 无法在无纠错金标下声称修复质量 PASS  

---

## 26. Performance Acceptance Results

```text
PERFORMANCE_ACCEPTABLE
```

| 门 | 结果 |
|----|------|
| 200/200 无异常 | ✅ |
| warm p95 ≤ 200 / max ≤ 500 | ✅ (106 / 137) |
| warm p50 ≤ 100 / p95 ≤ 150 | ✅ |
| pool ≤16 / Path ≤ cap | ✅ |

说明：文本级 150ms **≠** 完整节点端预算。

---

## 27. Blocking Issues

**无结构阻塞 / 无性能硬门阻塞 / 无已证实 Assembly first-only 缺陷。**

---

## 28. Non-Blocking Issues

| ID | 问题 | 分类 | 影响 |
|----|------|------|------|
| N1 | KenLM pool 文本多样性≈0 | LEXICON_DATA / 语料 | 质量观察 |
| N2 | 同窗同表面多 term（多 domain tag） | LEXICON_DATA | 不产生不同句 |
| N3 | 噪声召回（地址→低脂） | LEXICON_DATA / RECALL | 被 Bucket 滤掉 |
| N4 | 探针坐标字段误读 | TRACE_ONLY | 已纠正 |
| N5 | Vote/Assembly 内部分层耗时不可观测 | TRACE_ONLY | 不影响硬门 |
| N6 | coarsePartition 在观测链额外耗时 | PERF 观察 | 生产 orch 内含 |

---

## 29. Minimum Next Development Scope

| 问题 | 代码位置（范围） | 层级 | case 数 | 结构 | 质量 | 性能 | 冻结合同 | 最小下一步 | 回归 |
|------|------------------|------|---------|------|------|------|----------|------------|------|
| 同表面多标签不产生句多样性 | Lexicon tags + Edge | Recall/Edge | 133 | 无 | 观察 | 无 | 不破坏 | **LEXICON_DATA** 审计 / Candidate Diversity Audit | dialog_200 surface-distinct 计数 |
| 噪声召回进窗 | `recallTopKForWindows` / 词库 | Recall | ~10 | 无 | 噪声 | 无 | 不破坏 | **LEXICON_DATA** 或 Recall 质量（另立项） | d023 类 |
| Assembly 内分层计时 | orchestrator | Trace | — | 无 | 无 | 观测 | 不破坏 | **TRACE_ONLY** 可选 hook | freeze-contract |
| 真修复质量 | 需错句语料 | Quality | — | — | 缺金标 | — | — | 另建纠错集；禁止改 dialog_200 金标迎合 | — |

**本轮禁止直接修改生产算法。**

---

## 30. Target List Completion

| ID | 状态 |
|----|------|
| T1–T15 | ✅ |
| T16 第一坍缩层 | ✅（文本多样性：Assembly 输出；细分 R9/R6–R7） |
| T17–T19 | ✅ |
| T20 | ✅（三分判定） |

---

## 31. Check List Completion

* [x] 未伪称 Electron Node E2E  
* [x] 真实 Span Assembly + SQLite；无 mock  
* [x] 200 case Trace 导出  
* [x] 1..5 Window / 坐标（纠正后）/ Recall / Edge / Path / FineSpan / Vote / Bucket / Assembly / Cross-Path  
* [x] replacementOperations 可重建  
* [x] 多样性漏斗 + 坍缩层  
* [x] 自动质量 + ≥20 代表 case  
* [x] 1 cold + 3 warm；p50/p95/p99/max；最慢 10  
* [x] 未改算法/阈值/词库；未伪造准确率  
* [x] 结构 / 质量 / 性能三分结论  

---

## 32. Final Verdict

### Structure

```text
SPAN_ASSEMBLY_STRUCTURE_PASS
```

### Quality

```text
ASSEMBLY_QUALITY_PARTIAL
```

### Performance

```text
PERFORMANCE_ACCEPTABLE
```

### Overall

```text
DIALOG200_SPAN_ASSEMBLY_ACCEPTANCE_PARTIAL
```

条件满足：结构通过；性能达硬门与目标门；质量受词库/语料/候选表面等价限制；**未发现** Assembly 无理由只取第一候选的实现缺陷。

---

## Appendix — 核心问题短答

1. **1..5 滑窗？** 是（200/200 含 1 字窗）。  
2. **Recall 多候选？** 是（133/200）。  
3. **Edge 保留？** 是（与 multi-recall 对齐）。  
4. **Path 真实不同？** 30 case 边界序列不同且覆盖完整。  
5. **FineSpan 保留候选？** 是。  
6. **Vote 用有效 domain cand？** per_path Presence；多域保留 49 case。  
7. **Bucket 含 domain+base？** 是。  
8. **Assembly 写回？** replacement 可重建；本语料多为 NO_OP。  
9. **Merge 前多文本？** **否**（0）。  
10. **为何 KenLM≈1？** 前序已无不同表面句；同表面多候选或噪声被滤。  
11. **句质量可接受？** 结构可接受；修复语义 **PARTIAL / 无金标**。  
12. **性能？** 文本子链 **ACCEPTABLE**（Recall 主导）。
