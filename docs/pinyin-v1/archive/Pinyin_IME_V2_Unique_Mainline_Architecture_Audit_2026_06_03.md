# Pinyin IME V2 唯一主链架构接入审计

**Date:** 2026-06-03  
**Type:** 只读代码审计（未修改代码、配置、SQLite、Patch Service、Scheduler、ASR Text Chain）  
**决策前提：** 不并行、不 shadow、不保留 legacy Detector active path；建立 **pinyin-ime-v2 唯一 ASR 后处理主链**

---

## Executive Summary

当前生产 ASR 后处理在 `asr.engine = fw_detector_v1` 下由 **`FW_SPAN_DETECTOR` → `runFwDetectorOrchestrator` → `resolveFwSpans`（Metadata/Legacy/KenLM gate）→ Recall → Sentence Rerank → Apply** 驱动。`pinyin-ime-v1` **完全在 `tests/spike/`**，`main/src` **零引用**。

离线 Spike 已证明：**整句修复失败**（Pipeline Success 0%），**Span Proposal 有价值**（Top5 Case Span Recall 76.9%）。当前批测 **Detector Span Recall 0%**（`fw_span_count=0`，Lexicon Runtime ABI 故障），支持将 span 发现从 Metadata/Legacy Detector **切换为 IME V2**。

**审计结论：可以建立 pinyin-ime-v2 唯一主链**，但必须：

1. **重写 `fw-detector-orchestrator` 内部 span 阶段**（保留 step 名与 Recall/KenLM/Apply 壳）
2. **从 active path 移除** `resolveFwSpans` / metadata gate / legacy fallback（文件可 archived，不物理删）
3. **归档/移除** `tests/spike/pinyin-ime-v1-*`（v1 不进入 `main/src`）
4. **新建** `main/src/fw-detector/pinyin-ime-v2/` 干净模块（推荐位置 A）
5. **大幅更新** `freeze-contract.test.ts`（禁止 shadow/双路/legacy active）
6. **不改** Lexicon V3.1 SQLite、Scheduler、Patch Service、ASR Text Chain

**是否可以进入开发？** 可以 **Phase 1–2**（归档 v1 + 创建 v2 模块骨架）；**Phase 3 切换 active path 前** 须修复 Lexicon Runtime ABI 并通过 Dialog200 gate。**无 shadow 的大切换风险高**，须用测试 gate + KenLM minDelta 控误修。

---

## 1. Current Active Chain Report

### 1.1 主链入口与顺序

```text
runJobPipeline
  → ASR (asr-step.ts)
       ctx.rawAsrText = mergedAsrText          [唯一写点]
       ctx.segmentForJobResult = raw (FW引擎)
  → FW_SPAN_DETECTOR (fw-detector-step.ts)
       runFwDetectorOrchestrator(ctx)
  → AGGREGATION → [5015-5017 enhancement] → DEDUP → TRANSLATION → TTS
  → buildJobResult: text_asr = resolveBusinessAsrText(segmentForJobResult)
                    extra.raw_asr_text = rawAsrText
```

Pipeline 步骤注册：`pipeline/pipeline-step-registry.ts` → `FW_SPAN_DETECTOR: runFwDetectorStep`  
模式约束：`freeze-contract.test.ts` 断言 `ASR → FW_SPAN_DETECTOR → AGGREGATION`，**无** `LEXICON_RECALL` / `SENTENCE_REPAIR` legacy 步骤。

### 1.2 十个必答

| # | 问题 | 代码事实 |
|---|------|----------|
| 1 | FW 后处理入口 | `pipeline/steps/fw-detector-step.ts` → `runFwDetectorOrchestrator` |
| 2 | Detector 调用点 | `fw-detector-orchestrator.ts:307` — `resolveFwSpans(...)` |
| 3 | Detector → Recall | `FwSpanDiagnostics[]` 每 span 的 `span.text` → `recallSpanTopK(runtime, span.text, ...)`（`fw-sentence-rerank-pipeline.ts:121`） |
| 4 | Recall 输入 | **字符串** `spanText`（2–5 音节，`local-span-recall.ts:94-96`）；profile、topK、minPrior、enabledDomains |
| 5 | Sentence Builder 依赖 Detector？ | **否** — 依赖 `FwSpanDiagnostics[]` + `SpanReplacementPick[][]`；**不**依赖 metadata/legacy 信号 |
| 6 | KenLM 依赖 Detector？ | **否** — 依赖 `SentenceCombination[]` + `rawText`（`rerank-fw-sentences.ts`） |
| 7 | Apply 依赖 Detector？ | **否** — 依赖 `FwApprovedReplacement[]`（start/end/candidateText） |
| 8 | **可保留复用** | `recallSpanTopK`、`buildSentenceCandidates`、`rerankFwSentences`、`applyFwSpanReplacements`、`fw-detector-step` 壳、JobContext SSOT、`LexiconRuntime` V2 |
| 9 | **必须从 active path 移除** | `resolveFwSpans`、`selectFwMetadataSpans`、`detectSuspiciousSpansV1`、`selectKenlmSuspiciousSpans`（作为 span 发现主路径）、`mapFwMetadataSpanToFwSpan` 主路径调用、`allowSegmentFallbackScan` |
| 10 | **SSOT（v2 禁止写）** | `rawAsrText`（仅 asr-step）；`segmentForJobResult`（仅白名单文件，v2 模块**不在**白名单）；`asrRepairApplied`；`text_asr` 仅经 result-builder |

### 1.3 segmentForJobResult 写点白名单（冻结）

`freeze-contract.test.ts` 允许：

- `asr-step.ts`、`fw-detector-step.ts`、`fw-detector-orchestrator.ts`
- `aggregation-step.ts`、`enhancement/*`、`post-asr-routing.ts`
- legacy `legacy-apply-sentence-repair.ts`（非 FW 引擎）

**pinyin-ime-v2 模块不得出现在此列表** — 只能通过 orchestrator 的 Apply 路径间接影响 segment。

---

## 2. Pinyin IME V1 Removal Audit

### 2.1 文件清单（`tests/spike/`）

**入口脚本（v1 命名）：**

| 文件 | 用途 |
|------|------|
| `pinyin-ime-v1-export.mjs` | SQLite → 三层词典导出 |
| `pinyin-ime-v1-sidecar.mjs` | HTTP `/decode` |
| `run-pinyin-ime-v1-dialog200.mjs` | Dialog200 批测 |
| `analyze-pinyin-ime-v1.mjs` | 分析报告 |
| `audit-pinyin-ime-v1-kenlm.mjs` | KenLM 联调审计 |
| `import-pinyin-ime-v1-single-char.mjs` | 单字 TSV 导入 |
| `README.md` | v1 spike 说明 |

**Deprecated 转发（应一并移除）：**

| 文件 | 转发 |
|------|------|
| `export-lexicon-v3-ime-dict.mjs` | → v1 export |
| `ime-sidecar-server.mjs` | → v1 sidecar |
| `run-pinyin-ime-dialog200-spike.mjs` | → v1 dialog200 |
| `analyze-pinyin-ime-spike.mjs` | → v1 analyze |

**lib 模块（`tests/spike/lib/`，Spike 实现，未进 main/src）：**

`paths.mjs`, `dict-export-core.mjs`, `dict-load.mjs`, `dict-tsv.mjs`, `dict-weight.mjs`, `ime-dict-decoder.mjs`, `pinyin-stream.mjs`, `diff-align.mjs`, `metrics.mjs`, `subsets.mjs`, `single-char-roles.mjs`, `target-dictionary-index.mjs`, `kenlm-spike.mjs`, `deprecation.mjs`

**数据 / 产物：**

| 路径 | 说明 |
|------|------|
| `data/pinyin-ime-v1/single_char_dictionary.tsv` | 单字数据源 |
| `tmp/pinyin-ime-v1/` | base/domain/target 导出（gitignore） |
| `pinyin-ime-v1-dialog200-results.json` | 批测结果 |
| `pinyin-ime-v1-report-summary.json` | 分析 JSON |
| `tmp/pinyin-ime-v1-span-coverage-audit.json` | Span 审计数据 |

### 2.2 package.json scripts（v1 / deprecated）

```
spike:pinyin-ime-v1:export:all|base|domain|target
spike:pinyin-ime-v1:import:single-char
spike:pinyin-ime-v1:sidecar
spike:pinyin-ime-v1:dialog200|dialog200:sidecar
spike:pinyin-ime-v1:analyze
spike:pinyin-ime-v1:audit:kenlm
spike:ime:export|export:repair|sidecar|dialog200|analyze  (deprecated)
```

### 2.3 docs/pinyin-v1 报告（27+ 文件）

含：V1 开发/测试报告、KenLM/Span/Mainline 审计、Freeze Plan、import TSV、architecture 文档等。

### 2.4 归档 / 删除 / 迁移规则

| 类别 | 处理 |
|------|------|
| **应归档** | 全部 `docs/pinyin-v1/*` → `docs/pinyin-v1/archive/`（保留审计证据） |
| **应删除（Phase 1）** | `tests/spike/pinyin-ime-v1-*`、`tests/spike/lib/*`（v1 实现）、deprecated 转发脚本、v1 npm scripts |
| **可保留为 build 工具（改名 v2）** | 词典导出逻辑概念 → `scripts/pinyin-ime-v2-export` 或 `tools/pinyin-ime-v2/`（**非** runtime second lexicon） |
| **可迁移算法（TS 重写，非 copy）** | `diff-align` 算法、`single-char-roles` 分类、`dict-weight` W-03 公式 |
| **不可迁移** | `ime-dict-decoder.mjs` dict_dp 原样、`kenlm-spike.mjs` WSL 探针、sidecar 作为生产路径、dialog200 脚本直接挂 pipeline |
| **命名** | 主链仅 `pinyin-ime-v2`；禁止 `ime-spike`、`repair-only`、`shadow`、`legacy-detector` 作 active 名 |
| **v1 不进 main/src** | v2 从 **clean module** 开始 |

---

## 3. Pinyin IME V2 Architecture

### 3.1 目标唯一主链

```text
FW ASR (rawAsrText)
  ↓
Pinyin IME V2
  ├─ TopK decode (internal)
  ├─ Diff Span (raw ↔ TopK union)
  └─ Instability Region (TopK 分歧区)
  ↓
ImeHintGate (+ Span Normalizer 合并/扩展 2–6 字)
  ↓
PinyinImeV2ApprovedSpan[] → map → FwSpanDiagnostics[]
  ↓
Lexicon V3.1 recallSpanTopK (不变)
  ↓
buildSentenceCandidates (不变)
  ↓
rerankFwSentences (不变)
  ↓
applyFwSpanReplacements (不变)
  ↓
segmentForJobResult → NMT
```

**禁止：** v2 写 segment / text_asr / 绕过 KenLM / 用 IME candidate 作 Lexicon replacement word。

### 3.2 与旧链对比

| 阶段 | 旧（active） | 新（唯一主链） |
|------|-------------|----------------|
| Span 发现 | Metadata + Legacy fallback | **IME V2 proposal + ImeHintGate** |
| 并行/shadow | N/A | **禁止** |
| Recall 以后 | 相同 | **相同** |

---

## 4. Module Layout Report

### 4.1 方案对比

| 维度 | A: `main/src/fw-detector/pinyin-ime-v2/` | B: `main/src/asr-postprocess/pinyin-ime-v2/` |
|------|------------------------------------------|-----------------------------------------------|
| 与 orchestrator 距离 | **同包，直接调用** | 需新包边界 + 跨包 import |
| Pipeline 集成 | `FW_SPAN_DETECTOR` 已指向 fw-detector | 需改 step registry 或 re-export |
| freeze-contract | 扩展现有 fw-detector 测试 | 新增 asr-postprocess 门禁 |
| 命名一致性 | 与 `fw-detector-orchestrator` 一致 | 更泛化但当前仅 IME 一个消费者 |
| 迁移成本 | **低** | 中–高（新目录 + 文档） |

### 4.2 推荐：**A — `main/src/fw-detector/pinyin-ime-v2/`**

建议结构：

```text
main/src/fw-detector/pinyin-ime-v2/
  index.ts
  pinyin-ime-v2-types.ts
  pinyin-ime-v2-decoder.ts          # 或 -client.ts（同进程优先）
  pinyin-ime-v2-diff-spans.ts
  pinyin-ime-v2-instability.ts
  pinyin-ime-v2-hint-gate.ts
  pinyin-ime-v2-span-normalizer.ts
  pinyin-ime-v2-diagnostics.ts
  map-approved-span-to-fw.ts        # ApprovedSpan → FwSpanDiagnostics
  run-pinyin-ime-v2-span-proposal.ts
```

**不创建** `asr-postprocess/`（YAGNI；唯一消费者是 FW orchestrator）。

---

## 5. Pinyin IME V2 Data Structure Report

### 5.1 建议类型 → 现有类型映射

```typescript
// v2 内部
PinyinImeV2Candidate      → 不进入 Recall；仅 proposal 内部
PinyinImeV2DiffSpan     → ImeHintGate 输入
PinyinImeV2InstabilityRegion → ImeHintGate 输入
PinyinImeV2ApprovedSpan → mapApprovedSpanToFwSpan() → FwSpanDiagnostics
```

**映射函数（类似现有 `mapFwMetadataSpanToFwSpan`）：**

```typescript
function mapApprovedSpanToFwSpan(span: PinyinImeV2ApprovedSpan): FwSpanDiagnostics {
  return {
    text: span.rawSpan,
    start: span.start,
    end: span.end,
    domain: 'general',
    riskScore: span.confidence,
    signals: ['ime_v2_diff_hint'],  // 新增 signal，非 WindowCandidateSource
    candidates: [],
    applied: false,
  };
}
```

### 5.2 必答

| 问题 | 结论 |
|------|------|
| 映射到 FwSpanDiagnostics？ | **是** — 仅 `{text,start,end,signals,candidates:[]}` |
| 直接进入 recallSpanTopK？ | **是** — 通过 `span.text`；须 **normalizer** 满足 2–5 音节 |
| 保留 source 字段？ | **ApprovedSpan 层**可有 `source: "pinyin-ime-v2"`；**Recall hit** 仍用 V3 四类 `WindowCandidateSource`，**不**新增 IME source |
| diagnostics 字段？ | **必须** — 见下表 |
| 破坏 LocalSpanRecallHit？ | **否** — Recall 输入仍为 span 文本 |

### 5.3 建议 diagnostics（FwDetectorResult / JobContext extra）

```
imeCandidateCount
imeDiffSpanCount
imeInstabilityRegionCount
imeApprovedSpanCount
imeRecallCandidateCount
imeKenlmWouldApply
imeApplied
imeRejectedByKenLM
imeNormalizerDroppedCount   // 单字/超长被丢弃
```

---

## 6. Mainline Replacement Point Report

### 6.1 替换点（orchestrator 内部）

**当前（L307–314）：**

```typescript
const spanResolution = await resolveFwSpans(rawText, config, segments, aliasKeys, kenlmScorer);
const spanDiagnostics = spanResolution.spans;
```

**目标（唯一主链）：**

```typescript
const proposal = await runPinyinImeV2SpanProposal(rawText, config.pinyinImeV2);
const approved = runPinyinImeV2HintGate(proposal, rawText, runtime);
const spanDiagnostics = approved.map(mapApprovedSpanToFwSpan);
// 以下不变：recallSpanTopK → runFwSentenceRerankPipeline → apply
```

### 6.2 必答

| 问题 | 答案 |
|------|------|
| 保留 `FW_SPAN_DETECTOR` step 名？ | **是** — 避免 pipeline-mode / freeze 大改；**仅换 orchestrator 内部** |
| 重写 orchestrator 内部？ | **是** — span 阶段替换；Recall/Rerank/Apply **保留** |
| 保留 active `resolveFwSpans`？ | **否** — 唯一主链下 **不得** 调用 |
| legacy detector 从 active 移除？ | **是** — `spanGateMode` / metadata / legacy fallback **不再** 参与 span 发现 |
| Apply 不变？ | **是** — 仍 `applyFwSpanReplacements(rawText, approved)` |
| KenLM 不变？ | **是** — `rerankFwSentences` + `minDeltaToReplace: 0.03` |
| NMT 不变？ | **是** — `resolveBusinessAsrText` 仍只读 `segmentForJobResult` |

### 6.3 空 span 行为

当前：`spanDiagnostics.length === 0` → `segmentForJobResult = rawText`（L316–321）。  
V2 唯一主链：**同样** — 无 approved span 则 passthrough raw，**不** fallback 到 legacy detector。

---

## 7. ImeHintGate Design Report

V2 **不再**使用旧 Detector；ImeHintGate **合并** Span Fusion + Gate（用户架构中 Span Fusion 职责并入 Gate）。

### 7.1 接口

```typescript
runPinyinImeV2HintGate(input: {
  rawAsrText: string;
  diffSpans: PinyinImeV2DiffSpan[];
  instabilityRegions: PinyinImeV2InstabilityRegion[];
  runtime: LexiconRuntime;  // 近邻探测
  config: PinyinImeV2HintGateConfig;
}): { approved: PinyinImeV2ApprovedSpan[]; diagnostics: ... }
```

### 7.2 规则（对齐 Span Coverage 审计）

| 规则 | 参数 |
|------|------|
| Top5 Union | `topK: 5` |
| 合并相邻 span | normalizer |
| 单字默认拒绝 | `dropSingleChar: true` |
| 目标长度 2–6 字 | 对齐 Recall 2–5 **音节** + 中文 char |
| supportCount ≥ 2 提置信 | instability / multi-candidate 投票 |
| 无 Lexicon 近邻降置信/拒绝 | `recallSpanTopK` 空 hit → reject 或 demote |
| 长 span 拆分 / 重叠合并 | normalizer |
| **禁止** IME candidate text 作 replacement | Gate 只输出 **raw 区间** |

### 7.3 与旧 Detector 关系

| 旧组件 | V2 唯一主链 |
|--------|-------------|
| `fw-metadata-span-gate.ts` | **archived，不调用** |
| `suspicious-span-detector-v1.ts` | **archived，不调用** |
| `kenlm-span-selector.ts` | **archived**（KenLM 句级 rerank 仍用） |

---

## 8. Lexicon Recall Compatibility Report

| # | 问题 | 结论 |
|---|------|------|
| 直接消费 `approvedSpan.rawSpan`？ | **是** — 映射为 `FwSpanDiagnostics.text` |
| 长度不符 2–5 音节？ | `skippedReason: 'syllable_out_of_range'` — **必须** `pinyin-ime-v2-span-normalizer.ts` 预处理 |
| 需要 normalizer？ | **是** — 合并 1.87 字碎 span → 2–6 字窗口 |
| 需要 expander？ | **可选** — 对 PARTIAL coverage 区 ±1 字扩展（Phase 3+ 评估） |
| target/domain pinyin 近邻？ | **推荐** — Gate 阶段 `recallSpanTopK` 探测，空则 reject |
| 避免单字进 Recall？ | **是** — normalizer + Gate 默认丢弃单字 |
| 保留 offset？ | **是** — `start/end` 相对 `rawAsrText` |
| 破坏 LocalSpanRecallHit？ | **否** |

**SQLite / Lexicon V3.1：** **无需改表**；仍 `node_runtime/lexicon/v3/lexicon.sqlite` SSOT。

---

## 9. KenLM / Apply Compatibility Report

| 组件 | 复用 | 改动 |
|------|------|------|
| `buildSentenceCandidates` | **是** | 无 |
| `rerankFwSentences` | **是** | 无 |
| `minDeltaToReplace` (0.03) | **保持** | SSOT `freeze-config-ssot.json` |
| `applyFwSpanReplacements` | **是** | 无 |
| `segmentForJobResult` 写点 | **保持** | 仅 orchestrator apply |
| `directRepair` | **禁止** | v2 无 Apply import |
| diagnostics | **扩展** | §5.3 |

**KenLM 延迟：** 主链已用 `createKenlmBatchScorer`（`kenlm-scorer.ts`）；**不**使用 spike WSL 单 query 模式。

---

## 10. Config and Freeze Contract Report

### 10.1 建议配置（唯一主链，无 shadow）

```json
{
  "features": {
    "pinyinImeV2": {
      "enabled": true,
      "topK": 5,
      "directRepair": false,
      "replaceLegacyDetector": true
    }
  }
}
```

**移除/禁止的配置概念：**

- `mode: shadow` — **不允许**
- `legacyDetector.enabled` — **不允许**（与唯一主链冲突）
- `spanGateMode: fw_metadata_gate | legacy_detector` — active path **删除**（可留 archived 文档）

### 10.2 开关策略

| 问题 | 审计建议 |
|------|----------|
| 是否需要 enabled？ | **开发期** `false` → Phase 4 通过后 **true**；唯一主链上线后 enabled **语义** = 整条 FW 修复链开/关（可与 `fwDetector.enabled` 合并评估） |
| 默认 true 还是 false？ | **代码默认 false** 直至 Phase 4 Dialog200 gate；**生产切换** 一次设为 true（无 shadow） |
| 允许 shadow？ | **否** |
| 允许 legacy active？ | **否** — `replaceLegacyDetector: true` 时静态禁止 `resolveFwSpans` 调用 |

### 10.3 freeze-contract 必须新增/修改

**新增：**

1. `replaceLegacyDetector=true` 时 orchestrator **不得** import/调用 `resolveFwSpans`、`selectFwMetadataSpans`、`detectSuspiciousSpansV1`
2. `pinyin-ime-v2/**` **不得** assign `segmentForJobResult`（静态扫描）
3. `pinyin-ime-v2/**` **不得** import `apply-span-replacements`
4. `directRepair` 恒 false（config SSOT + 静态）
5. active path **唯一** — 无 `spanGateMode` 分支（或 gate mode 仅 `pinyin_ime_v2`）
6. 无 `tests/spike/pinyin-ime-v1` 引用（Phase 1 后）

**修改/删除：**

- 现有断言 metadata gate / legacy fallback **为主路径** 的测试 → 改为 archived 或 `@legacy` 套件 disabled

**保持不变：**

- `segmentForJobResult` 写点白名单
- `rawAsrText` 仅 asr-step
- `resolveBusinessAsrText` 无 fallback

---

## 11. Test Plan Report

### 11.1 单元测试

| 模块 | 覆盖 |
|------|------|
| `pinyin-ime-v2-decoder` | TopK 与 spike golden 对齐（选定子集） |
| `pinyin-ime-v2-diff-spans` | d001/d029 FULL 样例 |
| `pinyin-ime-v2-instability` | TopK 分歧区 |
| `pinyin-ime-v2-span-normalizer` | 1.87→2–6 字、单字丢弃 |
| `pinyin-ime-v2-hint-gate` | approve/reject 规则 |
| `map-approved-span-to-fw` | FwSpanDiagnostics 形状 |

### 11.2 集成测试

- `runFwDetectorOrchestrator` + v2：mock Lexicon → Recall → KenLM → Apply
- 断言 **未调用** `resolveFwSpans`

### 11.3 回归（Dialog200）

| 指标 | 门槛（建议） |
|------|--------------|
| imeSpanRecall (Case) | ≥ 70%（基线 76.9%） |
| approvedSpanPrecision | ≥ 40% |
| kenlmWouldApply | 监控 |
| textChangedCount | 监控误修 |
| CER delta vs raw | 不劣化阈值 TBD |
| FW step P95 | < 200ms（decoder）+ KenLM 预算 |

### 11.4 freeze-contract

- no legacy detector active path
- no pinyin-ime-v1 reference in main/src
- no directRepair
- only approvedSpan → recallSpanTopK
- segment write whitelist unchanged

---

## 12. Migration Plan Report

| Phase | 内容 | 双路/shadow |
|-------|------|-------------|
| **Phase 0** | 本轮只读审计 | — |
| **Phase 1** | 归档 v1 spike + docs → `archive/`；删 v1 scripts；**无 main 改动** | 禁止 |
| **Phase 2** | 创建 `pinyin-ime-v2/` 模块 + 单测；**orchestrator 仍旧 Detector** | 禁止 |
| **Phase 3** | **一次性**替换 orchestrator span 阶段；更新 freeze-contract；**无 legacy active** | **禁止 parallel** |
| **Phase 4** | Dialog200 全量 + Span Coverage + CER；Lexicon ABI 修复前置 | 禁止 |
| **Phase 5** | 冻结审计；legacy detector 文件标记 `@deprecated` / 移 `legacy/` | 仅 archived |

**禁止设计：** shadow、parallel detector、legacy fallback active。

**允许：** legacy 代码 archived、legacy 测试 `describe.skip` 或移 `@legacy` 套件。

---

## 13. Risk Assessment Report

| 风险 | 等级 | 缓解 |
|------|------|------|
| **无 shadow 大切换** | **高** | Phase 4 Dialog200 gate 不过不发布；feature flag 仅 dev/staging |
| 移除 Detector 后 span 召回下降 | 中 | 基线 76.9% Case Recall；Gate 规则迭代 |
| IME span precision ~44% | **高** | KenLM minDelta + repairTarget gate + normalizer 拒单字 |
| span 过短 Recall skip | **高** | **normalizer 必须**（2–6 字） |
| Lexicon Runtime ABI 未修复 | **高** | Phase 3 **阻塞项** — 当前批测 Recall 全失败 |
| IME 误修 | 高 | `candidateRequireRepairTarget: true` 保持；KenLM veto |
| v1 移除丢证据 | 低 | docs/archive 保留 |
| freeze-contract 大面积变更 | 中 | 专门 PR + SSOT json 同步 |

---

## 14. Final Recommendation

### 14.1 最终必答（22 问）

| # | 问题 | 答案 |
|---|------|------|
| 1 | 可否建立 v2 唯一主链？ | **可以** — 替换 orchestrator span 阶段，Recall 以后不变 |
| 2 | 是否移除 pinyin-ime-v1？ | **是（Phase 1 归档/删除 spike）** — 不进 main/src |
| 3 | active path 移除 legacy Detector？ | **是** — `resolveFwSpans` 整条不再调用 |
| 4 | 保留旧 Detector 文件？ | **是，archived** — 移 `legacy/` 或 `@deprecated`，不删代码亦可 |
| 5 | 保留 FW_SPAN_DETECTOR 名？ | **是** |
| 6 | v2 目录？ | **`main/src/fw-detector/pinyin-ime-v2/`** |
| 7 | v2 输出结构？ | **TopK（内部）+ DiffSpan + Instability → ApprovedSpan → FwSpanDiagnostics** |
| 8 | 复用 Lexicon Recall？ | **是** — `recallSpanTopK` 不变 |
| 9 | 复用 KenLM？ | **是** — `rerankFwSentences` 不变 |
| 10 | 复用 Apply？ | **是** — `applyFwSpanReplacements` 不变 |
| 11 | 改 SQLite？ | **否** |
| 12 | 改 Scheduler / Patch Service？ | **否** |
| 13 | 改 ASR Text Chain？ | **否** |
| 14 | 第一阶段范围？ | **Phase 1**：v1 归档删除 + v2 目录骨架 + 类型/normalizer/gate 单测（**不改 orchestrator**） |
| 15 | 主要风险？ | **无 shadow 大切换 + span precision + Lexicon ABI + 无 legacy 兜底** |
| 16 | 可否进入开发？ | **可以 Phase 1–2**；**Phase 3 切换前** 须 Lexicon ABI + Dialog200 gate |

### 14.2 与 V1 并行架构审计的差异

| 项 | V1 Mainline Audit（2026-06-03） | V2 唯一主链（本报告） |
|----|----------------------------------|------------------------|
| 架构 | 方案 C 并行 + Fusion | **单路 IME V2 only** |
| shadow | 推荐 Phase 2 | **禁止** |
| legacy Detector | 保留 fallback | **active path 移除** |
| 风险 | 低（可回滚） | **高（大切换）** |
| 适用 | 渐进迁移 | **用户已决策：不并行** |

### 14.3 Phase 1 开发清单（最小）

1. `docs/pinyin-v1/archive/` 迁移全部 v1 报告  
2. 删除 `tests/spike/pinyin-ime-v1-*` + lib + npm scripts  
3. 创建 `main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-types.ts`  
4. 创建 `pinyin-ime-v2-span-normalizer.ts` + `pinyin-ime-v2-hint-gate.ts` + 单测  
5. **不**改 orchestrator、**不**改 SQLite、**不**改 pipeline steps  

---

## 15. Appendix — Key Paths

| 领域 | 路径 |
|------|------|
| Orchestrator（替换点） | `main/src/fw-detector/fw-detector-orchestrator.ts` |
| FW Step | `main/src/pipeline/steps/fw-detector-step.ts` |
| Legacy span（移除 active） | `fw-metadata-span-gate.ts`, `suspicious-span-detector-v1.ts`, `resolveFwSpans` |
| Recall | `main/src/lexicon/local-span-recall.ts` |
| Sentence build | `main/src/fw-detector/build-sentence-candidates.ts` |
| KenLM | `main/src/fw-detector/rerank-fw-sentences.ts` |
| Apply | `main/src/fw-detector/apply-span-replacements.ts` |
| Freeze | `main/src/fw-detector/freeze-contract.test.ts`, `tests/freeze-config-ssot.json` |
| V1 spike（移除） | `tests/spike/pinyin-ime-v1-*` |

---

*Read-only audit — 基于仓库代码与 2026-06-03 Spike 报告数据。未修改任何源码。*
