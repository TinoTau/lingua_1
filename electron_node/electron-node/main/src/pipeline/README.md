# Pipeline 模块

Job 流水线编排：步骤注册、模式推断、文本 SSOT、Result 组装。默认引擎 `asr.engine = fw_detector_v1`。

冻结契约见 [`../fw-detector/README.md`](../fw-detector/README.md)。

---

## 1. 主链概览

```text
Audio → AudioAggregator → ASR (faster-whisper-vad)
  → rawAsrText freeze（asr-step 首段一次）
  → FW_SPAN_DETECTOR（见 fw-detector 模块）
  → AGGREGATION（读写 segmentForJobResult）
  → [5015/5016/5017 — 默认 OFF，FW apply 后写锁]
  → DEDUP → TRANSLATION（NMT）→ TTS
  → buildJobResult（text_asr ← SSOT）
```

**FW 步骤顺序：** `ASR → FW_SPAN_DETECTOR → AGGREGATION → …`  
基础模板 **不含** `LEXICON_RECALL` / `SENTENCE_REPAIR`（由 `pipeline-mode-fw.ts` 注入 FW；legacy 由 `pipeline-mode-legacy-asr-repair.ts` 注入）。

### 1.1 文本 SSOT

| 字段 | 规则 |
|------|------|
| `ctx.rawAsrText` | 仅 `asr-step` 首段写入；immutable；FW 输入 |
| `ctx.segmentForJobResult` | **唯一业务 SSOT**：FW apply / 聚合 / NMT / `text_asr` |
| `ctx.asrText` | diagnostics only；禁止作为 NMT 或聚合输入 |
| `ctx.asrRepairApplied` | FW 有 approved replacement 时为 true；5015/5016/5017 写锁 |
| `extra.raw_asr_text` | 观测用，与 `text_asr` 分离 |

`resolveBusinessAsrText(ctx)` = `(ctx.segmentForJobResult ?? '').trim()`，无 fallback（`post-asr-routing.ts`）。

Aggregation 读段：

```ts
currentSegment = (ctx.segmentForJobResult ?? '').trim();
```

### 1.2 双开关

| 函数 | 条件 |
|------|------|
| `isFwDetectorEngineEnabled()` | `asr.engine === fw_detector_v1` |
| `isFwDetectorPipelineActive()` | 上项 + `features.fwDetector.enabled` + zh/yue |

---

## 2. 目录与职责

| 路径 | 职责 |
|------|------|
| `pipeline-mode-config.ts` | `PIPELINE_MODES`、步骤条件、`inferPipelineMode` |
| `pipeline-mode-fw.ts` | FW：ASR 后插入 `FW_SPAN_DETECTOR` |
| `pipeline-mode-legacy-asr-repair.ts` | 非 FW：AGGREGATION 后注入 legacy 两步 |
| `pipeline-step-registry.ts` | 步骤类型 → 执行函数 |
| `job-pipeline.ts` | `runJobPipeline` 主循环 |
| `steps/asr-step.ts` | ASR、`rawAsrText` freeze |
| `steps/fw-detector-step.ts` | FW 步骤入口 |
| `steps/aggregation-step.ts` | 聚合、`segmentForJobResult` 合并 |
| `steps/translation-step.ts` | NMT，`getTextForTranslation` |
| `post-asr-routing.ts` | 写锁、`resolveBusinessAsrText` |
| `result-builder.ts` | FW / legacy 分发（lazy legacy） |
| `result-builder-fw.ts` | FW extra，零 legacy import |
| `result-builder-legacy.ts` | legacy ASR repair extra |
| `result-builder-core.ts` | `assembleJobResult` 共用 |
| `enhancement/` | 5015/5016/5017（见 [`enhancement/README.md`](enhancement/README.md)） |
| `context/job-context.ts` | 流水线上下文 SSOT |
| `context/legacy-context.ts` | Legacy 观测分区 |

---

## 3. Pipeline 模式

| 模式 | 步骤（FW 下含 FW_SPAN_DETECTOR） |
|------|----------------------------------|
| `GENERAL_VOICE_TRANSLATION` | ASR → … → TRANSLATION → TTS |
| `SUBTITLE_MODE` | 无 TTS |
| `ASR_ONLY` | 无 NMT/TTS |
| `TEXT_TRANSLATION` | 仅 TRANSLATION |

非 FW 引擎：`finalizePipelineMode` → `applyLegacyAsrRepairPipelineMode`，在 AGGREGATION 后追加 `LEXICON_RECALL` → `SENTENCE_REPAIR`。

---

## 4. Result Builder

```typescript
// result-builder.ts
if (isFwDetectorEngineEnabled()) return buildFwJobResult(job, ctx);
return require('./result-builder-legacy').buildLegacyJobResult(job, ctx);
```

FW 路径 **不** 输出 `asr_repair_*`、`sentence_repair`、`asr_nbest` 等 legacy 字段。

---

## 5. Enhancement（5015/5016/5017）

注册在 AGGREGATION 之后。默认 `enabled: false`。

当 `ctx.asrRepairApplied === true`，`isSegmentWriteLocked` 阻止 enhancement 覆盖 `segmentForJobResult`。

---

## 6. 默认配置摘要

来源：`node-config-defaults.ts`；运行时：`%APPDATA%/lingua-electron-node/electron-node-config.json`。

| 键 | 默认 |
|----|------|
| `asr.engine` | `fw_detector_v1` |
| `features.lexiconRecall.enabled` | `false` |
| `features.semanticRepair.enabled` | `false` |
| `features.phoneticCorrection.enabled` | `false` |
| `features.punctuationRestore.enabled` | `false` |
| `features.fwDetector.enabled` | `true` |
| `features.lexiconRuntimeV2.enabled` | `true` |

完整 FW 键见 [`../fw-detector/README.md`](../fw-detector/README.md)。

---

## 7. 验证

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|pipeline-job-flow|asr-aggregation-contract"
node scripts/fw-detector-gate.mjs
```

---

## 相关文档

| 文档 | 路径 |
|------|------|
| FW 主链与冻结 | [`../fw-detector/README.md`](../fw-detector/README.md) |
| Legacy ASR repair | [`../legacy/asr-repair/README.md`](../legacy/asr-repair/README.md) |
| 音频聚合 | [`../pipeline-orchestrator/README.md`](../pipeline-orchestrator/README.md) |
| 节点配置 | [`../../../docs/CONFIGURATION.md`](../../../docs/CONFIGURATION.md) |
| Task Router | [`../task-router/README.md`](../task-router/README.md) |
