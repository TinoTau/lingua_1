<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Utterance_Recall_Cache_Local_SQLite_Batch_Development_Plan_2026_07_25.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT

> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4 — Utterance Recall Cache + Local SQLite Batch Recall

## Development Plan and Pre-Implementation Design Audit

| Field | Value |
|---|---|
| Date | 2026-07-25 |
| Type | Pre-Implementation Design Audit（**不实施**） |
| Basis | Performance Audit 2026-07-25 + Fallback Root-Cause Probe |
| Probe | `docs/tone-v2/utterance_recall_cache_batch_design_probe.json` |
| Root-cause artifact | `docs/tone-v2/_audit_scratch/fallback_failure_rootcause.json` |

---

## 1. Executive Summary

性能优化方向（utterance cache → local batch → 暂不并发）在架构上可行，但被 **Phase 0 正确性阻断**挡住：

```text
d009 / d099 / d189
→ [LTR_FINE_SPAN] unable to build fallback option at cursor=…
```

根因不是 probe 假阳性，而是 **生产可达坐标 SSOT 分裂**：

```text
textToPinyinStream(全文)
  → pinyin-pro 把 "SOHO" 编成 s|o|h|o（计入 globalSyllables）

buildCharSyllableRanges / CoarseSpan
  → 只映射 CJK run，音节偏移与全局流错位

→ 末尾音节无 CoarseSpan 覆盖
→ collectDistinctCoarseSpanIds → []
→ buildWindowAt(len=1) → null
→ throw（整句后处理失败）
```

分类：

```text
BLOCKING CORRECTNESS BUG
```

### 裁决预告

| 项 | 裁决 |
|---|---|
| Fallback Correctness | **BLOCKING** |
| Utterance Cache | **READY**（需 Fact/Window 绑定合同） |
| Local SQLite Batch | **NEEDS SQL PROTOTYPE** |
| Development Recommendation | **PROCEED PHASE 0 + PHASE 1** |

Phase 2 设计写入本文件，但 **验收通过 Phase 0+1 且完成 batch SQL 原型后**再开工；禁止与 Phase 0 混 patch。

---

## 2. Current Production Call Graph

```text
runFwDetectorStep
→ runFwDetectorOrchestrator
→ runFwDetectorV4Path
→ runSpanAssemblyV4Orchestrator
   → partitionCoarseSpans / buildCoarseSpansFromRawImeBoundary
   → textToPinyinStream(rawText)          ← 全局音节（含 Latin）
   → runLtrFineSpanGeneration
      → generateLocalOptionsAtCursor     ← buildCharSyllableRanges（仅 CJK）
      → blockedFilter
      → recallTopKForWindows             ← 每窗一次
         → recallSpanTopKV3
            → recallSpanTopKV2
               → collectTierCandidatesToneFirst
                  → base / domain / idiom tone|plain lookups（SQLite）
            → lookupParentFragments      ← 无条件
               → ngram SQL + term_domain_tags
         → WindowCandidate[]（窗坐标绑定）
      → commitBestFormalFineSpan
   → compatibility / Vote / sentence ≤16 / KenLM
```

| 层 | 文件 | 函数 | SQLite | 语句数(估) | Global LRU | 可批量化 |
|---|---|---|---|---|---|---|
| LTR | `ltr-fine-span-generator.ts` | `runLtrFineSpanGeneration` | NO | 0 | — | N/A |
| Options | same | `generateLocalOptionsAtCursor` | NO | 0 | — | N/A |
| Block | `blocked-window-filter.ts` | `blockedFilter` | NO | 0 | — | N/A |
| Recall orch | `recall-topk-for-windows.ts` | `recallTopKForWindows` | via V3 | r 窗 | — | **YES（step 批）** |
| V3 | `recall-span-topkv3.ts` | `recallSpanTopKV3` | YES | ≥2/窗 | 间接 | YES |
| V2 | `recall-span-topk-v2.ts` | `recallSpanTopKV2` | YES | 1–6+/窗 | 间接 | YES |
| Tone tiers | `tone-first-tier-collector.ts` | `collectTierCandidatesToneFirst` | YES | tone±plain | YES | YES |
| Runtime | `lexicon-runtime-v2.ts` | `lookupBase*` / `lookupDomain*` / ngram | YES | 1–2/调用 | **YES 512** | **YES（底层）** |
| Parent | same + V3 | `lookupParentFragments*` | YES | 1+tags | 部分 | YES |
| Bind | `recall-topk-for-windows.ts` | hit→`WindowCandidate` | NO | 0 | — | 必须在 cache 外 |

Global LRU：`LruBucketCache` size 512，key 形如 `` `${tier}:plain:${key}:${termLength}:${limit}` ``（tone 路径把 composite 前缀塞进 tier，形成 `base:tone:…:plain:…`）。**跨 Job 共享只读结果**。主线程同步 better-sqlite3；**非线程安全多连接**（当前单线程假设）。

---

## 3. Audit Evidence

| 证据 | 来源 |
|---|---|
| Primary bottleneck = LEXICON SQL | Performance Audit 2026-07-25 |
| offline 197/200；3 fail | `dialog200_ltr_performance_probe.json` |
| EXPLAIN 均 INDEX SEARCH | `sqlite_explain_plans.json` |
| SQLite 3.49.2 支持 `ROW_NUMBER() OVER (PARTITION BY …)` | Electron ABI 实测 |
| Fallback 根因 | `fallback_failure_rootcause.json`（本轮） |

---

## 4. Phase 0 Fallback Failure Root Cause

### 4.1 三个 case

| caseId | 原文 | failCursor | syllableAtCursor |
|---|---|---|---|
| d009 | `去望京SOHO，不走四环可以吗？那边现在堵不堵？` | 18 | `du`（语义上是「堵」，坐标已漂） |
| d099 | `去望京SOHO，不走机场高速可以吗？那边现在堵不堵？` | 20 | `du` |
| d189 | 与 d009 **同文** | 18 | `du` |

### 4.2 坐标不一致（d009）

**`textToPinyinStream` 音节（21）：**

```text
qu wang jing | s o h o | bu zou si huan ke yi ma | na bian xian zai du bu du
0..2         | 3..6    | 7..13                   | 14..20
```

**`buildCharSyllableRanges`（仅 CJK，偏移未计入 Latin）：**

```text
去望京     → syl [0,3)   chars [0,3)
不走四环可以吗 → syl [3,10)  chars [8,15)   ← 与全局流错位
那边现在堵不堵 → syl [10,17) chars [16,23)
```

**CoarseSpan** 沿用上述错位区间，覆盖全局索引 `[0,17)`，**未覆盖 `[17,21)`**。

**SOHO 字符** `S,O,H,O`：`range=null`（无 CJK range）。

### 4.3 为何 2..5 与 fallback 均失败

对 `cursor=18`：

| len | `buildWindowAt` 失败原因 |
|---|---|
| 1–3 | `collectDistinctCoarseSpanIds` → **`spanIds=[]`**（无 coarse 覆盖） |
| 4–5 | beyond syllableCount |

`syllableRangeToRawCharRange` 在本探针路径上 **未先触发**（先被 spanIds 挡住）。即便绕过 spanIds，`coveringRangesAtCursor=[]` 也会导致 char range null。

### 4.4 根因分类

| 假设 | 结论 |
|---|---|
| 标点/空格单独 | 否（触发物是 **Latin 插入**） |
| 非 CJK | **是（间接）**：Latin 进入音节流但不进 ranges |
| surrogate | 否 |
| 拼音流 vs 字符流长度 | **是：SSOT 分裂** |
| Coarse coverage | **是：coverageOk=false 仍进入 LTR** |
| Probe-only | **否** |

```text
BLOCKING CORRECTNESS BUG
生产可达：凡 ASR/文本含 Latin 字母串（SOHO/USB/WiFi/OK…）与 CJK 混排即可触发
```

### 4.5 异常传播

```text
buildFallbackOption throw
→ runLtrFineSpanGeneration abort
→ runSpanAssemblyV4Orchestrator throw
→ runFwDetectorV4Path / orchestrator 失败
→ 整句 FW 后处理失败（非跳过 cursor / 非静默 raw）
```

### 4.6 最小修复（Phase 0）— 不改 LTR 语义

**推荐（单一坐标 SSOT）：**

```text
新建（或内聚）buildUtteranceSyllableCoordinate(rawText)
→ { syllables, ranges }
规则：仅从 CJK run 提取音节并顺序拼接
（与现 buildCharSyllableRanges 一致；Latin/标点不进入 syllable 坐标）
```

然后：

1. `textToPinyinStream` **改用同一规则**（或直接返回该 SSOT 的 syllables）；
2. Coarse / LTR **共用**同一 `ranges`；
3. Orchestrator：若 `coverageOk === false` → **fail-fast 明确错误**（不得 silent）；坐标修复后 coverage 应恢复 true；
4. 单测：d009/d099/d189 + 最小串 `去望京SOHO测试`；
5. **禁止** try/catch 跳过 cursor、空 span 吞错、恢复旧 global window。

语义影响：

```text
LTR 决策规则不变（2..5、短词优先、跨界≤1）
仅修正“什么叫一个音节坐标”
Latin 窗口本就会被 blockedFilter(non_cjk_syllable) 挡掉 → 不损失有效 CJK 召回语义
```

备选（不推荐为首选）：让 ranges 也为 Latin 分配音节并生成 coarse 覆盖 — 复杂度高，且 Latin 仍被 block，收益低。

---

## 5. Frozen Constraints

保持不变（摘录）：

```text
LTR 唯一 FineSpan 主链；Coarse soft；2..5 + 1 fallback；每步一 Formal
无 Beam/DP/回溯/旧 global window
短词优先 / shorter_exact_tiebreak
Vote ← Formal pool；Sentence/KenLM ≤16
Prior 不写 enabledDomains；Tone 不改正文
机场+高速 / 皇后镇+机场 / 预订+酒店 拆分 KEEP
无 Redis / 无 Worker / 无多连接 / 无第二 Recall 链
```

---

## 6. Target Architecture

```text
[Phase 0] 统一音节坐标 SSOT
    ↓
[Phase 1] UtteranceRecallContext.cache
    Lexicon Fact Result 去重（句内）
    Global LRU 仍为 DB 结果缓存（跨句）
    ↓
[Phase 2] 每 LTR cursor step：
    Temporary windows → blockedFilter
    → build requests → cache lookup
    → dedupe misses → local SQLite batch
    → fill cache → bindLexiconHitsToWindow
    → 现有 rank / commit
    ↓
[Not now] Worker / 多连接 / Redis
```

```text
Cache 在 Batch 之前；Batch 只处理 misses
正式生产最终只保留：坐标修复 + cache + batch（单一路径）
A/B/C 仅存在于 harness
```

---

## 7. RecallQueryKey Contract

### 7.1 设计原则

仅用于 utterance cache / batch 去重 / diagnostics。**不是**新业务 SSOT。

### 7.2 字段决策（基于真实代码）

| # | 问题 | 决定 |
|---|---|---|
| 1 | windowId 进 key？ | **否**（同查询跨窗共享 Fact） |
| 2 | rawText？ | **否** |
| 3 | windowText 影响 SQL？ | V2 用 syllables/key；windowText 主要用于 fuzzy align / score — **Fact key 用 pinyinKey(+tone)**，绑定阶段再用 window |
| 4 | tone 空 vs 缺失 | 规范化为 `tonePattern=""` 表示 plain；非 null 区分 tone 路径 |
| 5 | domainScope 顺序 | **必须 sort 再序列化** |
| 6 | `[]` vs undefined | 统一为 sorted `""` 空域串 |
| 7 | TopK | **进 key**（exactTopK / parentFragmentTopK 分 kind） |
| 8 | minPrior | **SQL 后过滤**（`recall-topk-for-windows`）→ **不进 Fact key**；绑定后再滤 |
| 9 | lexiconVersion | **建议进 key**（`manifestVersion`）防热更错共享 |
| 10 | Prior | **不进**（不改 SQL membership） |
| 11–12 | mutable | cache 存 **frozen LexiconFactHit[]**；bind 时 **深拷贝到 WindowCandidate** |

### 7.3 Canonical Key Serialization

```text
v1|{kind}|{pinyinKey}|{toneNorm}|{domainScopeCsv}|{topK}|{lexiconVersion}
```

示例：

```text
v1|exact_tone|na|tie|na2|tie3|coffee,tourism_hotel|2|lexicon_v3_five_table_v2
v1|exact_plain|na|tie||coffee,tourism_hotel|2|lexicon_v3_five_table_v2
v1|parent_fragment|na|tie||coffee,tourism_hotel|3|lexicon_v3_five_table_v2
```

规则：

- `kind ∈ {exact_tone, exact_plain, parent_fragment}`
- `toneNorm`：tone 路径为 tone_pinyin_key；plain 为空串
- `domainScopeCsv`：sorted join `,`
- **禁止** `JSON.stringify(object)` / `Map<object>` 作主 key

`RecallQueryKind` 与内部 tone→plain fallback 对齐：一次窗召回可产生 **多个** canonical query（tone + 可能的 plain + parent）。

---

## 8. Utterance Cache Design

### 8.1 生命周期

```text
创建：runSpanAssemblyV4Orchestrator 入口（或 LTR 外层 recallForWindows 闭包）
释放：orchestrator return / finally
```

不得写入 Job DTO / Scheduler / Web；不得与 Global LRU 合并职责。

### 8.2 注入点（推荐）

```text
优先：recallTopKForWindows（或其调用闭包持有 UtteranceRecallContext）
次选：recallSpanTopKV3 增加可选 ctx
禁止：污染 WindowCandidate / Vote / JobContract / LexiconRuntime 全局单例业务态
```

`LexiconRuntimeV2` Global LRU **KEEP**。

### 8.3 结构

```ts
type LexiconFactHit = {
  // 由现有 HotwordEntry + V2/V3 hit 字段投影，不含 window 坐标
  hotwordId: string;
  word: string;
  domains: readonly string[];
  hitKind: 'exact_term' | 'parent_fragment';
  candidateScore: number;
  // … parentTerm* / toneLookupStage / source 等事实字段
};

type UtteranceRecallContext = {
  cache: Map<string, readonly LexiconFactHit[]>; // key = canonical string
  stats: UtteranceRecallCacheStats;
  lexiconVersion: string;
};

// cache → bindLexiconHitsToWindow(window, hits) → WindowCandidate[]
```

### 8.4 错误缓存策略

| 情况 | 缓存？ |
|---|---|
| 合法空结果 `[]` | **是** |
| SQL throw | **否** |
| budget skip（未执行） | **否**（不算结果） |
| malformed key | **否** |

### 8.5 命中语义

```text
同 key → 同 Fact 列表（引用只读）
每窗 bind 时 new WindowCandidate（独立 windowId/raw/syl/tonePenalty）
```

---

## 9. Local Batch Boundary

```text
batchBoundary = one_ltr_cursor_step
logical windows ≤4（2..5 未 blocked）
不得整句预生成窗口 / 改变 commit 时序
```

流程：

```text
Temporary Windows
→ blockedFilter
→ build RecallRequest[]（多 kind/窗）
→ utterance cache lookup
→ dedupe missing keys
→ batch SQLite（仅 misses）
→ populate cache
→ map → bind per windowId
→ existing ranking
→ commitBestFormalFineSpan
```

---

## 10. SQLite Batch SQL Design

### 10.1 方案比较

| | 方案 A：V3 总入口批量化 | 方案 B：Runtime 底层 SQL 批量化 |
|---|---|---|
| 优点 | 保持 V3 语义封装 | 复用 prepared/索引；更贴 IO |
| 风险 | V3 内仍可能逐条调 runtime | 需重做 domain atomic / tags 批语义 |
| 推荐 | — | **推荐 B 为主，V3 编排调用 batch helpers** |

**最终推荐：方案 B（单一路径）** — `LexiconRuntimeV2` 增加 batch lookup；`recallSpanTopKV3Batch` 仅为编排，不是第二套语义链。

### 10.2 Per-key TopK

禁止全局 `LIMIT N`。选项：

1. SQL `ROW_NUMBER() OVER (PARTITION BY request_key ORDER BY prior DESC)` + 外层 `rn<=topK`（SQLite 3.49.2 **已验证可用**）
2. 或 `IN (...)` 取回后 **Node 侧按 key 稳定排序截断**（实现更简单，首版可接受）

首版原型建议：**Node 侧分组截断**（正确性优先）；稳定后可换窗口函数。

### 10.3 需原型覆盖的 SQL

- base exact plain / tone batch  
- domain exact（注意现 `queryDomainMultiRowsAtomic` 双语句 + 动态 prepare）  
- parent ngram batch  
- term_domain_tags batch（今日每 fragment 动态 prepare → **高收益批点**）

每类交付：语句草稿 + `EXPLAIN QUERY PLAN` + 与逐条结果 diff。

### 10.4 参数上限

SQLite 默认 `SQLITE_MAX_VARIABLE_NUMBER` 通常 ≥999；单 step batch ≪ 上限。仍需在原型中断言。

---

## 11. Exact / Parent Semantics

当前：exact 后 **无条件** parent（性能审计 D1）。

| 策略 | 正确性 | SQL | 复杂度 | 本轮 |
|---|---|---|---|---|
| P1 永远保留 parent | 最高 | cache+batch 降本 | 低 | **默认** |
| P2 exact 满则跳过 | 需 counterfactual | 最高 | 中 | 禁止与 cache 混 patch |
| P3 延迟 parent | 中 | 高 | 中 | 独立后续 |

**本轮：P1。** Parent 优化另立项，需统计「exact 满时 parent 是否仍影响 Formal/Vote/句」。

---

## 12. SQL Budget and Metrics

### 12.1 现状

```text
maxSqlPerUtterance=150 ≡ recallable window attempts
≠ physical SQLite statements
```

### 12.2 推荐迁移

```text
KEEP 现有 gate 行为与名称（避免覆盖率回退）
+ 新增 metrics（只观测，不双 gate）
```

新增：

```text
recallRequestCount
uniqueRecallKeyCount
duplicateRecallKeyCount
utteranceCacheHitCount / MissCount
globalLruHitCount（已有 tier stats 可暴露）
batchCount / averageBatchSize / maxBatchSize
logicalQueryCount
physicalSqlStatementCount
exactQueryCount / parentQueryCount
rowsReadCount（可选）
```

禁止新旧 gate 冲突。

### 12.3 计时插桩

```text
recallRequestBuildMs
utteranceCacheLookupMs
batchPrepareMs / batchSqlMs / batchResultMapMs
exactRecallMs / parentRecallMs / termDomainTagLookupMs
windowBindingMs
lexiconRecallTotalMs
```

Level-1：仅数字。Level-2（targetIds）：windowId、canonicalKey、cacheHit、batchId、kind、resultCount、elapsedMs。  
**禁止** dump 全词库/巨大候选。

---

## 13. Interface Changes

| 变更 | 层 | 说明 |
|---|---|---|
| `buildUtteranceSyllableCoordinate` | pinyin-stream / 共享 | Phase 0 |
| `UtteranceRecallContext` | recall-topk 闭包 | Phase 1 |
| `bindLexiconHitsToWindow` | recall-topk | Phase 1 |
| `lookup*Batch` | lexicon-runtime-v2 | Phase 2 |
| `recallSpanTopKV3Batch` | recall-span-topkv3 | Phase 2 编排 |
| metrics 扩展 | v4-types / orchestrator | Phase 1+ |
| **无** Job/Scheduler/Web 字段 | — | 冻结 |

---

## 14. Data Contracts（方向性，贴合现有类型）

```ts
type RecallQueryKind = 'exact_tone' | 'exact_plain' | 'parent_fragment';

type CanonicalRecallQuery = {
  kind: RecallQueryKind;
  pinyinKey: string;
  tonePattern: string; // '' = plain
  domainScope: readonly string[]; // sorted
  topK: number;
  lexiconVersion: string;
};

type UtteranceRecallCacheStats = {
  requestCount: number;
  uniqueKeyCount: number;
  duplicateKeyCount: number;
  hitCount: number;
  missCount: number;
};

type LocalRecallBatch = {
  batchId: string;
  requests: readonly CanonicalRecallQuery[];
};

type BatchRecallResult = ReadonlyMap<string, readonly LexiconFactHit[]>;
```

实现时投影现有 `HotwordEntry` / `RecallSpanTopKV3Hit`，**禁止**另起平行 DTO 层级。

---

## 15. Code-Level Modification Plan

### Phase 0

1. `pinyin-ime-v2-pinyin-stream.ts` — 音节与 ranges 同源  
2. `coarse-boundary-import.ts` — 消费同源坐标；coverage 失败 fail-fast 策略对齐  
3. `ltr-fine-span-generator.ts` — 传入/复用 ranges（可减少每 cursor 重建）  
4. 测试：d009/d099/d189 + 最小 Latin 混排串  
5. offline dialog_200：**200/200**

### Phase 1

1. `UtteranceRecallContext` 在 orchestrator→recall 闭包创建/释放  
2. `recallSpanTopKV3` / V2 路径：Fact 级 cache（按 canonical key）  
3. `bindLexiconHitsToWindow`  
4. metrics + Level-1 计数  
5. 等价性测试：候选集合 100% 一致

### Phase 2

1. Runtime batch helpers + EXPLAIN 原型  
2. step 级 collect→dedupe→batch→map  
3. harness A/B/C（仅测试）  
4. 生产只留 C

---

## 16. Target List

| 区域 | 文件 |
|---|---|
| Phase 0 | `pinyin-ime-v2-pinyin-stream.ts`, `syllableRangeToRawCharRange`, `coarse-boundary-import.ts`, `ltr-fine-span-generator.ts` (`buildWindowAt`, `buildFallbackOption`) |
| Recall | `recall-topk-for-windows.ts`, `recall-span-topkv3.ts`, `recall-span-topk-v2.ts`, `tone-first-tier-collector.ts` |
| SQLite | `lexicon-runtime-v2.ts`, schema indexes, parent/ngram/tags |
| Metrics | `v4-types.ts`, orchestrator, diagnostics config |
| Harness | dialog_200 offline / counterfactual scripts |

---

## 17. Test Plan

### 17.1 Phase 0

- d009 / d099 / d189：无 throw；cursor 单调；Formal 无重叠；全覆盖  
- 最小串：`去望京SOHO测试`、`去A酒店`  
- `coverageOk === true`

### 17.2 Phase 1 Cache

- 同 key 底层 lookup 一次  
- 不同 tone / domainScope / topK 不共享  
- 空结果可命中；异常不缓存  
- window mutation 不污染 cache  
- Formal/Vote/Sentence 与 baseline 一致

### 17.3 Phase 2 Batch

- 单/多请求、重复 key、混合 kind、空结果、多域 tags  
- **每 key 独立 TopK**  
- 稳定顺序；与逐条 **逐字段** 一致

### 17.4 回归

```text
dialog_200 offline 200/200
候选 / Formal / Vote / Sentence / final text 一致率 = 100%（相对 baseline）
```

### 17.5 性能

Before / After P1 / After P2：P50/P90/P95/P99/Max/Mean；physical SQL 不得增加；P95 退化 ≤5%。

---

## 18. Counterfactual Plan

| ID | 配置 | 用途 |
|---|---|---|
| A | 现网逐窗 | Baseline |
| B | + utterance cache | 测去重收益 |
| C | + cache + local batch | 最终态 |

仅 harness；生产只留 C。冷启动首句单独标记，避免污染对比。

---

## 19. Performance Acceptance

```text
physicalSqlStatementCount: 不得增加
P95 assembly: 退化 ≤5%
P99: 无新增异常尾延迟
memory: 无跨句泄漏（utterance cache 必须释放）
若 duplicateKeyRatio 很低：如实报告；Phase 1 仍保留为正确性与 Phase 2 基础
```

---

## 20. Regression Acceptance

```text
Phase 0: offline 200/200 success
Phase 1: 语义 100% 等价 + 可观测 duplicate/hit
Phase 2: 语义 100% 等价 + SQL 下降 + 无第二链
```

---

## 21. KEEP / MODIFY / DELETE / OBSERVE ONLY

### KEEP

| 项 | 原因 |
|---|---|
| LTR loop / 短词策略 / soft boundary | 冻结语义 |
| blockedFilter 在 SQL 前 | 早期过滤正确 |
| SQLite indexes / prepared base statements | EXPLAIN 良好 |
| Global LRU | DB 级缓存 |
| Parent 默认保留（P1） | 未证明可短路 |

### MODIFY

| 项 | 原因 |
|---|---|
| `textToPinyinStream` 音节坐标 | Phase 0 SSOT |
| coverageOk 后仍进 LTR | 应 fail-fast 或不可达 |
| Recall 请求构造 / cache / batch | Phase 1–2 |
| Metrics（真实 statement 观测） | 不改 gate |
| domain/tags 动态 prepare | Phase 2 批点 |

### DELETE（仅优化落地后、最小范围）

| 项 | 原因 |
|---|---|
| 被 batch 完全替代的逐条内部 helper | 防双链 |
| （可选另项）旧 `generateGlobalWindows` | dead code；**不纳入本性能 patch 必做** |

### OBSERVE ONLY

| 项 | 原因 |
|---|---|
| Tone range cache | 非本轮 |
| Sentence late cap | 非本轮 |
| Coarse O(ℓ·c) lookup | 收益低 |
| Worker / Redis / 多连接 | 明确不做 |
| Parent 短路 P2/P3 | 需独立 counterfactual |

---

## 22. Risks

1. Batch 行序 → 必须稳定 sort  
2. 多域 tags 丢失 → 保持 atomic 语义  
3. Parent 被误短路 → 本轮禁止  
4. Key 不完整 → 错误共享  
5. WindowCandidate 坐标污染 → Fact/bind 分离  
6. Global LRU vs utterance cache 职责混 → 文档+代码隔离  
7. 每 key TopK 错误 → 原型门禁  
8. SQL 变量上限 → 断言  
9. Budget gate 误改 → 只加 metrics  
10. 空/异常错误缓存 → 策略表  
11. 冷启动污染对比 → harness 分桶  
12. **未修 Phase 0 即优化** → 阻断  
13. diagnostics 放大 → Level-2 targetIds  
14. batch 变第二链 → 生产只留 C  

---

## 23. Rollback Plan

| Phase | Rollback |
|---|---|
| 0 | 单 PR revert；坐标函数开关禁止长期双路径 — **直接回退提交** |
| 1 | 关闭 utterance cache 注入（feature 仅测试允许）；生产无 flag 双链则整 PR revert |
| 2 | 回退 batch helpers，恢复逐条 runtime 调用；cache 可保留 |

禁止「旧逐条 + 新 batch」并行生产。

---

## 24. Final Recommendation

### Fallback Correctness

```text
BLOCKING
```

### Utterance Cache

```text
READY
```

### Local SQLite Batch

```text
NEEDS SQL PROTOTYPE
```

### Development Recommendation

```text
PROCEED PHASE 0 + PHASE 1
```

理由：

1. 未修 SOHO 坐标前，任何 cache/batch 都建立在可崩溃主链上；  
2. Cache 合同清晰，可立即设计实现并测等价性；  
3. Batch 需先原型证明 per-key TopK / domain atomic / tags，**不在本轮直接开码**；  
4. Phase 2 设计已写入，Phase 0+1 验收 + SQL 原型通过后另批 `PROCEED PHASE 2`。

---

## 25. Development Sequence

```text
工作原则：先正确性 → 再去重 → 再批量 → 最后才评估并发

1. Phase 0：音节坐标 SSOT + d009/d099/d189 + offline 200/200
2. Phase 1：Canonical key + Utterance cache + metrics + 等价性
3. （门禁）duplicate ratio / hit ratio 报告
4. Phase 2 原型：batch SQL EXPLAIN + 逐条 diff
5. Phase 2 实现：step 级 batch；生产只留 C
6. 全量回归 + 性能验收
7. 明确不启动：Redis / Worker / 多连接
```

---

## Appendix — 最终目标回扣

```text
同一句相同查询只执行一次（Utterance Cache）
同一步多个唯一查询批量访问 SQLite（Local Batch）
保持原候选语义完全不变
不引入第二条 Recall 链
不引入运行架构复杂度
```

*End of development plan.*
