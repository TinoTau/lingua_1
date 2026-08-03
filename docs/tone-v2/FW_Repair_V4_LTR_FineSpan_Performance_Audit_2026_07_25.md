> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4 — LTR FineSpan Sliding Window Performance Audit

| Field | Value |
|---|---|
| Date | 2026-07-25 |
| Type | Performance Audit + Offline Measurement |
| Scope | Complexity / Latency / Duplicate Work / Runtime Cost |
| Code SSOT | `electron_node/electron-node/main/src/fw-detector/**`, `lexicon-v2/**` |
| Probe | `docs/tone-v2/dialog200_ltr_performance_probe.json` |
| EXPLAIN | `docs/tone-v2/_audit_scratch/sqlite_explain_plans.json` |

---

## 1. Executive Summary

LTR FineSpan **算法结构是 O(n) 量级的单向 cursor + 每步常数个 option**，不是旧全句重叠滑窗。生产路径上主要成本在 **每 recallable window 的词库 SQL（exact + 无条件 parent_fragment）**，其次是句组合 late-cap 与（有 Tone 时）切片全量 filter。

```text
Sliding Window Algorithm: APPROPRIATELY SIMPLE
Runtime Cost:             ACCEPTABLE   （offline GT+lexicon；WAV/ASR/Tone 全链未跑通）
Primary Bottleneck:       LEXICON SQL
Final Verdict:            LTR FineSpan Performance
                          PASS WITH OPTIMIZATION ITEMS
```

**dialog_200 WAV+ASR Groups A/B/C：`RUNTIME INCOMPLETE`**（`:5020`/`:6007` 未就绪）。  
本轮用 Electron ABI 对 **200 条 GT 文本 + 真实词库/IME + 真实 LTR 生产编排器**做了 offline assembly 测量（无 WAV、无 acoustic tone、无 KenLM），不得冒充全链路 P95。

---

## 2. Scope and Non-Goals

**只审计：** 复杂度、延迟、重复计算、性能上限。  

**明确不讨论：** 长短词偏好、Beam/DP/回溯、Detector、Vote/Assembly/KenLM 语义改动、新链路。  

**KEEP（非缺陷）：** 短词优先、`shorter_exact_tiebreak`、机场+高速 / 皇后镇+机场 / 预订+酒店 拆分。

---

## 3. Production Call Graph

| 层 | 文件 | 函数 | 单句次数 | 输入规模 | 循环 | 扫描 | IO | 缓存 | 最坏复杂度 | 常数开销 | 生产可达 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Step | `fw-detector-step.ts` | `runFwDetectorStep` | 1 | job | — | — | — | — | O(1)+下游 | — | YES |
| Orch | `fw-detector-orchestrator.ts` | `runFwDetectorOrchestrator` | 1 | rawText | — | — | — | — | O(1)+下游 | recall scope | YES |
| V4 | `fw-detector-v4-path.ts` | `runFwDetectorV4Path` | 1 | ctx | — | — | KenLM 可选 | — | O(p) KenLM | — | YES |
| Assembly | `span-assembly-v4-orchestrator.ts` | `runSpanAssemblyV4Orchestrator` | 1 | n | — | — | — | — | Σ下游 | `Date.now` assemblyMs | YES |
| Coarse | `coarse-boundary-import.ts` | `buildCoarseSpansFromRawImeBoundary` | 1 | n,c | IME topK | 句内 | — | — | O(n·IME) | IME decode | YES |
| LTR | `ltr-fine-span-generator.ts` | `runLtrFineSpanGeneration` | 1 | n | while cursor | 局部 | — | — | **O(n)** 步 | 每步 ≤4 options | YES |
| Options | same | `generateLocalOptionsAtCursor` | **s ≈ O(n)** | n,c | len 2..5 | coarse O(ℓ·c) | — | — | O(s·c) | `buildCharSyllableRanges` **每 cursor 重建** | YES |
| Block | `blocked-window-filter.ts` | `blockedFilter` | **s**（每 cursor 一批） | w_step,e | map | e per window | — | — | O(r_step·e) | gap/punct | YES |
| Recall | `recall-topk-for-windows.ts` | `recallTopKForWindows` | 1 聚合 / **r** 窗循环 | r,m,e | for windows | tone O(e+m)/窗 | SQLite | LRU 512 | **O(r)·SQL** | budget 按窗计 | YES |
| V3 | `recall-span-topkv3.ts` | `recallSpanTopKV3` | **r** | ℓ≤5 | V2+ngram | 索引查 | SQLite | LRU | 每窗多语句 | parent **无短路** | YES |
| Commit | `ltr-fine-span-generator.ts` | `commitBestFormalFineSpan` | **s** | ≤5 opts | sort | — | — | — | O(1) | 强制 1-syl fallback | YES |
| Tone rebind | `tone-commit-rebind.ts` | `rebindToneAfterFormalCommit` | **s** | m,e | — | O(e+m) | — | **无** | O(s·(e+m)) | 与 recall 可重复 | YES |
| Compat | `candidate-compatibility-graph.ts` | `resolveCompatibilityRelations` | 1+ | k | 双层 for | 全候选对 | — | — | **O(k²)**～**O(k³)** | graph 可能建 2 次 | YES |
| Vote | `utterance-domain-vote.ts` | `voteUtteranceDomainFromPool` | 1 | s,k | pool | domains | — | — | O(s·k·d) | — | YES |
| Sentence | `build-sentence-candidates.ts` | `buildSentenceCandidates` | buckets | s,k | 子集递推 | — | — | — | ≤1024 nodes；**后截断 16** | LATE CAP | YES |
| KenLM | `run-fw-sentence-rerank-from-prefilled.ts` | … | 1 | **p≤16** | — | — | 子进程/本地 | — | O(p) | 本轮不优化 | YES |
| Old windows | `generate-global-windows.ts` | `generateGlobalWindows` | 0 | — | — | — | — | — | O(n·4) | — | **NO** |

符号：`n` 音节；`c` coarse；`w` raw temporary options（LTR steps 中 option 计数）；`r` recallable windows（≈ `ngramQueryCount`）；`s` Formal FineSpan；`k` 活跃候选；`q` budget 计数；`m` tone slices；`e` wordTimeSpans；`p` sentence candidates。

---

## 4. Complexity Model

| 量 | 平均（offline 197 ok） | 最坏配置/代码上限 | dialog_200 offline 实测 |
|---|---|---|---|
| n | 22.5 | 句长 | max 38 |
| w (`globalWindowGeneratedCount`) | 57.5 | ≈ 4·s + fallbacks | max 99 |
| r (`ngramQueryCount`) | 29.5 | **≤150** | max 58 |
| s (fwSpans) | 12.5 | ≈ n（全 1-syl） | max 21 |
| k | 8.9 | s·perSpanLimit | max 20 |
| p | 5.4 | **≤16** | max 16 |
| interval 枚举 | 107 | **≤1024 nodes** | max 726 |
| SQL budget 耗尽 | — | 150 windows | **0 / 197** |

表面窗口生成：**Θ(n)**。  
真实主导项：**Θ(r × SQL_per_window)**，SQL_per_window ≫ 1（见 §10）。

---

## 5. LTR Window Generation

源码：`ltr-fine-span-generator.ts`。

| # | 问题 | 答案 |
|---|---|---|
| 1 | cursor 最少前进 | **≥1 音节**（fallback 保证） |
| 2 | 停留/重复？ | **否**（`assertCommitInvariants`） |
| 3 | 每 cursor 最多 option | **4**（2..5）+ commit 时 **1** fallback |
| 4 | 固定 2..5 + fallback？ | **是** |
| 5 | 全句重扫？ | **否**（仅 cursor 锚定） |
| 6 | 每 cursor 扫全部 Coarse？ | **是**（每 option `collectDistinctCoarseSpanIds`） |
| 7 | spanIds | 音节 ∈ coarse 范围则加入 Set |
| 8 | cross count | `spanIds.length - 1` |
| 9 | raw char range | `syllableRangeToRawCharRange(ranges,…)`；`ranges` **每 cursor** `buildCharSyllableRanges(rawText)` |
| 10 | 嵌套 find/filter | `resolveAnchorCoarseSpanId` 内 `find`；blockedFilter 内 filter |
| 11 | 重复构造 | 每 cursor 重建 ranges；fallback 再重建一次 |
| 12 | 重复序列化 trace | `steps` **始终** push；关 diagnostics 仍构建 |

**窗口生成真实复杂度：**

```text
O(n) cursor steps × O(1) options × O(c) coarse lookup
= O(n · c)
（c ≪ n 时近似 O(n)；非 O(n²) 全滑窗）
```

额外常数：`buildCharSyllableRanges` × O(s) → **DUPLICATE_WORK**（可预计算一次）。

---

## 6. CoarseSpan Lookup Cost

| 项 | 内容 |
|---|---|
| 当前方式 | 每窗对每个音节扫描全部 `coarseSpans` |
| 调用次数 | ≈ w_raw（含 blocked）+ fallback |
| 最坏成本 | O(w · ℓ · c) ≤ O(n · 5 · c) |
| 是否值得优化 | **低优先级**（c 通常 <20）；预计算 `syllable→coarseId` 可降到 O(w·ℓ) |

分类：**NO MATERIAL RISK**（当前句长）；长会议句可 **OBSERVE**。

---

## 7. Early Filtering

真实顺序（生产）：

```text
buildWindowAt（含 cross>1 → blocked）
→ generateLocalOptionsAtCursor
→ filter !blocked（跨界>1 不到 recall）
→ blockedFilter（punct/gap/non-CJK/asr_gap…）
→ filter !blocked
→ tone extract（仅未 blocked）
→ recallSpanTopKV3 / SQL
→ commit
→（全句后）rebindToneAfterFormalCommit
```

| 昂贵操作 | blocked 前？ | 判定 |
|---|---|---|
| 拼音（slice 全句音节） | 生成时 join；**非**重新汉字转拼音 | OK |
| Tone extract | **blocked 之后** | OK |
| SQL | **blocked 之后** | OK |
| candidate scoring | blocked 后 | OK |
| diagnostics payload | TraceCollector 仅 traceActive | 部分 OK |
| `buildCharSyllableRanges` | 每 cursor，含即将 blocked 的 option | **WASTED WORK（轻）** |
| `collectDistinctCoarseSpanIds` | blocked 窗仍算 | **WASTED WORK（轻）** |

`metrics.blockedWindowCount` 在 orchestrator **硬编码 0** → 无法从 metrics 统计 blocked 浪费（观测缺口）。

---

## 8. Pinyin Cost

| # | 问题 | 答案 |
|---|---|---|
| 1 | slice 预计算 syllables？ | **是**（`textToPinyinStream` 一次） |
| 2 | 每窗汉字转拼音？ | **否** |
| 3 | 重复 normalize？ | 主要在词库侧；窗侧 `join('|')` |
| 4 | 多等价 key？ | plain / tone_pinyin / ngram 分 key |
| 5–6 | exact / tone / fragment | V2 tone→plain；V3 ngram 另查 |
| 7–10 | utterance cache？ | **无**窗级拼音 cache；词库 LRU **跨 job 共享**（只读） |

分类：**NO MATERIAL RISK**（拼音本身）。

---

## 9. Tone Cost

| # | 问题 | 答案 |
|---|---|---|
| 1–4 | 每窗扫全部 m/e？ | **是** `filter` 全量 → **O(r·(e+m))** |
| 5–7 | 同 range 重复 / rebind | Recall 与 Formal rebind **可重复全扫**；**无 range cache** |
| 8 | tone 缺失仍扫？ | 无 time range 则早退；仍可能扫 e |
| 9 | blocked 仍提取？ | **否** |
| 10 | diagnostics 大数组 | exampleToneWindows 最多 8 |

本轮 offline：**acousticSlices 空 → tone 路径未执行**（`tonePatternMs=null`）。  
有 Tone 的 live 路径：归类 **TONE_SCAN**（常数可优化，非算法爆炸）。

---

## 10. Lexicon SQL Cost

### 10.1 每窗查询结构

`recallSpanTopKV3` = `recallSpanTopKV2`（tone-first）+ **无条件** `lookupParentFragments`。

典型（有域、tone on、需 plain fallback）：

| 类型 | 约计（cache miss） |
|---|---|
| tone exact base | 1 prepared |
| tone exact domain | 2（atomic id+rows，`prepare` 每次） |
| plain fallback base/domain | 同上 |
| ngram parent | 1 prepared |
| term_domain_tags | O(接受的 fragment) 动态 prepare |

**`q`（metrics `ngramQueryCount`）= recallable window 次数，≠ 真实 SQLite 语句数。**  
真实语句 / 窗 ≈ 数倍；**`q/r = 1`（按预算定义）**。

### 10.2 短路

- Tone exact 满 `exactTopK` → **跳过 plain**：**有**  
- Exact 够 → **跳过 parent_fragment**：**无** → **DUPLICATE_WORK / DATABASE_IO**

### 10.3 Budget

见 §12。

### 10.4 连接

- 单连接；base/idiom/ngram/tone **prepared 复用**  
- domain atomic / tags：**每次 `db.prepare`**  
- journal **WAL**；synchronous=1；主线程 **同步 better-sqlite3** → **EVENT_LOOP_BLOCKING**（短查询，索引命中）

### 10.5 重复查询

- LRU 512，key 含 pinyin/tone/domain/limit；**跨 utterance 可命中**  
- 无 utterance-level 去重；同句不同窗相同 key 依赖 LRU  
- offline 未测 `uniqueSqlQueryKeyCount` → probe 填 **null**

---

## 11. SQL Query Plan and Indexes

`EXPLAIN QUERY PLAN`（真实 sqlite，Electron ABI）：

| 查询 | Plan |
|---|---|
| base plain | `SEARCH base_lexicon USING INDEX idx_base_pinyin` |
| base tone | `SEARCH … idx_base_pinyin_tone` |
| domain tone | `SEARCH … idx_domain_pinyin_tone` |
| ngram | `SEARCH term_pinyin_ngrams USING INDEX idx_term_ngram_key` |

全部为 **INDEX SEARCH**，非全表 SCAN。ORDER BY 使用 TEMP B-TREE（LIMIT 小，可接受）。

---

## 12. SQL Budget

| # | 答案 |
|---|---|
| 1–3 | 每进入 `recallTopKForWindows` 循环的 **window +1**；不论 exact/parent/真实 SQL 条数 |
| 4 | cache hit **仍计** |
| 5 | `recall-topk-for-windows.ts` 循环头检查 / 尾部 +1 |
| 6 | 超限：`break`，剩余窗 `skippedRecallWindow`；不抛错；已 commit 的 Formal 保留 |
| 7 | 未见 off-by-one |
| 8 | **是**：前半句可耗尽 → 后半无召回（理论） |
| 9–10 | offline **0/197** 触达 150；固定 150，不随句长缩放 |

offline：`sqlQueryCount` P50=28, P95=50, Max=58 ≪ 150。

---

## 13. Formal FineSpan Downstream Cost

### 13.1 Candidate quota

`getPerSpanCandidateLimit(spanCount)`：1→8 / 2→6 / else→4。  
`spanCount = formalSpans.length`（含无词库命中后填的 canonical）。  
offline：`effectivePerSpanLimit` 几乎总是 **4**（s≥3）。

### 13.2 Compatibility — §14

### 13.3 Vote

Presence：O(s · candidates · domains)；offline `domainVoteMs`≈0。

### 13.4 Sentence — §15

---

## 14. Compatibility Graph

```text
for i in 0..k-1:
  for j in i+1..k-1:
    if overlap or adjacent: classify
```

- 比较次数：**C(k,2)**  
- coverage 修复循环可达 **O(d·k²)**  
- orchestrator：**先** `buildCandidateCompatibilityGraph` 取 edgeCount，**再** `resolveCompatibilityRelations`（内部再建）→ **重复构图**

offline：k≤20，edge≤71 → **当前无材料瓶颈**；结构属 **ALGORITHM_COMPLEXITY（有界）**。

---

## 15. Sentence Assembly Cap

```text
enumerateIntervalPaths（maxIntervalEnumNodes=1024）
→ 评分 / 文本去重
→ slice(0, maxSentenceCandidates=16)     ← 生成后截断
→ 多 bucket merge 再 slice(0,16)
```

| 证据 | 值 |
|---|---|
| `intervalAssemblyCandidateCount` max | **726** |
| `sentenceCandidateCount` max | **16** |
| KenLM 输入 | prefilled ≤16 |

**LATE CAP RISK：确认**（枚举可 ≫16，再截断）。有 1024 node 硬帽，非无界。  
**不是**把 Span 滑窗压力转成 KenLM 无限输入。

---

## 16. Diagnostics Overhead

| 模式 | 行为 |
|---|---|
| off | 默认；`createV4TraceCollector(false)→null` |
| summary | `diagActiveCandidates` 仍可能 map（`enabled`） |
| trace | 仅 `targetIds` 匹配时 `traceActive` |

**仍始终构建：** `ltr.trace.steps`（option 级对象）+ `reduce` 计数。  

WAV Groups A/B/C 对比：**未测**（RUNTIME INCOMPLETE）。  
设计上 Level-2 应用 `targetIds` 限制；**关 trace 不能省掉 LTR steps 分配** → **TRACE_OVERHEAD（轻）**。

---

## 17. Dialog200 Runtime Method

| 组 | 计划 | 结果 |
|---|---|---|
| A Diagnostics Off · WAV+ASR | 真 WAV / 真 ASR / 真 Tone | **RUNTIME INCOMPLETE**（Node `:5020` / ASR `:6007` down） |
| B Level-1 Summary · 200 | 同上 | **RUNTIME INCOMPLETE** |
| C Level-2 Trace · 5–10 | 同上 | **RUNTIME INCOMPLETE** |
| Offline assembly | GT 文本 + 真词库 + 真 IME + 真 LTR orchestrator | **已完成 197/200**（3 error） |

历史 `span-assembly-v4-dialog200-quality-perf.json`（2026-06-21）含旧 **global windows** 指标（avg_global_windows≈87），**不得**作当前 LTR 证据。

---

## 18. Runtime Statistics（Offline Probe）

来源：`dialog200_ltr_performance_probe.json` · `probeKind=offline_assembly_gt_text`。

| 指标 | Min | P50 | P90 | P95 | P99 | Max | Mean |
|---|---|---|---|---|---|---|---|
| totalMs / assemblyMs | 23 | 44 | 72 | 81 | 113 | **184** | 47 |
| sqlQueryCount (window attempts) | 11 | 28 | 49 | 50 | 58 | 58 | 30 |
| rawWindowCount | 36 | 54 | 79 | 91 | 99 | 99 | 57 |
| formalFineSpanCount | 8 | 12 | 17 | 19 | 21 | 21 | 12.5 |
| sentenceCandidateCount | 1 | 3 | 16 | 16 | 16 | 16 | 5.4 |
| intervalAssemblyCandidateCount | 2 | 32 | 312 | 327 | 726 | 726 | 107 |
| activeCandidateCount | 1 | 7 | 17 | 19 | 20 | 20 | 8.9 |
| compatibilityEdgeCount | 0 | 9 | 34 | 43 | 56 | 71 | 13 |

相关性（Pearson）：

| 对 | r |
|---|---|
| n vs totalMs | **0.77** |
| sqlQueryCount vs totalMs | **0.75** |
| formalFineSpanCount vs totalMs | **0.75** |
| activeCandidateCount vs totalMs | 0.53 |

说明：Max 184ms 为 **d001 首条冷启动**（同批后续同规模句 ≈40–80ms）。阶段细分计时多为 **null**（编排器仅暴露 `assemblyMs`/`domainVoteMs`）。

---

## 19. Tail Latency Cases（Offline）

| 类型 | Case | 要点 |
|---|---|---|
| max totalMs | **d001** | 183ms assembly；n=27；sql=31；冷启动嫌疑 |
| max sql | max=58 | ≪150 |
| max formal | max=21 | 仍 O(n) |
| max interval enum | **726** | LATE CAP 实证 |

WAV/Tone/KenLM 尾延迟：**未测**。

---

## 20. Duplicate Work Findings

| ID | 分类 | 文件/函数 | 触发 | 复杂度 | 实测 | 影响 | 证据 |
|---|---|---|---|---|---|---|---|
| D1 | DATABASE_IO | `recallSpanTopKV3` | 每窗 | exact 后仍 parent | offline sql≪150 | 多余 ngram SQL | 源码 L322–332 |
| D2 | DUPLICATE_WORK | `generateLocalOptionsAtCursor` | 每 cursor | O(s·n_char) | 含于 assembly | 重复建 ranges | L181 `buildCharSyllableRanges` |
| D3 | DUPLICATE_WORK | orchestrator compat | 每句 | 2× graph | k 小 | 双倍 C(k,2) | L245–246 |
| D4 | TONE_SCAN | recall + rebind | tone on | O((r+s)(e+m)) | offline 未测 | 重复 overlap | tone-commit-rebind |
| D5 | LATE_CAP | `buildSentenceCandidates` | 多候选 | 枚举→slice16 | interval max726 | CPU/分配 | L276–295 |
| D6 | TRACE_OVERHEAD | `runLtrFineSpanGeneration` | 总是 | O(w) 对象 | 恒有 | 小分配 | steps.push |
| D7 | DATABASE_IO | `maxSqlPerUtterance` | 长句 | 低估真实 SQL | 0 耗尽 | 保护偏松 | +1 per window |
| D8 | EARLY_FILTER_MISSING | — | — | — | — | **无**（SQL/Tone 在 blocked 后） | orchestrator 顺序 |
| D9 | DEAD_CODE_ONLY | `generateGlobalWindows` / `truncateWindows` | 测试 | — | — | 误接风险 | 生产无调用 |

---

## 21. KEEP / MODIFY / DELETE / OBSERVE ONLY

### KEEP

| 文件 | 函数 | 证据 | 预期收益 | 风险 |
|---|---|---|---|---|
| `ltr-fine-span-generator.ts` | LTR loop | O(n·c) 结构正确 | — | — |
| `blocked-window-filter.ts` | `blockedFilter` | 昂贵 IO 前过滤 | — | — |
| `lexicon-runtime-v2.ts` | prepared + indexes | EXPLAIN SEARCH | — | — |
| `v4-limits.ts` | sentence/SQL caps | p≤16；r≤150 | — | — |

### MODIFY（建议最小改，本轮不实施）

| 文件 | 函数 | 证据 | 预期收益 | 风险 |
|---|---|---|---|---|
| `recall-span-topkv3.ts` | parent 调用 | exact 满仍查 ngram | 降 r 次 SQL | 漏 fragment |
| `ltr-fine-span-generator.ts` | ranges 提升到 utterance | 每 cursor 重建 | 降分配 | 低 |
| `span-assembly-v4-orchestrator.ts` | compat 单次构图 | 双次 build | 降 O(k²) | 低 |
| `tone-*` | range cache | rebind 重复扫 | 降 O(m) | 需正确失效 |
| `recall-topk-for-windows.ts` | budget 计真实 SQL | 低估 | 保护后半句 | 阈值校准 |
| `build-sentence-candidates.ts` | 生成中提前 prune | late cap 726 | 降尾延迟 | 需保 16 多样性 |

### DELETE

| 文件 | 函数 | 证据 | 预期收益 | 风险 |
|---|---|---|---|---|
| `generate-global-windows.ts` | 生产路径 | 不可达 | 防复活 | 测需改 import |
| `truncateWindows` | LTR 未用 | 死代码 | 同左 | 低 |

### OBSERVE ONLY

| 文件 | 函数 | 证据 | 预期收益 | 风险 |
|---|---|---|---|---|
| `collectDistinctCoarseSpanIds` | O(ℓ·c) | c 小 | 预计算 | 低 |
| LTR `steps` 恒建 | TRACE | 轻 | lazy | 诊断完整性 |
| `blockedWindowCount=0` | metrics 失真 | 无法盯浪费 | 修计数 | 低 |
| live Tone/KenLM P95 | RUNTIME INCOMPLETE | — | 补 WAV 批 | — |

---

## 22. Risks

1. **Budget 按窗计** → 真实 SQL 数倍于 150 仍显示未耗尽；长句+多域+tone 时 event loop 阻塞被低估。  
2. **LATE CAP** interval 到数百再截断 → 偶发尾延迟。  
3. **无 Tone 测量** → 不能断言 live P95。  
4. **冷启动首句** 显著慢于稳态。  
5. 不得借性能审计改短词策略 / 恢复全滑窗 / 加 Beam。

---

## 23. Final Verdict

### Sliding Window Algorithm

```text
APPROPRIATELY SIMPLE
```

### Runtime Cost

```text
ACCEPTABLE
```

（offline assembly；全链 WAV 未知）

### Primary Bottleneck

```text
LEXICON SQL
```

### Final Verdict

```text
LTR FineSpan Performance
PASS WITH OPTIMIZATION ITEMS
```

依据：  
- 算法 O(n·c)，非 O(n²) 全滑窗；  
- offline 197 句 assembly P95≈81ms、SQL window 尝试 max58、句候选≤16、budget 未耗尽；  
- 存在可证重复工作（parent 无短路、ranges/compat 重复、late cap、budget 粒度、Tone 双扫设计）；  
- **不**因缺 WAV 全链而判 FAIL，但 **必须**标注 Groups A/B/C `RUNTIME INCOMPLETE`。

---

## 24. Minimal Next Development Boundary

1. **先补** dialog_200 WAV+ASR+Tone Groups A/B/C（真 Node），再谈是否动 SQL。  
2. 若 live 证实 SQL 主导：最小项 = parent_fragment 条件跳过 **或** utterance SQL key cache；禁止双链。  
3. 无证据前：**不要**重写 Span / 加 Beam / 恢复 global windows / 放大 KenLM。  
4. Diagnostics：Level-2 仅 `targetIds`；可选 lazy `ltr.trace`。

---

## Appendix A — Probe schema notes

`dialog200_ltr_performance_probe.json`：

- `probeKind`: `offline_assembly_gt_text`  
- `uniqueSqlQueryKeyCount` / 多数阶段 ms：`null`（未插桩）  
- `sqlQueryCount` = metrics `ngramQueryCount`（窗尝试）  
- `blockedWindowCount`：metrics 恒 0（编排器硬编码）  
- `runtimeDialog200WavAsr`: `RUNTIME INCOMPLETE`

## Appendix B — 计时边界

| 字段 | 边界 |
|---|---|
| `assemblyMs` | 整个 `runSpanAssemblyV4Orchestrator`（含 coarse+LTR+recall+compat+vote+sentence） |
| `domainVoteMs` | Vote 子段 |
| `kenlmMs` | offline **未跑** |
| 细分 ltr/blocked/tone/sql | **无法拆开**（无插桩；本轮不改业务逻辑） |

---

*End of performance audit.*
