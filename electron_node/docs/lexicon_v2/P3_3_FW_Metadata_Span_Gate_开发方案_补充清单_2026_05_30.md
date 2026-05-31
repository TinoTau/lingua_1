# P3.3 FW Metadata Span Gate 开发方案 — 补充约束与开发清单

版本：V1.0  
日期：2026-05-30  
依据：`P3_3_FW_Metadata_Span_Gate_开发方案_2026_05_30.md` + `Lexicon_Runtime_V2_FW_Metadata_Span_Gate_开发前只读审计报告_2026_05_30.md` + **当前仓库代码对照**  
类型：开发前补充（只读审计延伸，不含实现）

---

## 1. 文档目的

对照 P3.3 开发方案与 **实际代码 / P3.2 遗留 / 冻结合约 / 批测基线**，列出：

1. 方案中 **未写清或需修正** 的实现细节  
2. 开发时必须遵守的 **硬约束**  
3. 方案 Target List **遗漏的文件与任务**  
4. 验收前的 **Check List（可勾选）**

---

## 2. 执行摘要：必须补充的 Top 15

| # | 问题 | 补充要求 |
|---|------|----------|
| 1 | 配置结构过简 | 阈值应置于 **`fwMetadataSpanGate` 子对象**，非与 `spanGateMode` 平铺；见 §4 |
| 2 | `spanGateMode` 类型未扩展 | 代码仅 `'legacy_detector' \| 'kenlm_gate_filter'`（`types.ts:12`）；须增 **`fw_metadata_gate`** |
| 3 | 默认仍为 KenLM gate | `node-config-defaults.ts` 现 **`spanGateMode: 'kenlm_gate_filter'`**；切换 P3.3 须 **同时** `kenlmSpanGate.enabled: false` |
| 4 | `loadFwDetectorRuntimeConfig` 二选一逻辑 | L83：`!== legacy_detector` 则全落 KenLM gate；须改为 **三向解析** + `isFwMetadataSpanGateActive()` |
| 5 | orchestrator KenLM scorer 误创建 | L271–272：`spanGateActive` 会在 span 阶段创建 scorer；**metadata gate 禁止** span 阶段 KenLM query |
| 6 | Gate 输入 SSOT 未写明 | **仅用** `ctx.rawAsrText` + `ctx.asrSegments ?? ctx.asrResult?.segments`；**禁止** `segmentForJobResult` |
| 7 | Python dedup 丢 metadata | `text_processing.update_segments_after_deduplication()` 会 **重建 segments 并清空 no_speech_prob**；words/avg_logprob **必须在 dedup 后重对齐**（P0 阻塞项） |
| 8 | IPC 链路未列全 | 除 worker 外须同步 **`result_listener.py`**（L110–117 仅 4 字段） |
| 9 | `FwSpanDiagnostics` 映射未定义 | 须 `mapFwMetadataSpanToFwSpan()`：`domain:'general'`、`candidates:[]`、`applied:false`、新 `signals` |
| 10 | alias exact hit 无子串 API | `LexiconRuntime.lookupAliasExactMatches(text)` 仅 **整串 lookup**；gate 需 **alias 键集合子串扫描**（新 API 或启动时 AC 自动机） |
| 11 | `confusions.jsonl` 为空 | 勿依赖 `data/lexicon/confusions.jsonl`；MVP alias 来自 **lexicon `aliases` 字段**（`alias-index.ts`） |
| 12 | V2 Recall 批测 flag 未写 | dialog_200 须 **`useLexiconRuntimeV2Recall: true`**、`useIndustryRouting: false`、SQL LIMIT **2/3/0** |
| 13 | `repair_target` 门控仍在 | 默认 `candidateRequireRepairTarget: true`；metadata gate **不解决** Pick 过宽；验收 **FW apply 接近 Phase 2** 可能仍需调参 |
| 14 | legacy fallback 未入方案 | 审计 MVP 含 **`allowSegmentFallbackScan` + `fallbackLegacyMaxSpans: 1`**；方案配置节缺失 |
| 15 | 冻结合约静态检查 | `freeze-contract.test.ts` / `fw-detector-gate.mjs` 要求 orchestrator **保留** `createSpanDetectorHint`（legacy 分支）；新增 gate **不得** import lexicon recall |

---

## 3. 方案与代码差异（需修正的设计点）

### 3.1 配置 JSON（方案 §配置 vs 代码）

**方案现状（不完整）：**

```json
{
  "spanGateMode": "fw_metadata_gate",
  "maxSpans": 2,
  "wordProbabilityThreshold": 0.65,
  "segmentAvgLogprobThreshold": -1.0
}
```

**应对齐代码惯例（`node-config-types.ts` / P3.2 模式）：**

```json
{
  "features": {
    "fwDetector": {
      "spanGateMode": "fw_metadata_gate",
      "useLexiconRuntimeV2Recall": true,
      "useIndustryRouting": false,
      "kenlmSpanGate": { "enabled": false },
      "fwMetadataSpanGate": {
        "enabled": true,
        "maxSpans": 2,
        "minSpanChars": 2,
        "maxSpanChars": 4,
        "wordProbabilityThreshold": 0.65,
        "segmentAvgLogprobThreshold": -1.0,
        "compressionRatioThreshold": 2.4,
        "noSpeechProbThreshold": 0.5,
        "allowAliasExactHit": true,
        "allowSegmentFallbackScan": true,
        "fallbackLegacyMaxSpans": 1
      }
    },
    "lexiconRuntimeV2": {
      "maxBaseCandidates": 2,
      "maxDomainCandidates": 3,
      "maxIdiomCandidates": 0
    }
  }
}
```

**说明：**

- `maxSpans` 在 FW 配置中 **已有顶层** `fwDetector.maxSpans`（默认 2）；`fwMetadataSpanGate.maxSpans` 应与之一致或显式文档化优先级  
- `compressionRatioThreshold` / `noSpeechProbThreshold` 在方案 Span 优先级中已列出，但 **配置节缺失**  
- `electron-node-config.example.json` **无 `fwDetector` 段**；开发后应补充示例（非阻塞）

### 3.2 `resolveFwSpans` 分支顺序（orchestrator）

**当前代码**（`fw-detector-orchestrator.ts:130–158`）：

```text
if (isKenlmSpanGateActive) → selectKenlmSuspiciousSpans  // P3.2，已否决作默认
else → detectSuspiciousSpansV1                           // legacy
```

**P3.3 须改为：**

```text
if (isFwMetadataSpanGateActive) → selectFwMetadataSpans     // 新增，无 KenLM
else if (isKenlmSpanGateActive) → selectKenlmSuspiciousSpans  // 保留回滚
else → detectSuspiciousSpansV1                              // legacy 回滚
```

**KenLM scorer 创建条件须改为：**

```typescript
// 仅 weak_veto 阶段需要 scorer；metadata gate 不参与 spanGateActive
const kenlmScorer = enableKenLMGate ? createKenlmBatchScorer() : null;
// 删除：enableKenLMGate || spanGateActive
```

否则 metadata 模式仍可能因 `kenlmSpanGate.enabled` 误触 span 阶段 scorer（若配置未清理干净）。

### 3.3 `FwSpanDiagnostics` 映射（方案未写）

参照 P3.2 `mapKenlmGateSpanToFwSpan`（`kenlm-span-selector.ts:137–147），metadata gate 映射 **必填**：

| 字段 | 值 |
|------|-----|
| `text/start/end` | 字符 offset（与 apply 一致） |
| `domain` | `'general'`（或 alias 命中 domain，optional P1） |
| `riskScore` | gate 内部排序分（如 `1 - probability`） |
| `signals` | 见 §3.4 |
| `candidates` | `[]` |
| `applied` | `false` |

**禁止**在 span 上添加不存在的 `source` 字段；diagnostics 写入 `FwDetectorResult.fwMetadataSpanGate`。

### 3.4 新增 `FwDetectorSignal`（`types.ts`）

方案优先级 1–5 须落到 signal union：

| 优先级 | reason | 建议 signal |
|--------|--------|-------------|
| 1 | alias_exact_hit | `'alias_exact_hit'`（**新增**） |
| 2 | low_word_probability | `'low_word_probability'`（**新增**） |
| 3 | low_segment_avg_logprob | `'low_segment_avg_logprob'`（**新增**） |
| 4 | high_compression_ratio | 可复用或新增 `'high_compression_ratio'` |
| 5 | high_no_speech_prob | 可复用 `'low_no_speech_prob'`（注意：legacy 命名表示 **高** no_speech_prob） |

**禁止** metadata gate 路径出现 `'detector_pinyin_hint'`（P3 Phase 3 根因之一）。

### 3.5 Gate 输入文本与 segments

| 来源 | 字段 | 约束 |
|------|------|------|
| 文本 | `ctx.rawAsrText` | orchestrator L191 已正确 |
| Segments | `ctx.asrSegments ?? ctx.asrResult?.segments` | L269 |
| 禁止 | `ctx.segmentForJobResult` | aggregation 前等于 raw，但 **违反 SSOT 冻结** |

**多段 ASR：** `asr-step.ts` L268–269 会 **concat** 多 batch 的 segments；gate 须在整个 `ctx.asrSegments` 上对齐，而非仅首段。

### 3.6 words → 字符 offset 对齐（方案未写算法）

MVP 算法（审计 §4.3，开发必实现）：

1. 对每个 segment，维护 cursor，对 `words[].word` 在 `segment.text`（或 `rawText`）上 **顺序 indexOf**  
2. 填充 `charStart/charEnd`（可选挂在 gate 内部，不必扩展 HTTP `AsrWordInfo`）  
3. 对齐失败计数写入 `diagnostics.alignmentFailures`  
4. Fallback：`avg_logprob` 低 → 整段 1 span（`fallbackLegacyMaxSpans=1`）或 0 span  
5. 中文无空格：依赖 Whisper 字/词级 `word_timestamps`，**勿**依赖 dedup 的空格 split

### 3.7 alias exact hit 实现约束

| 项 | 现状 | P3.3 要求 |
|----|------|-----------|
| `lookupAliasExactMatches` | Map.get(整词) | 不能用于子串 |
| `aliasExactIndex` keys | 启动时 built | 可迭代键做 bounded scan |
| 扫描范围 | — | **仅 alias 键**，禁止扫 base_lexicon 全表 |
| `confusions.jsonl` | **空文件** | MVP 不用 |
| `phonetic-correction/confusion-set.ts` | 5016 路径 | **与 FW gate 隔离** |

**建议新增（择一）：**

- `LexiconRuntime.listAliasExactKeys(): string[]` + 长度降序 greedy 子串匹配  
- 或 startup 构建 Aho-Corasick（alias 规模可控时）

### 3.8 legacy fallback 边界

方案未写但审计 MVP 要求：

- 仅当 **`allowSegmentFallbackScan: true`** 且（无 words 或 alignment 失败）且 segment `avg_logprob` 低于阈值  
- 调用 **`detectSuspiciousSpansV1`**，但 **`spanDetectBudget` 强制为 `fallbackLegacyMaxSpans`（1）**  
- fallback 内 **仍禁止** 单独因 `detector_pinyin_hint` 产出 span（可过滤 signals 或提高 minRiskScore）

---

## 4. Python 服务补充（方案 §Python 改造）

### 4.1 须改文件（方案 Target 遗漏）

| 文件 | 现状 | 补充动作 |
|------|------|----------|
| `asr_worker_process.py` | 无 `word_timestamps` | P0 |
| `shared_types.py` | Segment 4 字段 | + WordInfo, avg_logprob, compression_ratio |
| `api_models.py` / `text_processing.py` | 同步 Pydantic | + dedup 后 metadata 保留 |
| `utterance_asr.py` | 映射 4 字段 | 扩展 |
| **`result_listener.py`** | L110–117 丢新字段 | **必须同步** |
| `asr_worker_manager.py` | 无改动需求 | 确认 IPC dict 透传 |

### 4.2 dedup 路径（P0 阻塞）

`text_processing.update_segments_after_deduplication()` 行为：

- 文本变化 → **按空格 split 重建 segments**  
- **丢失** `no_speech_prob`；时间戳仅首尾粗保留  
- 中文常 **单 segment 全句**

**硬约束（三选一，开发前定案）：**

1. **推荐：** dedup 后对 `deduplicated_text` 重新跑 words 对齐（若 text 仅 dedup 未改结构则保留原 words）  
2. dedup 修改 text 时 **丢弃 words**，Node gate 走 avg_logprob fallback  
3. FW 模式禁用 destructive dedup（影响面大，不推荐）

### 4.3 transcribe 参数

- 须显式 `word_timestamps=True`  
- `compression_ratio_threshold` / `log_prob_threshold` 仍为 **过滤参数**；输出侧须 **额外读取** `seg.compression_ratio` / `seg.avg_logprob`（与 threshold 不同概念）  
- FW 模式 Node 已 `beam_size: 1`（`faster-whisper-asr-strategy.ts:44`），metadata 稳定

---

## 5. Node 数据结构补充

### 5.1 `SegmentInfo` 扩展（方案已有草案）

须同步修改 **所有** 4 字段副本：

| 文件 | 需同步 |
|------|--------|
| `task-router/types.ts` | ✅ 主类型 |
| `faster-whisper-asr-strategy.ts` | HTTP 映射 |
| `inference-service.ts` L51–56 | JobResult segments 类型 |
| `agent/aggregator-middleware.ts` | segments 参数类型 |

全部新字段 **`optional`**，保证旧服务 backward compatible。

### 5.2 不建议 MVP 扩展

| 项 | 原因 |
|----|------|
| `segment.tokens` | 无 token logprob；审计不建议 |
| n-best / beam alternatives | `candidate-provider.ts` 确认 FW 不支持 |
| `ctx.asrMetadata` 独立字段 | 可选；MVP 可直接用 `ctx.asrResult.segments` |

### 5.3 Diagnostics 输出

`FwDetectorResult` 须新增：

```typescript
fwMetadataSpanGate?: FwMetadataSpanGateDiagnostics;
```

建议字段：`mode`, `wordCount`, `lowConfidenceWordCount`, `selectedCount`, `alignmentFailures`, `skippedReason`, `fwMetadataGateMs`（应 ≪ P3.2 的 12s）。

`configSnapshot` 须含 `spanGateMode` + `fwMetadataSpanGate`（P3.2 已含 kenlmSpanGate 先例）。

---

## 6. 与 Lexicon V2 / KenLM 关系（方案未写清）

### 6.1 V2 Recall 前置条件

```typescript
// lexicon-fw-recall-config.ts
useLexiconRuntimeV2Recall === true  // 且 lexiconRuntimeV2.enabled
useIndustryRouting === false        // Phase 3 Only 批测
```

**gate 不得读取：**

- `getLexiconSessionIntentFromContext`（topicKeywords）  
- `sessionIntent` 仅允许在 **recall 阶段** orchestrator 已实现的 `runWithLexiconRecallContext` 内（现有行为）

### 6.2 KenLM 职责边界

| 模块 | P3.3 |
|------|------|
| `kenlm-span-selector.ts` | **不修改**；KenLM gate 保留作回滚 |
| `kenlm-span-gate.ts` | **不修改**；仅 weak_veto |
| span 阶段 KenLM query | **0** |
| veto 阶段 | `enableKenLMGate: true`（默认保持） |

### 6.3 P3.2 遗留与切换

| 项 | 动作 |
|----|------|
| 默认 `spanGateMode` | `kenlm_gate_filter` → **`fw_metadata_gate`** |
| `kenlmSpanGate.enabled` | `true` → **`false`** |
| P3.2 批测脚本 | 保留；新增 P3.3 脚本或参数 `--gate metadata` |
| APPDATA 运行时配置 | 批测前须手动/脚本更新（与 P3.2 相同坑） |

---

## 7. 方案 Target List 遗漏项

### 7.1 P0 遗漏（必须加入）

| 文件 | 任务 |
|------|------|
| `fw-detector/fw-config.ts` | `FwMetadataSpanGateRuntimeConfig`、`isFwMetadataSpanGateActive()`、三向 `spanGateMode` 解析 |
| `fw-detector/types.ts` | `FwSpanGateMode` + signals + `FwMetadataSpanGateDiagnostics` |
| `node-config-types.ts` | `fwMetadataSpanGate` 类型 |
| `node-config-defaults.ts` | 默认切换 + `kenlmSpanGate.enabled: false` |
| `fw-detector/fw-detector-orchestrator.ts` | 分支 + scorer 条件 + diagnostics |
| `fw-detector/map-fw-metadata-span.ts` 或 gate 内映射 | `mapFwMetadataSpanToFwSpan` |
| `lexicon/lexicon-runtime.ts` | alias 子串扫描 API（或 gate 内 AC） |
| `services/.../result_listener.py` | IPC 字段 |
| `services/.../text_processing.py` | dedup metadata 策略 |
| `tests/fw-metadata-span-gate.test.ts` | 单元测试 |
| `tests/run-lexicon-v2-phase3-p33-batch.js` | 批测（可复制 p32 改 config/diagnostics） |
| `tests/analyze-phase3-p33-audit.mjs` | 分析 span/job、gate ms、无 kenlmSpanGate query |

### 7.2 P1 遗漏

| 文件 | 任务 |
|------|------|
| `fw-detector/freeze-contract.test.ts` | 断言默认 `fw_metadata_gate` 或 gate 分支存在 |
| `scripts/fw-detector-gate.mjs` | metadata gate 文件 **不得** import `local-span-recall` |
| `electron-node-config.example.json` | 文档化 fwMetadataSpanGate |
| `inference-service.ts` | segments 类型 optional 扩展 |

### 7.3 明确不改

| 文件 | 原因 |
|------|------|
| `asr-repair/kenlm-span-gate.ts` | weak_veto 冻结 |
| `fw-topk-decision-pipeline.ts` | 决策链冻结 |
| `suspicious-span-detector-v1.ts` | legacy/fallback 保留 |
| CTC 服务 / Recover 路径 | 冻结 |
| 主链 step 顺序 | 冻结 |

---

## 8. 测试设计补充

### 8.1 单元测试（方案 P1 细化）

| 用例 | 断言 |
|------|------|
| metadata mapping | HTTP fixture → `SegmentInfo.words[0].probability` |
| 中文对齐 | 「我要中杯咖啡」低 prob 字 → 正确 char offset |
| alias hit | rawText 含「钟贝」→ span + `alias_exact_hit` |
| maxSpans=2 | 多信号竞争只保留 2 |
| no metadata | segments 无 words 且无低 avg_logprob → 0 span |
| no pinyin hint | metadata gate 产出 spans **无** `detector_pinyin_hint` |
| fallback legacy | words 缺失 + 低 avg_logprob → ≤1 span |
| overlap 合并 | alias span 与 low prob 重叠 → 去重 |

### 8.2 dialog_200 批测配置清单

批测前 **APPDATA** `%APPDATA%\lingua-electron-node\electron-node-config.json` 须确认：

```json
{
  "asr": { "engine": "fw_detector_v1" },
  "features": {
    "lexiconRuntimeV2": { "enabled": true, "maxBaseCandidates": 2, "maxDomainCandidates": 3, "maxIdiomCandidates": 0 },
    "fwDetector": {
      "enabled": true,
      "spanGateMode": "fw_metadata_gate",
      "kenlmSpanGate": { "enabled": false },
      "useLexiconRuntimeV2Recall": true,
      "useIndustryRouting": false
    }
  }
}
```

重启 Electron 节点后跑批测（P3.2 经验：改 config 不重启不生效）。

### 8.3 验收指标（对齐 Phase 2 / P3.2 基线）

| 指标 | Phase 2 | P3.2 KenLM gate | P3.3 目标 |
|------|---------|-----------------|-----------|
| span/job | ~12* | ≤2 | **≤2** |
| FW apply | 10 | 0（63条） | **≈5–20** |
| avg CER final | 35.93% | 37.73%（63条） | **≤35.93%** |
| fw_degraded | 0 | 0 | **0** |
| pipeline P95 | 7458ms | 16060ms（63条） | **接近 Phase 2** |
| fw_detector_step_ms | 低 | ~11906（gate） | **无 ~12s KenLM gate** |
| kenlmSpanGateQueryCount | 0 | ~20/job | **0** |

\*legacy detector budget=12，非 metadata 问题。

---

## 9. 硬约束 Check List（开发前勾选）

### 9.1 架构 / 冻结

- [ ] 不修改 CTC 服务（`asr-sherpa-lm` / `asr-sherpa-en`）
- [ ] 不修改 Recover 路径
- [ ] 不修改主链顺序：ASR → FW_SPAN_DETECTOR → AGGREGATION → DEDUP → TRANSLATION
- [ ] 不修改 `kenlm-span-gate.ts` weak_veto 语义
- [ ] span 阶段 **0** KenLM query（metadata gate）
- [ ] Gate 输入 **仅** `rawAsrText` + ASR segments metadata
- [ ] 不让 Lexicon / topicKeywords **反推 span**
- [ ] metadata gate **禁止** `detector_pinyin_hint` 单独产出 span
- [ ] orchestrator **保留** `createSpanDetectorHint`（legacy/fallback + 冻结合约）

### 9.2 Python

- [ ] `word_timestamps=True` 已开启
- [ ] worker + result_listener + HTTP 全链路传递 words/avg_logprob/compression_ratio
- [ ] dedup 策略已定义且不会静默丢弃 metadata

### 9.3 Node

- [ ] `FwSpanGateMode` 含 `fw_metadata_gate`
- [ ] 默认 `kenlmSpanGate.enabled: false`
- [ ] `resolveFwSpans` 三分支 + scorer 仅 veto
- [ ] `mapFwMetadataSpanToFwSpan` 完整映射
- [ ] alias 扫描 **不** 遍历 base_lexicon
- [ ] 0 span 早退：跳过 `runFwTopKDecisionPipeline`，`reason=no_spans`
- [ ] `freeze-contract.test.ts` PASS
- [ ] `fw-detector-gate.mjs` PASS

### 9.4 批测 / 验收

- [ ] `useLexiconRuntimeV2Recall: true`，`useIndustryRouting: false`
- [ ] span/job ≤ 2
- [ ] recall invocation 较 legacy ↓≥80%
- [ ] FW degrade = 0
- [ ] CER ≤ Phase 2（35.93%）
- [ ] cafe/中杯类 case 至少部分恢复 apply
- [ ] CTC 测试不 import metadata gate

---

## 10. 风险与回滚

| 风险 | 等级 | 缓解 |
|------|------|------|
| dedup 破坏 words 对齐 | **高** | §4.2 定案；单测覆盖 dedup 后 text |
| word.probability 阈值过严 → 0 apply | 中 | alias 优先；可调 threshold；别重复 P3.2 |
| word.probability 过松 → 误触 | 中 | maxSpans=2 + weak_veto + repair_target |
| alias 表不全 | 中 | 依赖 lexicon 维护；非全库扫描 |
| `repair_target` 仍挡 apply | 中 | 验收失败时调 `candidateRequireRepairTarget`（单独变更需评审） |
| 配置未重启节点 | 低 | 批测 checklist 强制 health + config 快照 |

**回滚顺序：**

1. `spanGateMode: 'legacy_detector'`（恢复 ~12 span，已知行为）  
2. `spanGateMode: 'kenlm_gate_filter'` + `kenlmSpanGate.enabled: true`（P3.2，不推荐）  
3. `fwDetector.enabled: false`  
4. `useLexiconRuntimeV2Recall: false`（Phase 2 词库路径）

---

## 11. 与 P3.3 原方案章节对照

| 原方案章节 | 补充状态 |
|------------|----------|
| 核心目标 | ✅ 一致 |
| 架构 | ⚠️ 须写明 KenLM scorer 仅 veto、P3.2 分支保留 |
| Python 改造 | ⚠️ 缺 result_listener、dedup、IPC |
| Node 数据结构 | ⚠️ 缺 inference-service、optional 约束 |
| Metadata Span Gate | ⚠️ 缺映射函数、对齐算法、diagnostics |
| Span 来源优先级 | ⚠️ 缺 fallback legacy、signal 类型 |
| 配置 | ⚠️ 须改为嵌套 `fwMetadataSpanGate` + V2 flags |
| Target List P0 | ⚠️ 缺 ≥10 个文件（§7） |
| Check List | ⚠️ 缺 SSOT、V2、批测 APPDATA、repair_target |

---

## 12. 建议开发顺序（在方案 P0 之上）

1. Python spike：`word_timestamps=True` + 中文样例 utterance 打印 words  
2. 定案 dedup metadata 策略  
3. Node `SegmentInfo` 扩展 + HTTP 映射  
4. `fw-metadata-span-gate.ts` 纯函数 + 单测（fixture JSON）  
5. alias 子串 API + exact hit  
6. `fw-config` / `orchestrator` 接入  
7. 关闭 KenLM gate 默认  
8. dialog_200 批测 + 对比 Phase 2 / P3.2  

---

**对照完成。未修改任何代码。**

开发依据：

- `P3_3_FW_Metadata_Span_Gate_开发方案_2026_05_30.md`
- `Lexicon_Runtime_V2_FW_Metadata_Span_Gate_开发前只读审计报告_2026_05_30.md`
- 当前分支代码（`fw-config.ts`、`fw-detector-orchestrator.ts`、`types.ts`、`node-config-defaults.ts` 等）
