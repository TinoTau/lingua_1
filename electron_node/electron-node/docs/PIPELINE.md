# 节点端主链（ASR → FW → NMT）

**以代码为准。** 默认引擎 `asr.engine = fw_detector_v1`。  
冻结契约见 [FW_MAINLINE_FREEZE.md](./FW_MAINLINE_FREEZE.md)。

---

## 1. 主链概览

```text
Audio → AudioAggregator
  → faster-whisper-vad (medium, CUDA int8_float16)
  → rawAsrText freeze（asr-step 首段一次）
  → FW_SPAN_DETECTOR
      → FW Metadata Span Gate（selectFwMetadataSpans）
      → Lexicon Runtime V2 Recall（recallSpanTopK）
      → P4 Sentence-Level KenLM Rerank（默认）或 P1.2b per-span topK（回滚）
      → applyFwSpanReplacements
  → AGGREGATION（读写 segmentForJobResult）
  → [5015 / 5016 / 5017 — 默认 OFF，FW apply 后写锁]
  → DEDUP（shouldSend only，不改文本）
  → NMT（segmentForJobResult）
  → result-builder（text_asr ← SSOT；extra.raw_asr_text ← rawAsrText）
```

**Pipeline 步骤顺序：** `ASR → FW_SPAN_DETECTOR → AGGREGATION → …`  
**已移除步骤：** `LEXICON_RECALL`、`SENTENCE_REPAIR`（`pipeline-mode-fw.ts`）

### 1.1 文本 SSOT

| 字段 | 规则 |
|------|------|
| `ctx.rawAsrText` | 仅 `asr-step` 首段写入；immutable；FW 输入 |
| `ctx.segmentForJobResult` | **唯一业务 SSOT**：FW apply / 聚合 / NMT / `text_asr` |
| `ctx.asrText` | diagnostics only；禁止作为 NMT 或聚合输入 |
| `ctx.asrRepairApplied` | FW 有 approved replacement 时为 true；5015/5016/5017 写锁 |
| `extra.raw_asr_text` | 观测用，与 `text_asr` 分离 |

业务文本：`resolveBusinessAsrText(ctx)` = `(ctx.segmentForJobResult ?? '').trim()`，无 fallback。

**Aggregation：**

```ts
currentSegment = (ctx.segmentForJobResult ?? '').trim();
```

segment 空 → `segmentReady=false`，defer/skip Translation。

### 1.2 双开关

| 函数 | 条件 | 效果 |
|------|------|------|
| `isFwDetectorEngineEnabled()` | `asr.engine === fw_detector_v1` | 改 pipeline 步骤；ASR 不拉 n-best |
| `isFwDetectorPipelineActive()` | 上项 + `features.fwDetector.enabled` + zh/yue | 才执行 `FW_SPAN_DETECTOR` |

---

## 2. ASR 与音频聚合

共用框架见 `pipeline/steps/asr-step.ts`、`pipeline-orchestrator/audio-aggregator.ts`。

| 配置 | 行为 |
|------|------|
| `fw_detector_v1`（默认） | `faster-whisper-vad` medium；单 top1；无 CTC n-best；无 rerun |
| 历史 Recover | `asr-sherpa-lm` 等 CTC 路由（见 [RECOVER.md](./RECOVER.md)） |

**路由：** `resolve-preferred-asr-service.ts` → `faster-whisper-vad`；`task-router-asr.ts` 将 CTC 重定向至 FW。

**关键参数（AudioAggregator）：**

| 参数 | 值 |
|------|-----|
| MAX_BUFFER_DURATION_MS | 20000 |
| MIN_AUTO_PROCESS_DURATION_MS | 10000 |
| PENDING_TIMEOUT_AUDIO_TTL_MS | 10000 |
| MIN_ACCUMULATED_DURATION_FOR_ASR_MS | 5000 |
| SPLIT_HANGOVER_MS | 600 |

详见 [AGGREGATOR.md](./AGGREGATOR.md)、[AUDIO_AGGREGATOR_Data_Format.md](./AUDIO_AGGREGATOR_Data_Format.md)。

---

## 3. FW Detector

**代码根：** `main/src/fw-detector/`、`pipeline/steps/fw-detector-step.ts`  
**编排：** `fw-detector-orchestrator.ts`

### 3.1 Span 选择（Metadata Gate — 默认）

`spanGateMode = fw_metadata_gate`（`fw-metadata-span-gate.ts`）

- 主信号：alias exact hit、低词概率（word probability）
- 输入：`rawAsrText`、ASR segments、V2 alias 索引
- 上限：`fwMetadataSpanGate.maxSpans`（默认 4；**SSOT**，无根级 `fwDetector.maxSpans`）

**Legacy fallback**（非主路径，仅 metadata 无候选且 segment 质量差时）：

- 需 `allowSegmentFallbackScan === true`
- 上限 `fallbackLegacyMaxSpans`（默认 1）
- 剥离 `detector_pinyin_hint`；不走 Recover pipeline

**回滚到 KenLM span gate：** `spanGateMode: kenlm_gate_filter`，`kenlmSpanGate.enabled: true`

### 3.2 Recall（Lexicon Runtime V2）

`useLexiconRuntimeV2Recall: true` → `lexicon/local-span-recall.ts` → V2 SQLite  
Bundle：`node_runtime/lexicon/v2_shadow`（见 [../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md)）

- Session intent / profile：`getProfileSnapshotFromContext`
- Domain 过滤：`enabledDomains` + profile `primaryDomain`
- 门限：`recallMinPhoneticScore`（默认 0.5）
- Pick 过滤：`candidateRequireRepairTarget`（仅 `repair_target` 候选）

### 3.3 句级 Rerank（P4 — 默认）

`useSentenceLevelRerank: true` → `runFwSentenceRerankPipeline`

- 组合 span 候选为整句，KenLM batch 打分
- `maxSentenceCandidates: 16`，`minDeltaToReplace: 0.03`
- 输出 approved replacements → `applyFwSpanReplacements`

**回滚 P1.2b：** `useSentenceLevelRerank: false` → `runFwTopKDecisionPipeline`（per-span topK + weak_veto）

### 3.4 Apply

**唯一写回：** `applyFwSpanReplacements`（`apply-span-replacements.ts`）  
D-greedy 非重叠替换（P4 由句级 rerank 产出 approved 列表后一次性 apply）。

### 3.4 enableKenLMGate（P4 必需）

`enableKenLMGate: true` 创建 KenLM batch scorer。P4 句级 rerank 依赖 scorer；若为 false，`rerankFwSentences` 不会 pick 替换（非 weak_veto 可选开关）。  
P1.2b 回滚路径才使用 `kenlmGateMode` / `kenlmVetoThreshold` / `kenlmDeltaThreshold`。

### 3.5 Legacy Recover 边界

- FW 主链 **不** import `legacy/recover`
- `lexicon/local-span-recall.ts`（FW span）≠ 旧 `LEXICON_RECALL` 步骤
- KenLM scorer 共用：`kenlm-scorer.ts`、`kenlm-span-gate.ts`（weak_veto 语义供 P1.2b 使用）

---

## 4. 默认配置

来源：`main/src/node-config-defaults.ts`。运行时覆盖：`%APPDATA%/lingua-electron-node/electron-node-config.json`。

```json
{
  "asr": { "engine": "fw_detector_v1" },
  "features": {
    "lexiconRecall": { "enabled": false },
    "lexiconRuntimeV2": { "enabled": true },
    "semanticRepair": { "enabled": false },
    "phoneticCorrection": { "enabled": false },
    "punctuationRestore": { "enabled": false },
    "fwDetector": {
      "enabled": true,
      "disableAsrRerun": true,
      "spanGateMode": "fw_metadata_gate",
      "kenlmSpanGate": { "enabled": false },
      "useLexiconRuntimeV2Recall": true,
      "useSentenceLevelRerank": true,
      "enableKenLMGate": true,
      "maxSentenceCandidates": 16,
      "minDeltaToReplace": 0.03,
      "minPrior": 0.5,
      "recallMinPhoneticScore": 0.5,
      "candidateRequireRepairTarget": true,
      "enabledDomains": ["tech_ai", "travel", "transport", "restaurant"],
      "fwMetadataSpanGate": {
        "enabled": true,
        "maxSpans": 4,
        "allowAliasExactHit": true,
        "allowSegmentFallbackScan": true,
        "fallbackLegacyMaxSpans": 1
      }
    }
  }
}
```

| 环境变量 | 用途 |
|----------|------|
| `PROJECT_ROOT` | 词库 bundle、domain_anchor（dist 必设） |
| `ASR_MODEL` | 默认 `medium` |
| `ASR_COMPUTE_TYPE` | CUDA 未设时 → `int8_float16` |

---

## 5. 模块索引

| 路径 | 职责 |
|------|------|
| `fw-detector/fw-mode.ts` | 引擎开关、语言判定 |
| `fw-detector/pipeline-mode-fw.ts` | 插入 FW 步骤、移除 Recover |
| `fw-detector/fw-config.ts` | 运行时配置 |
| `fw-detector/fw-metadata-span-gate.ts` | Metadata span 选择 |
| `fw-detector/fw-detector-orchestrator.ts` | gate → recall → rerank → apply |
| `fw-detector/fw-sentence-rerank-pipeline.ts` | P4 句级 KenLM |
| `fw-detector/fw-topk-decision-pipeline.ts` | P1.2b per-span（回滚） |
| `fw-detector/apply-span-replacements.ts` | 局部替换 |
| `lexicon/local-span-recall.ts` | `recallSpanTopK` |
| `lexicon-v2/` | V2 runtime、recall SQL、session intent |
| `pipeline/steps/asr-step.ts` | raw freeze |
| `pipeline/steps/fw-detector-step.ts` | 步骤入口 |
| `pipeline/steps/aggregation-step.ts` | postDetectorSegment |
| `pipeline/post-asr-routing.ts` | segment 写锁 |
| `pipeline/result-builder.ts` | text_asr / raw_asr_text |
| `task-router/faster-whisper-asr-strategy.ts` | disable rerun |

---

## 6. 词库字段（FW Candidate）

```json
{ "word": "美式", "domains": ["restaurant"], "anchor": true, "repair_target": true }
{ "alias": "美食", "canonical": "美式", "repair_target": true }
```

- `repair_target: true` → 可进入 pick 池（需 `candidateRequireRepairTarget`）
- `anchor: true` → 助 domain 场景判断

---

## 7. 验证与批测

```powershell
cd electron_node\electron-node
npm run build:main
npx jest --testPathPattern="fw-detector|freeze-contract|asr-aggregation-contract|repaired-text-not-overwritten"
node scripts/fw-detector-gate.mjs
```

| 门禁 | 位置 |
|------|------|
| 冻结合约 | `main/src/fw-detector/freeze-contract.test.ts` |
| SSOT 一致 | `main/src/fw-detector/freeze-config-ssot.test.ts` |
| Freeze Guard | [FREEZE_GUARD.md](./FREEZE_GUARD.md) |
| Aggregation 契约 | `tests/pipeline/asr-aggregation-contract.test.ts` |
| segment 不被覆盖 | `tests/pipeline/repaired-text-not-overwritten.test.ts` |

**批测（需节点 + PROJECT_ROOT + ASR :6007）：**

```powershell
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/patch-p4-config.mjs          # 镜像冻结默认
node tests/run-lexicon-v2-p4-batch.js "<dialog_200路径>"
```

Restaurant domain 批测：`POST /session-migration/import` 设置 profile（`/run-pipeline-with-audio` 不支持 `profilePrimaryDomain`）。

Mock 集：`lexicon-assets/tests/restaurant_homophone.jsonl`、`false_repair_golden.jsonl`

---

## 8. 冻结后禁止（无解冻审批）

- 恢复 CTC / n-best / sentence repair / ASR rerun 到 FW 主链
- 修改 Metadata Gate 主信号或 P4 rerank 组合逻辑
- 新增 alternate FW writeback（非 `applyFwSpanReplacements`）
- 覆盖 `rawAsrText` 或让 NMT 读 `asrText` / `rawAsrText`
- 5015/5016/5017 默认开启或绕过 segment 写锁

---

## 9. 相关文档

| 文档 | 说明 |
|------|------|
| [FW_MAINLINE_FREEZE.md](./FW_MAINLINE_FREEZE.md) | 冻结范围与回滚开关 |
| [LEXICON.md](./LEXICON.md) | V3 Recover 词库（非 FW 默认） |
| [../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md) | V2 SQLite 构建与 Recall |
| [RECOVER.md](./RECOVER.md) | Recover V5（非默认主链） |
| [SESSION_AFFINITY.md](./SESSION_AFFINITY.md) | Session Intent / profile |
| `services/faster_whisper_vad/README.md` | ASR Python 服务 |
