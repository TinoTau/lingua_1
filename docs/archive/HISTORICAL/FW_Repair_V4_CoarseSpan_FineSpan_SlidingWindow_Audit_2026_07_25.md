<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_CoarseSpan_FineSpan_SlidingWindow_Audit_2026_07_25.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4 — CoarseSpan → FineSpan Sliding Window Focused Audit

| Field | Value |
|---|---|
| Date | 2026-07-25 |
| Type | Read-only Audit + Diagnostics Design |
| Scope | Coarse Span → Fine Span Sliding Window（含 Prior / Tone / Vote 输入边界） |
| Code SSOT | `electron_node/electron-node/main/src/fw-detector/**` |
| Frozen Design Baseline | `FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_Development_Plan_2026_07_22.md` + Constraint Addendum / Supplement |
| Probe Artifacts | `docs/tone-v2/_audit_scratch/dialog200_gt_ltr_partition_probe.json`, `ltr-window-probe.out.txt` |
| Business Goal | 在 ASR 边界/文本可能错误时，找到少量高价值 Fine Span → 召回 → Domain Vote → 自然句组装；**不是**穷举子串或把压力转给 KenLM |

---

## 1. Executive Summary

当前生产 Fine Span **不是**「每个 Coarse Span 内独立全量滑窗」，也**不是**旧 `generateGlobalWindows` 全句重叠枚举。

真实主链是：

```text
CURRENT:
Utterance-global Left-to-Right FineSpan commit
+ local temporary options length 2..5 at cursor
+ soft coarse boundary (cross ≤ 1)
+ no Beam / no DP / no backtrack (v1)
```

对照冻结 Development Plan（2026-07-22），**核心边界与生成权基本落地**；差距主要在：诊断导出不足、Prior 对 Recall 查询顺序未落地、旧全滑窗文件仍残留、以及「有效 Fine Span 2–4」仅为业务期望而非硬约束。

### Final Verdict

```text
FineSpan Sliding Window
PARTIALLY MATCHES FROZEN DESIGN
```

不得因存在 `FormalFineSpan` / `generatorMode=ltr_soft_boundary` / 单元测试通过而升格为 MATCHES。

---

## 2. Frozen Design Baseline

| 冻结项 | 冻结要求 | 代码判定 |
|---|---|---|
| FineSpan 生产入口唯一 | 仅 LTR Generator；禁止旧 global windows 回生产 | **IMPLEMENTED**（orchestrator 只调 `runLtrFineSpanGeneration`） |
| Coarse = soft boundary | 可跨 ≤1；跨 ≥2 拒绝；跨界弱于等价界内 | **IMPLEMENTED** |
| 临时 option 可重叠 / Formal 不可重叠 | cursor 每次只 commit 一个；cursor 只前进 | **IMPLEMENTED** |
| 窗口长度 | local 2..5 音节；1 音节仅 fallback | **IMPLEMENTED**（不是 2–6 字旧口径） |
| 无 Beam / 无 DP / 无全局回溯 | v1 不实现 one-step lookahead | **IMPLEMENTED**（刻意缺失） |
| Prior soft only | 不得写 `enabledDomains` / `recallDomainScope`；可做 option 平局打破与 candidate quota | **PARTIAL**（K3 + quota 有；Recall 查询顺序无） |
| Vote 池粒度 | Formal FineSpan 一池 | **IMPLEMENTED** |
| Sentence Cap | ≤16 | **IMPLEMENTED**（`maxSentenceCandidates`） |
| 旧全滑窗删除 | 不得生产可达 | **PARTIAL**：生产不可达，但 `generateGlobalWindows` / `truncateWindows` **DEAD CODE 残留** |

**Coarse 模式归类（任务 §2.1）：**

| 模式 | 描述 | 当前 |
|---|---|---|
| A | 每个 Coarse 内独立滑窗，禁止跨界 | 否 |
| B | 允许有限跨界；Coarse 作惩罚/优先级 | **是（主语义）** |
| C | 句首流式推进；Coarse 仅软信息 | **是（主算法）** |

→ 真实实现 = **B + C 混合**：utterance-global LTR（C）+ soft boundary ranking（B）。

---

## 3. Production Call Graph

| 层 | 文件 | 函数 | 输入 → 输出 | 状态读取 | 决策 | 下一层 | 生产可达 | 冻结内 |
|---|---|---|---|---|---|---|---|---|
| Job 入站 | `fw-job-overrides.ts` | `applyDomainPriorsFromJob` | `JobAssign.domainPriors` → `ctx.domainPriors` | job payload | sanitize；missing→[] | FW step | YES | YES |
| Pipeline | `pipeline/steps/fw-detector-step.ts` | `runFwDetectorStep` | job+ctx → orchestrator | `ctx.domainPriors`, ASR text | language gate / overrides | `runFwDetectorOrchestrator` | YES | YES |
| Orchestrator | `fw-detector-orchestrator.ts` | `runFwDetectorOrchestrator` | ctx → V4 path | lexicon, recall scope, profile | resolve `recallDomainScope`（**不含** prior） | `runFwDetectorV4Path` | YES | YES |
| V4 Path | `fw-detector-v4-path.ts` | `runFwDetectorV4Path` | rawText + ctx tones/segments | `ctx.domainPriors`, acoustic slices | KenLM gate 开关 | `runSpanAssemblyV4Orchestrator` | YES | YES |
| Coarse | `coarse-span-partition.ts` → `coarse-boundary-import.ts` | `partitionCoarseSpans` / `buildCoarseSpansFromRawImeBoundary` | rawText + IME dict + asrSegments | IME topK / ASR words / punct | 合并 split → `CoarseSpan[]` | LTR | YES | YES |
| Fine LTR | `ltr-fine-span-generator.ts` | `runLtrFineSpanGeneration` | syllables + coarse + priors + recall hook | cursor | 每步生成 2..5 option → recall → commit 1 Formal | blockedFilter+recall / assembly | YES | YES |
| Block filter | `blocked-window-filter.ts` | `blockedFilter` | temporary windows | wordTimeSpans, punct, gaps | 标 `blocked`（不删 ID） | recall | YES | YES（helper） |
| Recall | `recall-topk-for-windows.ts` | `recallTopKForWindows` | windows + runtime + domainIds | tone slices, lexicon SQL | exact/parent TopK；tone **penalty** | commit | YES | YES |
| Tone rebind | `tone-commit-rebind.ts` | `rebindToneAfterFormalCommit` | Formal range | acoustic slices | Formal 坐标重绑 tone（非二次推理） | assembly | YES | YES |
| Compat | `candidate-compatibility-graph.ts` | `resolveCompatibilityRelations` | all Formal candidates | — | coverage / conflict drop | domain assembly | YES | YES |
| Vote+Assembly | `assemble-domain-aware-span-sets.ts` | `runDomainAwareAssembly` | Formal pools | priors（仅 quota） | Presence Vote → SameDomain buckets → per-span select | sentence candidates | YES | YES |
| Sentence | `build-sentence-candidates.ts` | `buildSentenceCandidates` / merge | span sets | — | 组合 + global cap≤16 | KenLM | YES | YES |
| KenLM | `kenlm/run-fw-sentence-rerank-from-prefilled.ts` | `runFwSentenceRerankFromPrefilled` | ≤16 sentences | — | approve/veto | result | YES | YES |

**数据如何变化（摘要）：**

1. ASR 整句文本 → 音节流 + Coarse 软切分（不决定最终词界）。
2. cursor 从 0 推进：每步最多 4 个临时窗（len 2..5）+ 强制 1 音节 fallback。
3. 未 blocked 的窗做拼音/声调召回 → 候选挂到 `windowId`。
4. K1 词汇完整度 > K2 边界类 > K3 prior 平局 > K4 更短长度 > K5 稳定序 → 选一个 Formal FineSpan；cursor=`syllableEnd`。
5. Formal 候选进入 Presence Vote（一 Formal Span 对一域最多一票）→ SameDomain 桶 → ≤16 句 → KenLM。

**旧链：** `generateGlobalWindows` **生产不可达**（仅测试引用）→ **DEAD CODE**。

---

## 4. Coarse Span Generation

### 4.1 真实结构

```ts
type CoarseSpan = {
  id: string;                 // e.g. "c0"
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  text: string;
  source: CoarseBoundarySource;
  boundaryConfidence: number;
};
```

**无**独立 `timeStartMs/timeEndMs` / `boundaryReason` 字段；时间用于 `blockedFilter.asr_word_gap_ms` 与 Tone 对齐，不写进 CoarseSpan。

### 4.2 问答（任务 §四）

| # | 问题 | 答案 |
|---|---|---|
| 1 | 输入 | **FW 整句 rawText** + IME dict + 可选 `asrSegments`（word tokens），不是纯 word-timestamp 切分 |
| 2 | 标点 | **是**（`punctuation_fallback` / raw punct boundaries） |
| 3 | 空格 | **是**（raw `space` kind） |
| 4 | 停顿阈值 | Coarse **不**直接用 pause；`V4_LIMITS.asrWordGapMs=400` 用于 **Fine 窗 blockedFilter** |
| 5 | Timestamp gap | 同上，作用于 Fine 窗，非 Coarse 生成 |
| 6 | 中英混合 | Fine 窗遇 non-CJK → `non_cjk_syllable` block；Coarse 仍可按 IME/punct 切 |
| 7 | 单字 Coarse | `mergeSingleSyllableSpans` **合并**非 proposal-locked 单音节 |
| 8 | 合并 | 有（单音节合并） |
| 9 | 再切分 | Fine LTR **不重切 Coarse**；只读 `spanIds` 算 cross |
| 10 | ID | `c0,c1,...` |
| 11 | 保留字段 | char + syllable + source + confidence；**无** token index / time on Coarse |
| 12 | 硬边界？ | **否**（soft；跨 ≤1 可 commit） |

### 4.3 dialog_d001 GT 真实 Coarse（probe）

IME 在本机 probe 中 `imeCandidateCount=0` → `fallbackReason=no_trusted_topk`，仅标点切分（生产有 IME 时会叠加 ime/asr/proposal）：

```json
[
  {"id":"c0","text":"你好","charRange":[0,2],"source":"punctuation_fallback"},
  {"id":"c1","text":"我想点一杯热拿铁","charRange":[3,11],"source":"punctuation_fallback"},
  {"id":"c2","text":"中杯","charRange":[12,14],"source":"punctuation_fallback"},
  {"id":"c3","text":"少糖","charRange":[15,17],"source":"punctuation_fallback"},
  {"id":"c4","text":"顺便问一下今天有蓝莓马芬吗","charRange":[18,31],"source":"punctuation_fallback"}
]
```

---

## 5. Fine Span Sliding Window

### 5.1 初始化 / 扩展 / 坐标

| 项 | 真实值 |
|---|---|
| cursor | 全句音节坐标，从 0 开始 |
| 默认长度 | **从短到长** `len = 2..min(5, remaining)` |
| 单位 | **音节**（CJK≈字；非字符穷举） |
| 单字窗口 | 正式 option **不含**；仅 commit 阶段强制 fallback `len=1` |
| 跳过标点 | 不在生成循环跳字符；含标点窗可被 `blockedFilter` 标 blocked |
| 重叠 | **临时 option 重叠**；**Formal 禁止重叠** |
| 回溯 | **无** |
| 路径选择 | **无** Beam/DP；仅当前 cursor 贪心 commit |
| 硬剪枝 | `boundaryCrossCount>1` → blocked；blockedFilter 多项；SQL budget 150 |

核心代码：`generateLocalOptionsAtCursor` / `commitBestFormalFineSpan` / `runLtrFineSpanGeneration`。

### 5.2 示例：`我要一杯拿铁咖啡` 类窗口（算法级）

对 `拿铁咖啡`（syllables=`na|tie|ka|fei`），cursor=0 真实生成：

```text
start=0 length=2 text=拿铁   cross=0 in_span
start=0 length=3 text=拿铁咖 cross=1 boundary   （若 coarse=拿铁|咖啡）
start=0 length=4 text=拿铁咖啡 cross=1 boundary
```

**不是**全句所有子串；每个 cursor **只锚定起点=cursor**。

### 5.3 过滤位置

| 过滤 | 位置 |
|---|---|
| cross>1 → blocked | **生成时**（`buildWindowAt`） |
| punct / whitespace / sentence / non-CJK / raw_gap / asr_gap>400ms | **召回前**（`blockedFilter`） |
| minPrior | **召回后**（丢弃 hit） |
| tone mismatch | **召回后 penalty**（默认不硬丢） |
| K1/K2 ineligible 跨界不完整词 | **commit 前** |
| Formal 重叠 | **不生成**（cursor 前进保证） |
| 120/40 truncateWindows | **生产 LTR 路径未调用**（旧全滑窗遗留） |

### 5.4 召回查询键（真实）

每窗：`globalSyllables.slice(start,end)` + `windowText` + 可选 `acousticTonePattern` → `recallSpanTopKV3`（exact + parent_fragment TopK）。  
**不**用 Domain Prior 收窄 `domainIds`（仍用 `recallDomainScope`）。

### 5.5 Formal 接受条件

1. 未 blocked / cross≤1；
2. 跨界必须 `complete_single_term`（或 reserved `multi_unit_concat`，当前不可达）；
3. 在 eligible + fallback 中按 K1>K2>K3>K4>K5 胜出；
4. `lexicalCompleteness==='none'` → `windowSource='fallback'` 且 `candidates=[]`。

---

## 6. Cross-Boundary Capability

代码级反例（强制错误 Coarse + 注入 recall；产物见 `_audit_scratch/ltr-window-probe.out.txt`）：

### 6.1 `拿铁 | 咖啡` → `拿铁咖啡`

| 项 | 结果 |
|---|---|
| 跨界窗口是否生成 | **YES** `0:4` `拿铁咖啡` `boundary_window` |
| 是否进入 recall | **YES**（未 blocked） |
| 是否可命中 lexicon | **YES**（probe 注入 exact） |
| 最终是否保留 | **NO（本探针）**：同时命中界内 `拿铁` → K2 `in_span_complete` 优于 `boundary_cross_complete`，commit `fine:0:2` |

→ 跨界**能力存在**，但冻结约束 #10「跨界弱于等价界内」会压掉更长跨界完整词。

### 6.2 `我想预 | 订酒店` → `预订` / `预订酒店`

| 项 | 结果 |
|---|---|
| cursor=0 跨界窗 | `我想预订` / `我想预订酒` 生成 |
| `预订` | cursor 前进到 2 后生成 `2:4`，**cross=1**，**最终保留** |
| `预订酒店` | `2:6` 生成且可命中，但 **shorter_exact_tiebreak** 选 `预订` |

→ **跨界召回 IMPLEMENTED**；更长短语不一定胜出。

### 6.3 `去皇后 | 镇机场` → `皇后镇` / `皇后镇机场`

| 项 | 结果 |
|---|---|
| 金标起点 | syllable=1（「皇」） |
| cursor=0 行为 | 无命中时 commit 短 fallback，cursor 越过 1 |
| `皇后镇` 窗 | 起点已错过 → **无法再生成** |
| 回溯 | **NOT IMPLEMENTED**（冻结 v1 明确禁止） |

→ 跨界**不足以**修复「金标起点落在已提交区间内」；这是 LTR 无 lookahead 的结构性缺口，不是文档臆测。

---

## 7. Streaming / Backtracking Capability

| 结构 | 现状 |
|---|---|
| cursor | **有** |
| frontier / path / DP / lattice / ambiguity queue | **无** |
| backtrack / MERGE/SPLIT/MOVE | **无** |
| earliest confirm | 每步立即 commit（贪心） |
| overlap graph | 仅下游候选 compatibility，**不做 FineSpan 边界重算** |

```text
CURRENT:
Streaming fine-span segmentation
(utterance-global LTR; soft coarse; no backtrack)
```

**不是** `Coarse-span-local sliding window`。  
**不是** 旧 `Cross-boundary full overlapping sliding window`（`generateGlobalWindows`）。

---

## 8. Window Filtering and Recall

见 §5.3–5.4。补充：

- `exactTopK=2`，`parentFragmentTopK=3`，`maxSqlPerUtterance=150`。
- 多领域：`domains` 数组原样保留，**禁止**压成 `domains[0]`（召回/Vote 按集合处理）。

---

## 9. Domain Prior Participation

可多选，有源码证据：

| 代号 | 作用 | 判定 | 证据 |
|---|---|---|---|
| A | 影响候选排序 | **YES** | `applyDomainPriorQuota` |
| B | 影响词库查询域 | **NO** | recall 用 `recallDomainScope`，orchestrator 注释禁止 prior 写入 |
| C | 影响窗口生成 | **NO** | `generateLocalOptionsAtCursor` 不读 prior |
| D | 影响 Span 接受 | **PARTIAL** | 仅 K1/K2 已平局时 K3；改变胜者且 K1/K2 不等 → **throw** |
| E | 影响 Domain Vote | **NO** | `p5-prior-vote-isolation.test.ts`；Vote 不计 prior |
| F | 日志字段 | **YES（兼）** | `fineSpanPriorSource` |

补充确认：

- 不锁单域；Base 仍可进；非 prior 域保留探索配额（quota 保证）；
- 会话锁域：**无**（Node soft consumer）；
- Prior 更新：按 Job 绑定，**当句生效**（非 Node 内跨句状态机）。

相对冻结 Plan §2.3.4「可影响 Recall 查询顺序」→ **NOT IMPLEMENTED**（差距项）。

---

## 10. Tone Participation

| 阶段 | 使用？ |
|---|---|
| Fine Span 生成前 | **否** |
| Fine Span 生成后 / Formal commit | **rebind** 到 Formal raw/syl 范围 |
| Lexicon Recall | **是**：窗级 `extractAcousticTonePatternForRecall` → SQL/score |
| Candidate Ranking | **是**：`tonePenalty` 进分数；默认 **不硬过滤** |

缺失 tone → fallback / no_pattern；错误 tone → penalty，一般仍可进池。  
Tone **不**直接改正文案。

---

## 11. Quantity and Performance Limits

| 约束 | 代码事实 |
|---|---|
| 「每句有效 Fine Span 2–4」 | **无硬上限**；Formal 数 ≈ 覆盖全句的 commit 次数 |
| 每 FineSpan 候选 | `getPerSpanCandidateLimit(spanCount)`：1→8 / 2→6 / else→4 |
| 整句 Sentence | `maxSentenceCandidates=16`（freeze 测试钉死） |

**四层计数不得混用**（d001 GT、空召回探针）：

| 层 | d001 探针值 |
|---|---|
| raw temporary options（进入 recall hook） | 48 |
| after blockedFilter recallable | 30（blocked 18） |
| Formal FineSpan（含 fallback） | **14** |
| Vote spans | = Formal 池数；空候选池对 Vote **贡献 0** |
| Sentence candidates | 另计，cap 16 |

≈15–25 字句：每步 ≤4 临时窗 +1 fallback，**O(n)**，远小于旧全滑窗 O(n×4)。  
风险：空命中时 Formal 过多 → `perSpanLimit` 降为 4，且 Vote/Assembly slot 变碎——**不是**把排列组合甩给 KenLM（句候选仍 ≤16）。

旧 `maxGlobalWindowCount=120` / `maxBoundaryWindowCount=40` 在 LTR 生产路径 **未使用**。

---

## 12. Dialog200 Trace Design

### 12.1 原则

- 复用 `resolveV4DiagnosticsConfig` + `V4TraceCollector`；
- **只读观测**；禁止新 SSOT / 新决策字段 / 新候选链 / 生产分支；
- Level-1 全量摘要；Level-2 仅 5–10 条 `targetIds`。

### 12.2 现有缺口（OBSERVE ONLY）

| 已有 | 缺失 |
|---|---|
| coarseSpans trace | LTR `steps[]` **未写入** diagnostics（仅内存 `ltr.trace`，metrics 用 option 计数） |
| boundaryWindows（仅已 commit 的跨界 Formal） | 每步 raw options / rejectionReason 枚举 |
| recallHits / preFilter | windowId↔fineSpanId 选择理由完整链 |
| sentenceCandidates | Level-1 一页摘要结构 |

### 12.3 最小补充方案（设计，不在本轮改代码）

1. 在 `V4TraceCollector` 增加只读桶 `ltrSteps?: LtrFineSpanStepTrace[]`（类型已存在于 generator）。
2. orchestrator 在 `diagnosticsConfig.traceActive` 时 `trace.pushLtrSteps(ltr.trace.steps)`。
3. Level-1：从 metrics 导出  
   `caseId, asrText, coarseSpanCount, rawWindowCount(=globalWindowGeneratedCount), formalFineSpanCount, domainScores, kenlmPoolCandidateCount, finalText`。
4. Level-2：`spanAssemblyV4DiagnosticsLevel=trace` + `targetIds` 白名单；拒绝原因枚举映射：

| 代码条件 | 建议枚举 |
|---|---|
| blocked cross>1 | `CROSS_GT_1` |
| blockedFilter punct/gap/... | 沿用 `blockedBoundaryReason` |
| rejected_partial | `REJECTED_PARTIAL_CROSS` |
| commit 未选中 | `LOSER_AT_CURSOR` |
| sql budget | `SQL_BUDGET_EXHAUSTED`（已有） |

5. 关联键：`caseId(=traceCaseId)` + `jobId` + `coarseSpanId` + `windowId` + `fineSpanId(=spanId)`；**禁止**仅用文本关联。

### 12.4 Level-2 样例清单（dialog_200）

| 类型 | 建议 case |
|---|---|
| 普通单领域 | d001 / d002 cafe |
| Coarse 边界可能错 | 标点密集句（d001） |
| 需跨界 | 人工 coarse 错切探针 + 最接近的 taxi/hotel 句（d007 / d031） |
| 一词多域 | context_prior 混合句 |
| empty prior / non-empty prior | Node prior E2E 已覆盖机制；dialog 跑时挂 `domainPriors` |
| Tone 参与 | 任意有 acoustic slices 的 live 跑 |
| 无词库命中 | meeting 场景 d004/d005 |

---

## 13. Real Dialog200 Examples

> 说明：本轮**未**重跑 200 条 wav ASR 全链。以下为 **dialog_200 GT 文本 + 真实 `partitionCoarseSpans` + 真实 LTR** 探针（空 lexicon recall）。完整 ASR/Tone/Lexicon 明细需等 §12 diagnostics 落地后再采 Level-2。产物：`dialog200_gt_ltr_partition_probe.json`。

### Example 1 — 正常 Span（d001）

```text
ASR/GT: 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？
→ Coarse: 5 spans（标点软切；本机 IME trusted=0）
→ Raw options→recall hook: 48；blockedFilter 后 recallable 30
→ Formal FineSpans: 14（空召回 → 大量 fallback / shorter_exact_tiebreak）
→ 含「拿铁」位：fine:8:10 text=拿铁（仍为 fallback，因无 lexicon hit）
→ Domain Votes: 空候选 → insufficientEvidence
→ Final Candidate: 无修复（探针）
```

**解读：** 滑窗/LTR **会走到「拿铁」坐标**；纠错价值取决于召回命中，而不是多造窗。

### Example 2 — 边界问题（跨界探针，非 wav）

强制 `拿铁|咖啡`：跨界窗 `拿铁咖啡` **生成并召回**，但界内完整词优先 → **不保留长跨界**（§6.1）。  
强制 `去皇后|镇机场`：无回溯 → **错过**「皇后镇」起点（§6.3）。

### Example 3 — 重叠歧义（`预订酒店` 单 coarse）

cursor=0 真实 options：`预订` / `预订酒` / `预订酒店`（皆可命中时）：

```text
ranking: 0:2 > 0:3 > 0:4
selected: fine:0:2 预订  reason=shorter_exact_tiebreak
然后 cursor=2 → 酒店
```

→ 重叠在 **同一 cursor 内**解决；**不**保留多个重叠 Formal。

---

## 14. Current vs Frozen Design Matrix

| 主题 | 冻结 | 当前 | 判定 |
|---|---|---|---|
| 生成权 | LTR only | LTR only | IMPLEMENTED |
| Coarse soft | cross≤1 | cross≤1 + K2 弱跨界 | IMPLEMENTED |
| 窗长 | 2..5 syl | 2..5 | IMPLEMENTED |
| 临时重叠 / Formal 不重叠 | 是 | 是 | IMPLEMENTED |
| 无回溯 v1 | 是 | 是 | IMPLEMENTED |
| Prior→option 平局 | 是 | 是 | IMPLEMENTED |
| Prior→Recall 顺序 | 是 | 否 | NOT IMPLEMENTED |
| Prior↛Vote | 是 | 是 | IMPLEMENTED |
| Vote=Formal pool | 是 | 是 | IMPLEMENTED |
| 删全滑窗生产 | 是 | 生产已断；文件残留 | PARTIAL / DEAD CODE |
| 有效 FineSpan 2–4 | 业务期望 | 无硬限制 | NOT IMPLEMENTED（约束层） |
| 诊断可还原滑窗 | 验收需要 | LTR steps 未导出 | PARTIAL |
| Detector/Beam | 禁止 | 生产无 | KEEP（已移除） |

---

## 15. KEEP / MODIFY / RESTORE / DELETE / OBSERVE ONLY

### KEEP

| 文件 | 函数 | 原因 | 影响 |
|---|---|---|---|
| `ltr-fine-span-generator.ts` | `runLtrFineSpanGeneration` | 唯一生产 FineSpan 主链 | 纠错边界决策 SSOT |
| `span-assembly-v4-orchestrator.ts` | `runSpanAssemblyV4Orchestrator` | 正确接线 LTR→Vote→≤16 | 主链稳定 |
| `blocked-window-filter.ts` | `blockedFilter` | 软边界安全网 | 降噪跨界 |
| `assemble-domain-aware-span-sets.ts` | `buildFineSpanCandidatePool` | Formal 池 Vote | 与冻结 Vote 对齐 |
| `utterance-domain-vote.ts` | `voteUtteranceDomainFromPool` | Presence Vote | 领域证据 |

### MODIFY（方向对，不完整；本轮不改代码）

| 文件 | 函数 | 原因 | 影响 |
|---|---|---|---|
| `v4-diagnostics-trace.ts` / orchestrator | trace 导出 | LTR steps 未进 diagnostics | dialog_200 难归因 |
| Prior×Recall | （缺失钩子） | Plan 允许影响查询顺序但未做 | prior 对召回偏弱 |

### RESTORE

| 项 | 说明 |
|---|---|
| 无 | **不要**恢复旧全滑窗 / Beam / Detector / Membership |

若未来要加强「错过起点」召回，只允许在 **LTR 主链内**加冻结允许的最小 lookahead（需新开发边界），**禁止**双链。

### DELETE（清理候选，非本轮执行）

| 文件 | 函数 | 原因 | 影响 |
|---|---|---|---|
| `generate-global-windows.ts` | `generateGlobalWindows` | 生产不可达残留 | 降低误接风险 |
| `blocked-window-filter.ts` | `truncateWindows` | LTR 不再使用 120/40 | 避免旧预算复活 |

### OBSERVE ONLY

| 文件 | 函数 | 原因 | 影响 |
|---|---|---|---|
| `ltr-fine-span-generator.ts` | `LtrFineSpanTrace` | 已有内存 trace，缺导出 | 只加日志 |
| `architectureCompliance` | metrics | 已有 generatorMode 等 | 摘要足够，明细不足 |
| IME `no_trusted_topk` | partition | 环境影响 Coarse 形态 | 跑 dialog_200 时核对 IME 是否加载 |

---

## 16. Risks

1. **无回溯**：金标起点被短 fallback 吃掉后不可恢复（皇后镇类）。
2. **K2 界内优先**：更长跨界完整词可能故意落败（拿铁咖啡类）——符合冻结 #10，但需诊断可见。
3. **空命中 Formal 碎片化**：拉低 per-span 候选上限。
4. **死代码回潮**：`generateGlobalWindows` 仍在树内（ICST-01 风险）。
5. **诊断不足**：dialog_200 难区分「没生成窗」vs「生成了但 K2 输了」vs「recall 未命中」。
6. **不得**为修 Span 而放大 Sentence 枚举或 KenLM 负担。

---

## 17. Final Verdict

```text
FineSpan Sliding Window
PARTIALLY MATCHES FROZEN DESIGN
```

**MATCHES 的部分：** utterance-global LTR、soft coarse（cross≤1）、临时重叠/正式不重叠、无 Beam/DP/回溯（v1）、Vote Formal 池、句候选 ≤16、生产入口单一。

**PARTIAL 的部分：** Prior→Recall 顺序未做；LTR 过程日志未导出；旧全滑窗死代码残留；「2–4 有效 Fine Span」无硬约束；跨界能生成但受 K2/无回溯限制，不能等价于「流式+回溯纠错边界」。

---

## 18. Next Development Boundary

本轮 **不开发**。若后续立项：

1. **优先**：OBSERVE ONLY — 导出 LTR step diagnostics（dialog_200 Level-2）。
2. **其次**：确认是否实施 Plan 中 Prior→Recall 顺序（仍 soft，不得变白名单）。
3. **清理**：删除或测试隔离 `generateGlobalWindows` / `truncateWindows`。
4. **禁止**：旧窗+新 LTR 双链；禁止为 Span 问题重开 Detector/Beam；禁止把复杂度转移给 KenLM。
5. **若**要做 lookahead/回溯：必须新开发边界文档，**直接替换**当前 LTR commit 策略，且仍限制在 FineSpan 阶段内结束。

生产 AudioChunk Dual-Turn E2E 与 P5 Final Freeze 仍按既有队列，**不**因本审计自动解锁 dialog_200 全量验收。

---

## 19. 开发目标回扣

| 判断标准 | 当前结论 |
|---|---|
| 是否更容易找到正确词边界 | **部分是**：相对旧全滑窗，LTR+soft cross 更对准「少量决策」；但无回溯时仍会错过起点 |
| 是否减少漏召回 | **有条件**：跨界完整词可召回；界内短词优先与无回溯会制造新漏召回 |
| 是否控制候选规模 | **是**（临时窗 O(n)；句 ≤16）；Formal 碎片是另一类规模问题 |
| 是否支持领域投票 | **是**（Formal Presence Vote） |
| 是否把复杂度转给 KenLM | **否**（未用 Span 膨胀 Sentence 排列） |

**一句话：** 当前实现整体是在用 **受控 LTR FineSpan** 寻找纠错边界，而不是单纯「生成更多窗口」；但若无召回命中或起点被提前 commit，它会退化成 **多段 fallback 切片**，此时对 ASR 纠错帮助有限——这正是 dialog_200 Level-2 诊断要首先区分的现象。

---

## 20. 审计重点问题速答（§十七）

1. Coarse：**软边界**  
2. Fine：**流式 LTR（非 Coarse-local 全滑窗）**  
3. 跨 Coarse：**允许 ≤1**  
4. 窗长：**2–5 音节**（+1 fallback）  
5. 全子串？：**否**（仅 cursor 锚定）  
6. 剪枝：blocked + K1/K2 + SQL budget（无生产 120/40）  
7. 最终 Formal 数：**覆盖全句的 commit 数**（无 2–4 硬帽）  
8. Formal 重叠？：**否**；临时：**是**  
9. 重叠冲突：同 cursor 排序选一  
10. 回溯？：**否**  
11. Prior：影响 **option 平局 + 候选 quota**，不影响窗生成 / Vote  
12. Tone：影响 **召回评分**，默认不硬丢 Span  
13. Base/Domain：同池；select 时 SameDomain 优先再 Base；prior soft quota  
14. 多领域 tags：**保留数组**  
15. 进 Vote：Formal 池 presence  
16. Span 扩展≠Sentence 排列：**是**（句仍 ≤16）  
17. 符合冻结？：**部分符合**  
18. 差距性质：**算法按 v1 刻意不含回溯** + **日志不足** + **少量死代码/Prior-Recall 缺口**；非 Detector 残留主链  

---

*End of audit.*
