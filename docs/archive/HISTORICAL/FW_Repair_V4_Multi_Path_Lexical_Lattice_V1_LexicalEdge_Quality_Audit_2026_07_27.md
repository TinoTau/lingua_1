<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_LexicalEdge_Quality_Audit_2026_07_27.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Multi-Path Lexical Lattice V1 · LexicalEdge Quality Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **LexicalEdge Quality Audit + Complete Path Connectivity Root Cause Analysis**（只读） |
| Authority | Architecture V1.0.0 FROZEN · Implementation Contract V1.0.0 (+ Change Record 1.0.1) · Phase 1 Final Closure · Phase 2 Development Report · Phase 2 Code Verification & Node Runtime Audit · **当前实际代码** · **dialog_200 真实 SQLite 证据** |
| Evidence dir | [`_audit_scratch/lattice_v1_lexical_edge_quality/`](./_audit_scratch/lattice_v1_lexical_edge_quality/) |
| Probe | [`_audit_scratch/lexical-edge-quality-audit-probe.mjs`](./_audit_scratch/lexical-edge-quality-audit-probe.mjs) |
| Business code / lexicon / Contract 修改 | **无** |

---

## 1. Executive Summary

在真实 operational lexicon（`node_runtime/lexicon/v3/lexicon.sqlite`）与完整 Recall 执行前提下，dialog_200 **0/200** 句能形成 lexical-only 完整 `[0,N)` 路径；**200/200** 需要 fallback（合计注入 **2042**，均 **10.21**，p95 **17**）。

根因不是「Fallback 坏了」或「Edge Builder 丢候选」，而是：

1. **主因 — Lexicon Coverage**：operational `term` 表 **`length(word)=1` 条目 = 0 / 10061**；高频连接字（我/的/能/请/…）SQLite 反查 **不存在**；常用双字连接词（谢谢/我想/请问）亦缺失。
2. **结构后果 — Graph Connectivity**：有 hit 的位置仅 **32.5%**，从 0 可达位置仅 **9.2%**；LexicalEdge 几乎全是 **len=2** 岛屿边，**len=1 Edge = 0**，orphan 远多于可衔接边。
3. **次因 — Hard-block 邻接句界**：`sentence_boundary` 把 **紧贴 `。！？` 前一字** 的全部窗口（含 length=1）硬阻断 → 9/200 句 first breakpoint = `ALL_WINDOWS_BLOCKED`（典型「吗？」）。
4. **稀有 — minPrior 过滤**：`fwConfig.minPrior=0.5` 把 `麻烦`(prior=0.35, source=homophone_variant) 等 16 条低 prior 词滤掉；属候选门控，不是 Edge Builder 缺陷。
5. **非因**：Candidate→Edge drop = **0**；Edge merge 无候选丢失；Recall incompleteness gate 通过；Phase 1 冻结语义未被重新解释。

```text
lexical-only complete path rate = 0 / 200
positionLexiconHitRate          ≈ 32.5%
reachablePositionRate           ≈ 9.2%
singleSyllableLexicalEdgeCount  = 0
UNKNOWN (fallback coarse)       → 已重分类归零（98 → 0 unresolved）
```

---

## 2. Final Verdict

```text
LEXICAL EDGE QUALITY: NOT ACCEPTABLE

PHASE 2 ACCEPTANCE BLOCKED
```

主要修复方向：

```text
MULTIPLE ROOT CAUSES
  1) LEXICON COVERAGE REPAIR          ← 主责 / 主路径
  2) WINDOW / HARD-BLOCK REPAIR       ← 句界邻接 length-1 误杀（次责）
  3) CANDIDATE FILTER REPAIR          ← minPrior 对合法常用词误杀（稀有但可证）
```

**不得**以「Fallback 可补齐」或「200 completed / 0 failed」作为 LexicalEdge 质量通过依据。

---

## 3. Audit Scope

### 3.1 本轮是

```text
LexicalEdge Quality Audit
+ Complete Path Connectivity Root Cause Analysis
```

### 3.2 本轮不是

```text
Phase 2/3 新功能 · 词库扩展开发 · Recall/Hard-block/Path/Fallback 修改
Production Cutover · Contract 改写
```

### 3.3 禁止修改（已遵守）

```text
Window / Recall / Evidence / Edge Builder / Path Enumerator / Fallback
Vote / Assembly / KenLM / SQLite Schema / Production Orchestrator
```

### 3.4 唯一审计目标

```text
为何真实 Recall 已产生 Candidate / LexicalEdge，
却没有任何一句话能仅靠 LexicalEdge 覆盖 [0,N)？
```

---

## 4. Runtime Evidence

| 项 | 值 |
|----|----|
| Environment | C — Offline harness + 真实 SQLite（`ELECTRON_RUN_AS_NODE` + `LexiconRuntimeV2.loadFromBundleDir(node_runtime/lexicon/v3)`） |
| dialog_200 | completed=200 / failed=0（既有 Phase2 结果一致） |
| lexicon | term≈10061；**len1=0**；enabled 且 prior≥0.5 ≈10045 |
| minPrior | `fwConfig.minPrior = 0.5`（默认） |
| Evidence | `lexical_edge_*.jsonl` + `lexical_edge_quality_summary.json` |

关键指标（summary）：

| Metric | Value |
|--------|-------|
| completePathRate | **0** |
| totalPositions | 4494 |
| positionsWithNoWindow | **0** |
| positionsWithOnlyBlockedWindows | 410 |
| positionsWithRecallableWindows | 4084 |
| positionsWithLexiconHit | 1460（32.49%） |
| positionsWithOutgoingLexicalEdge | 1460（与 hit 对齐） |
| positionsReachableFromStart | 413（9.19%） |
| fallbackInjectionSum | 2042（avg 10.21 / p50 9 / p95 17 / max 20） |
| multiPathUtterances（含 fallback） | 28 |
| candidateProducedButNoEdgeCount | **0** |
| unknownUnresolved | **0** |

---

## 5. End-to-End Data Flow

| 层 | 输入 | 输出 | 可能丢失 | 负责 | 符合 Contract？ |
|----|------|------|----------|------|----------------|
| A. Coordinate | rawText | `UtteranceSyllableCoordinate` | 非汉字切分异常 | Coordinate / IME stream | 是（本轮未见无 Window 的 position） |
| B. Window | syllables | WindowQuery length 1..5 | 无（positionsWithNoWindow=0） | Window generator | 是 |
| C. Hard-block | windows + coarse + raw | blocked / recallable | 句界邻接、标点、raw_gap、非CJK | Hard-block | **规则实现符合代码；邻接句界对 length-1 过严（见 §8）** |
| D. Recall | recallable windows | WindowCandidate[] | empty hit；minPrior；缓存空结果 | Recall | incompleteness gate OK；空结果主因词库/ prior |
| E. Candidate filter | hits | kept candidates | prior&lt;minPrior | Recall pre-filter | 冻结既有语义；对「麻烦」等合法词过严 |
| F. Edge construction | windows w/ candidates | LexicalEdge[] | 无候选则无边（设计） | Edge Builder | 是；**无错误丢边** |
| G. Merge / identity | same boundary | merged edge | first-wins；本轮 duplicateBoundaryInput=0 | Edge Builder | 是 |
| H. Graph | LexicalEdge[] | adjacency | 断点 / orphan / dead-end | Path 输入图 | 连通性失败 |
| I. Complete path | graph | lexical-only path | 无完整路径 → fallback | Path Enumerator + Fallback | Fallback 行为符合 Contract；**不能证明 Lexical 质量** |

---

## 6. Position Coverage Matrix

逐位置矩阵：[`lexical_edge_position_matrix.jsonl`](./_audit_scratch/lattice_v1_lexical_edge_quality/lexical_edge_position_matrix.jsonl)

每行含：`sentenceId / position / raw / pinyin / window* / blocked* / recall* / candidate* / outgoingEdges / reachableFromStart / canReachSentenceEnd / fallbackRequired` 等。

可回答：**每一个 fallback position 为何没有可用于完整路径的 lexical edge**（见 first breakpoint + no-hit / hard-block 专档）。

---

## 7. Coordinate / Window Coverage

| 统计 | 值 | 判定 |
|------|-----|------|
| positionsWithNoWindow | **0** | 非 Window coverage 缺口 |
| positionsWithOnlyBlockedWindows | 410 | Hard-block 覆盖问题（§8） |
| positionsWithRecallableWindows | 4084 | 绝大多数位置至少有可召回窗 |

结论：冻结设计下 **每个音节位都作为某 Window 的 start 出现**；本轮 **不是** Window generation 缺陷，**不得**用 fallback 掩盖（此处也无需掩盖）。

---

## 8. Hard-block Analysis

### 8.1 分布（blocked window reason）

| Reason | Count |
|--------|------:|
| raw_gap_between_spans | 1981 |
| sentence_boundary | 1945 |
| punctuation_in_window | 1099 |

### 8.2 First-breakpoint 归因

| Reason | Sentences | Ratio |
|--------|----------:|------:|
| RECALL_ZERO_HIT | 191 | 95.5% |
| ALL_WINDOWS_BLOCKED | 9 | 4.5% |

`ALL_WINDOWS_BLOCKED` 九句均为「…吗？」类：可达前缀停在句末语气词，该位 **全部长度 1..5 被 `sentence_boundary` / `punctuation_in_window` / `raw_gap` 阻断**。

### 8.3 合法性复核（逐例原则）

`lattice-hard-block-filter.ts`：

```text
hasSentenceBoundary:
  - slice 内含 。！？  → block
  - rawStart-1 为句界 → block（句后第一字）
  - rawEnd 处为句界   → block（句末一字，因 rawEnd 排他指向标点）
```

对「吗？」：length-1 窗 rawEnd 恰指向 `？` → **length-1 也被 block**。  
即使词库有「吗」，该位仍无法形成 lexical edge → **硬阻断了本可连接的合法短 Edge**。

这 **符合当前代码规则**，但与「允许 length-1 lexical 填缝」的连通性目标冲突 → 属 **Hard-block 过严**，不是「名称看起来合理就放过」。

证据：[`lexical_edge_hard_block_cases.jsonl`](./_audit_scratch/lattice_v1_lexical_edge_quality/lexical_edge_hard_block_cases.jsonl)

---

## 9. Recall Execution Analysis

Phase1 harness diagnostics（与既有 node-runtime 审计一致）：

```text
logicalWindowRecallCount === recallableWindowCount   ✓
真实 SQLite 查询已执行
incomplete gate 未截断
```

本轮 quality probe 不重报全量 physicalSql；既有 Phase2 node-runtime：`physicalSql≈34255`，candidates≈2692，edges≈1610。

空结果主因：

1. 词条不存在（单字全无；部分双字连接词缺失）
2. 命中后 `priorScore < minPrior` 被丢（稀有，16 条 prior&lt;0.5，含「麻烦」）
3. Hard-block 后根本不进 Recall

**未发现**「错误缓存空结果导致后续同 key 永不查询」的系统性证据（cacheHit 存在但与 empty 主因无关）。

---

## 10. NO_LEXICON_HIT Analysis

证据：[`lexical_edge_no_hit_cases.jsonl`](./_audit_scratch/lattice_v1_lexical_edge_quality/lexical_edge_no_hit_cases.jsonl)

### 10.1 SQLite 反查结论

| 检查 | 结果 |
|------|------|
| `term` 中 `length(word)=1` | **0** |
| `base_lexicon` 高频单字（我/能/的/请/问） | **0** |
| 「你好」「拿铁」「美式」「带走」「蓝莓」「马芬」 | 存在且 prior≥0.85 |
| 「谢谢」「我想」「请问」 | **不存在** |
| 「麻烦」 | 存在，prior=**0.35**，source=`*_homophone_variant` → 被 minPrior 滤掉 |

### 10.2 Top 缺失表面（breakpoint / no-hit 聚合）

| surface | count | sentences | inTerm | inBase | 建议处理（仅建议） |
|---------|------:|----------:|-------:|-------:|-------------------|
| 我 | 32 | 30 | 0 | 0 | 评估 base 单字/功能词白名单 |
| 能 | 32 | 32 | 0 | 0 | 同上 |
| 请 | 25 | 25 | 0 | 0 | 同上 |
| 的 | 25 | 23 | 0 | 0 | 同上 |
| 点 | 22 | 22 | 0 | 0 | 同上 |
| 这 | 22 | 22 | 0 | 0 | 同上 |
| 要 | 20 | 20 | 0 | 0 | 同上 |
| … | … | … | 0 | 0 | 见 summary.topMissingSurfaces |

### 10.3 分类（对 NO_LEXICON_HIT）

| 类 | 说明 | 规模判断 |
|----|------|----------|
| **B. 单字缺失** | operational 词库结构上无 len=1 | **主因** |
| **C. 2–3 字常用词缺失** | 谢谢/我想/请问等 | 显著 |
| **E/F. 拼音/tone** | 非本轮主因（未见系统错 key） | 次要 |
| **G. domain 过滤** | 非 first-breakpoint 主因 | 次要 |
| **Candidate minPrior** | 「麻烦」等 16 条 | 稀有但可证（见 §11） |
| **A. 不应入库** | 标点/拉丁等 | 由 hard-block 处理，不是 NO_HIT 主因 |

**必须区分**：词条根本不存在（我/的） vs 词条存在但 Recall/门控没放出（麻烦）。

---

## 11. Candidate-to-Edge Drop Analysis

| 指标 | 值 |
|------|---|
| candidateProducedButNoEdgeCount | **0** |
| 涉及 sentence | 0 |

结论：**Edge Builder 没有把「有候选」错误变成「无边」。**  
「有窗无边」= Recall 后 candidates.length=0（词库空 / minPrior），不是 build 阶段丢弃。

证据文件：[`lexical_edge_candidate_drop_cases.jsonl`](./_audit_scratch/lattice_v1_lexical_edge_quality/lexical_edge_candidate_drop_cases.jsonl)（空 = 无 drop 案例）

稀有门控示例（d002「麻烦」）：

```text
Window 0:2 raw=麻烦  blocked=false
term 存在 prior=0.35 < minPrior=0.5 → candidates=[] → 无 Edge
firstBreakpoint=0 RECALL_ZERO_HIT
```

Owner：**Candidate Filter / Recall pre-filter**（不是 Edge Builder）。

---

## 12. Edge Merge / Identity Analysis

| 指标 | 值 |
|------|---|
| duplicateBoundaryInputCount | 0 |
| mergedBoundaryCount | 1610 |
| candidateLossDuringMerge | 0（无重复 boundary 输入） |
| edgeOverwriteCount | 0（本轮无证据） |

结论：merge/identity **非**连通性失败原因；空候选不会被误标为 lexical edge。

---

## 13. Graph Connectivity Analysis

| 指标 | 值 | 含义 |
|------|-----|------|
| positionLexiconHitRate | 32.5% | 词库命中稀疏 |
| positionLexicalEdgeRate | 32.5% | 与 hit 一致 |
| reachablePositionRate | 9.2% | 从 0 只能走很短前缀 |
| completePathRate | 0% | 无一句 lexical-only 贯通 |

典型结构：

```text
可达前缀短（常 0 或遇「你好/今天」后立刻断）
后面存在大量 orphan 双字边（领域词岛）
fallback 在断点后逐字填缝
```

orphan len2 = 1237 / dead-end len2 = 208（见 §17）。

证据：[`lexical_edge_dead_end_cases.jsonl`](./_audit_scratch/lattice_v1_lexical_edge_quality/lexical_edge_dead_end_cases.jsonl)、[`lexical_edge_first_breakpoints.jsonl`](./_audit_scratch/lattice_v1_lexical_edge_quality/lexical_edge_first_breakpoints.jsonl)

---

## 14. First Breakpoint Distribution

| breakpoint reason | sentence count | ratio | 典型 |
|-------------------|---------------:|------:|------|
| RECALL_ZERO_HIT | 191 | 95.5% | d001@2「我」；d002@0「麻」；d003@0「请」 |
| ALL_WINDOWS_BLOCKED | 9 | 4.5% | d017@6「吗？」类（dialog 重复模板） |
| NO_WINDOW / CANDIDATE_DROPPED / EDGE_DROPPED / … | 0 | 0% | — |

```text
zeroHitAt0 = 102 / 200
zeroHitAfterPrefix = 89 / 200
```

**每句第一个导致 lexical-only 失败的位置**已写入 first_breakpoints 专档；**不得**用 fallback 粗分类替代该字段。

---

## 15. Single-Syllable Edge Analysis

| 指标 | 值 |
|------|---|
| singleSyllableWindowCount | 4494 |
| singleSyllableRecallHitCount | **0** |
| singleSyllableLexicalEdgeCount | **0** |
| term length=1 in SQLite | **0** |

结论：

```text
不是「单字被 Edge Builder 丢掉」
不是「单字策略禁止生成 Window」
而是「operational lexicon 根本没有单字 term」
+ 句末句界 hard-block 即使有单字也无法召回
```

冻结架构允许 length 1..5 Window 与 length-1 fallback；**句法连接所需的 base 单字 / 功能词若预期由词库承担，当前 bundle 未交付该能力**。  
**不建议**「把所有汉字塞进单字库」——应做 **有界 base 功能词 / 高频单字白名单**（后续 NEW 词库 patch，本轮不实施）。

---

## 16. Lexicon Hit vs Connectivity Coverage

| 指标 | 值 |
|------|---|
| positionLexiconHitRate | 32.5% |
| completePathRate | 0% |

解释：

```text
Hit rate 本身已经偏低 → 主因在 Lexicon / Recall 产出
同时 reachableRate 9.2% << hit rate 32.5%
  → 即便局部有边，也因缺少 length-1 填缝而无法从 0 串到 N
  → 次级问题是边界组合 / 连通性
```

**不得**只用 Candidate 总数判断覆盖质量。

---

## 17. Edge Length Distribution

| length | Edge 数 | dead-end | orphan |
|-------:|--------:|---------:|-------:|
| 1 | **0** | 0 | 0 |
| 2 | 1445 | 208 | 1237 |
| 3 | 126 | 5 | 121 |
| 4 | 39 | 0 | 39 |
| 5 | 0 | 0 | 0 |

回答审计问题：

```text
是：LexicalEdge 过度集中在 2（及少量 3–4）字
缺少连接缝隙所需的 1 字 Edge → 完整路径结构性不可能

长跳边：4 字边几乎全是 orphan（39/39），说明领域长词落在不可达岛上，
放大了「有边但连不成路径」的观感，但不是 first-breakpoint 主因。
```

---

## 18. Base vs Domain Edge Coverage

| 类 | Edge 数（约） |
|----|-------------:|
| baseEdgeCount | 1222 |
| domainEdgeCount | 476 |
| multiDomainEdgeCount | 129 |

观察：

```text
并非「只有 domain、没有 base」——base 边仍占多数
但 base 边同样以双字为主，缺少承担句法连接的单字 base
domain 长词更多表现为 orphan 岛，不负责连通
```

**不改变 Domain Vote 规则**；问题在词库结构覆盖，不在 Vote。

---

## 19. UNKNOWN Reclassification

原始 coarse fallback UNKNOWN ≈ 98 条 → **全部重分类，unresolved=0**。

| reclass | count |
|---------|------:|
| ORPHAN_LEXICAL_EDGE | 94 |
| DEAD_END_LEXICAL_BRANCH | 4 |

含义：这些位置并非「分类器不知道」，而是 **存在 outgoing lexical edge，但其 start 从 0 不可达（orphan），或 end 无法到 N（dead-end）**，最小成本路径仍选 length-1 fallback。

证据：[`lexical_edge_unknown_reclassified.jsonl`](./_audit_scratch/lattice_v1_lexical_edge_quality/lexical_edge_unknown_reclassified.jsonl)

```text
UNKNOWN → 0（有证据闭环）
```

---

## 20. Representative Case Replays

### 20.1 NO_LEXICON_HIT — d001

```text
你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
N=27

Lexical: 0-2(你好) 5-7 7-10/7-9 8-10 10-12(拿铁) 16-19… 19-21 21-23…24-26(马芬类)
Fallback: 2-3 3-4 4-5 12-13 13-14 14-15 15-16 26-27

0 ──2 × 3 4 5 ── …
        ↑
firstBreakpoint=2 「我」 RECALL_ZERO_HIT
reachablePrefixEnd=2
「我」「想」「点」SQLite 均无 term
```

### 20.2 NO_LEXICON_HIT + minPrior — d002

```text
麻烦帮我做一杯美式带走，大杯就行，谢谢。
N=17

Window 0:2「麻烦」recallable 但 candidates=[]（prior 0.35 < 0.5）
Lexical islands: 5-7 7-9(美式) 9-11(带走) 11-13(大杯)
Fallback: 0-1…4-5 与尾部「就行谢谢」

0 ×── …
↑ firstBreakpoint=0 「麻」 RECALL_ZERO_HIT
（词条存在但被 Candidate Filter 杀掉 + 无单字填缝）
```

### 20.3 HARD_BLOCKED — d017

```text
晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
firstBreakpoint=6 「吗」 ALL_WINDOWS_BLOCKED
blockedReasons: sentence_boundary + punctuation_in_window
length-1 亦被 block → 即使有「吗」也无法 lexical 覆盖
```

### 20.4 Edge 存在但不可连接 / UNKNOWN→ORPHAN

见 `lexical_edge_unknown_reclassified.jsonl`（例：d004@27「把」有 27-29 边但 start 不可达）。

### 20.5 High fallback

d053/d143 fb=20；d008/d098 fb=19；均伴随极短可达前缀 + 大段 NO_HIT。

### 20.6 Multi-path（含 fallback）

28 句 `retainedPaths>1`，但是 **fallback-assisted multi-path**，不是 lexical-only multi-path。

---

## 21. Quality Gate Proposal（建议，不冻结）

| 门槛 | 建议值 | 为何合理 | 归属 |
|------|--------|----------|------|
| lexical-only complete path rate | ≥ **30%** 作为 Phase 2 Acceptance 讨论下限；目标 **≥60%** 再谈 Phase 3 输入 | 现 0% 无法证明 Lattice 边图可用 | Phase 2 Acceptance |
| avg fallback / sentence | ≤ **4**（现 10.21） | fallback 应是缝隙而非主路径 | Phase 2 Acc. |
| p95 fallback / sentence | ≤ **8**（现 17） | 控制尾部灾难句 | Phase 2 Acc. |
| position lexical-edge coverage | ≥ **70%**（现 32.5%） | 低于此则路径枚举无意义 | Phase 2 Acc. / 词库门槛 |
| first-breakpoint NO_LEXICON_HIT rate | ≤ **40%**（现 95.5%） | 否则主因仍在词库 | 词库先行 |
| UNKNOWN count | **0**（已达成重分类） | 诊断完备性 | Phase 2 Acc. |
| multi-path utterance rate | 观察项；须报告 **lexical-only multi-path** 分母 | 现 28 含 fallback，不能当质量证明 | Phase 2 Acc. 指标修正 |
| singleSyllableLexicalEdgeCount | **>0 且覆盖功能词白名单命中率 ≥X** | 否则连通性结构性失败 | **词库 patch 前置门槛**（偏 Phase 2 输入，而非改 Path 代码） |

```text
不得为通过而以当前 0% 反向定义宽松门槛。
扩词库（有界单字 + 连接双字 + 修正「麻烦」prior/source）应先于 Phase 2 Acceptance。
Hard-block 邻接句界修复可作为并行小项，否则句末语气词永不可 lexical。
```

---

## 22. Root Cause Ownership

| Root Cause | Owner | Affected Files | Architecture Impact | Recommended Action | Need Contract Change? | Priority |
|------------|-------|----------------|---------------------|--------------------|----------------------|----------|
| 无单字 term + 高频连接字缺失 | **Lexicon** | `node_runtime/lexicon/v3/*` | 边图无法填缝 | 有界 base 单字/功能词 + 常用连接双字 patch；反查验收 | 否（数据） | **P0** |
| 「谢谢/我想/请问」等双字缺失 | **Lexicon** | 同上 | first breakpoint 前移 | 补常用连接词 | 否 | **P0** |
| 「麻烦」等合法词 prior=0.35 被滤 | **Candidate Filter**（Recall pre-filter）/ Lexicon 数据 | `recall-topk-for-windows.ts`；term.source/prior | 有词无边 | 修正 canonical prior；或审 minPrior 对 base 例外（需变更记录若改阈值） | 改阈值则 **是**；改数据则否 | **P1** |
| 句界邻接阻断 length-1 | **Hard-block** | `lattice-hard-block-filter.ts` | 句末字永不可 lexical | 复审 `rawEnd` 邻接句界是否应对 length-1 放行 | 可能（若改冻结 hard-block 语义） | **P1** |
| orphan/dead-end 长边 | **Lexicon** + 连通性后果 | — | 观感「有边无路」 | 先修覆盖；不改 Path | 否 | P2 |
| Window 未覆盖 | Coordinate/Window | — | — | **KEEP**（本轮 0 缺口） | 否 | — |
| Edge Builder 丢边 | Edge Builder | `build-lexical-edges.ts` | — | **KEEP** | 否 | — |
| Path/Fallback 算法 | Path Enumerator | — | — | **KEEP**（本轮不改） | 否 | — |
| dialog_200 输入特性 | Test Data | cases | 餐饮/口语连接字密集 | 保留；用其压测覆盖 | 否 | — |

**主责唯一确定：Lexicon Coverage（含单字结构空洞）。** Hard-block / minPrior 为次责，不得并列「无主责」。

---

## 23. KEEP

```text
buildLexicalWindowQueries（1..5 全覆盖）
phase1-window-edge-harness incompleteness gate
buildLexicalEdges（有候选才建边；本轮无错误 drop）
enumerateCompleteSegmentationPaths / injectFallbackEdges（行为符合 Contract；不作为质量免责）
Domain Vote 公式
Production orchestrator 暂不 cutover（Change Record 1.0.1）
```

---

## 24. MODIFY（仅未来建议，本轮不执行）

```text
node_runtime/lexicon/v3 — 有界单字 + 连接词 + canonical prior 修正
lattice-hard-block-filter.ts — 复审句界邻接对 length-1
recall minPrior 策略或词条 prior 标注（二选一，避免双主责）
Phase 2 Acceptance 指标 — 强制 lexical-only complete path rate，禁止 fallback 伪装
诊断 — firstBreakpoint / orphan / dead-end 常驻 trace 字段
```

---

## 25. RESTORE

```text
无「实现偏离冻结主链」需整模块回滚。
需恢复/澄清的是数据与硬阻断细节：
  - 若架构期望 length-1 lexical 可填缝，则 operational lexicon 应具备对应条目（数据恢复/补齐）
  - 若 hard-block 本意不是永久禁止句末字 lexical，则应恢复「仅阻断跨越句界的窗，而非句末 length-1」
```

---

## 26. DELETE（建议，不执行）

```text
无重复 Edge Builder 过滤链需删。
建议删除/停止使用：以「fallbackReason=UNKNOWN」作为终态标签的粗分类（已用 reachability 重分类替代）
```

---

## 27. NEW（仅允许后续：测试 / 诊断 / 词库 patch）

```text
NEW 测试：lexical-only complete path rate 门槛测试（dialog_200）
NEW 诊断：firstBreakpoint reason 写入 Phase2 harness diagnostics
NEW 词库 patch：base 功能词/高频单字白名单 + 连接双字 + 「麻烦」canonical prior
禁止：新业务中间层、新决策模型、新 Path prune 启发式
```

---

## 28. Target List

```text
[x] 逐位置 Coverage Matrix
[x] First Breakpoint 分析
[x] NO_LEXICON_HIT 反查 SQLite
[x] HARD_BLOCK 合法性复核
[x] Candidate → Edge drop 分析
[x] Edge merge / identity 分析
[x] Graph reachability 分析
[x] 单字 Edge 覆盖
[x] Edge 长度分布
[x] Base / Domain Edge 分布
[x] UNKNOWN 归零
[x] 典型案例回放
[x] 质量门槛建议
[x] Owner 归属
```

---

## 29. Check List

```text
[x] 未修改业务代码
[x] 未修改词库
[x] 未修改 Contract
[x] 未进入 Phase 3
[x] 未调整 fallback
[x] 未调整 Path prune
[x] 未将所有问题归因于词库（同时证明 hard-block / minPrior / 连通性）
[x] 每个 fallback 有位置级证据（matrix + breakpoints）
[x] 每句有 first breakpoint
[x] UNKNOWN 已归零或有证据说明
[x] 真实 SQLite 已反查
[x] Phase 1 冻结语义未被重新解释
```

---

## 30. Final Recommendation

```text
LEXICAL EDGE QUALITY: NOT ACCEPTABLE
PHASE 2 ACCEPTANCE BLOCKED

Primary repair track:
  LEXICON COVERAGE REPAIR
    - 有界单字 / 功能词
    - 常用连接双字
    - 修正「麻烦」等被标成低 prior homophone_variant 的 canonical 词

Parallel secondary:
  WINDOW / HARD-BLOCK REPAIR（句末 length-1 邻接句界）
  CANDIDATE FILTER / prior 数据修复（minPrior 误杀）

Do NOT:
  - 用 fallback 完成率宣称 Phase 2 Acceptance
  - 改 Path Enumerator / Vote / Orchestrator 来「绕过」无边问题
  - 无门槛地全汉字单字入库
```

下一步（建议顺序，非本轮执行）：

1. 词库 patch + 单字/连接词反查验收  
2. 重跑本 probe，观察 `completePathRate` / `singleSyllableLexicalEdgeCount` / first-breakpoint 分布  
3. 再开 Phase 2 Acceptance；通过后方可进入 Phase 3 输入讨论  

---

## Appendix — Evidence Files

| File | Role |
|------|------|
| `lexical_edge_quality_summary.json` | 总表 |
| `lexical_edge_position_matrix.jsonl` | 逐位置矩阵 |
| `lexical_edge_first_breakpoints.jsonl` | 每句 first breakpoint |
| `lexical_edge_no_hit_cases.jsonl` | NO_HIT + SQLite 反查 |
| `lexical_edge_hard_block_cases.jsonl` | 仅 blocked 窗位 |
| `lexical_edge_candidate_drop_cases.jsonl` | 有候选无边（本轮空） |
| `lexical_edge_dead_end_cases.jsonl` | dead-end 边 |
| `lexical_edge_unknown_reclassified.jsonl` | UNKNOWN→ORPHAN/DEAD_END |
