# ASR→FW 主链冻结规范（FINAL）

版本：FINAL V1.0  
日期：2026-05-30  
适用范围：`electron-node` — `ASR → FW_SPAN_DETECTOR → AGGREGATION → DEDUP → TRANSLATION`  
状态：**冻结**（P0/P1 清理已完成；P2 Recover 物理隔离与 wire 改名待后续 PR）

---

## 1. 执行摘要

FW-only 主链已冻结并通过 dialog_200 × 50 回归。业务文本 **唯一 SSOT** 为 `ctx.segmentForJobResult`。  
`rawAsrText` 保留为 immutable ASR 原文；`asrText` 仅 diagnostics；`repairedText` 已退出 JobContext 主链。  
P0 删除全部 `asrText` / `rawAsrText` fallback；P1 FW 模式 Result extra 最小化；Recover 代码仍存在于仓库但不在默认主链执行。

---

## 2. 冻结范围

### 2.1 主链步骤（不可改序）

```text
ASR
→ FW_SPAN_DETECTOR
→ AGGREGATION
→ DEDUP
→ TRANSLATION
```

### 2.2 默认不进入主链

- CTC / Sherpa / n-best 句级 Recover
- `LEXICON_RECALL` / `SENTENCE_REPAIR` pipeline 步骤
- ASR rerun / secondary decode
- `pinyin-probe.ts`（已删除）

### 2.3 默认配置

- `asr.engine = fw_detector_v1`
- `features.fwDetector.enabled = true`
- `features.lexiconRecall.enabled = false`

---

## 3. 字段架构

| 字段 | 写入点 | 用途 | 禁止 |
|------|--------|------|------|
| `rawAsrText` | `asr-step` 首段一次 | FW Detector 输入、`extra.raw_asr_text`、审计 | 业务 fallback、二次覆盖 |
| `segmentForJobResult` | FW apply / Aggregation / 5015·5016·5017 | **唯一业务 SSOT**：NMT、`text_asr`、Dedup | 从 `asrText`/`rawAsrText` 回退读取 |
| `asrText` | ASR 拼接 | diagnostics / debug | NMT、text_asr、Aggregation currentSegment |
| `asrRepairApplied` | FW 有 approved replacement | segment 写锁（5015/5016/5017 不得覆盖） | — |

**已删除（JobContext）：** `repairedText`、`shouldSendToSemanticRepair`（JobContext 级）、`syncRepairedTextBaseline`、`isRecoverWriteLocked`（别名）

---

## 4. 主链步骤契约

### 4.1 ASR

- 路由：`faster-whisper-vad`（`resolve-preferred-asr-service.ts`）
- FW 引擎不写 n-best；首段 freeze `rawAsrText`
- 初始化 `segmentForJobResult`（通常 = ASR 文本，供 FW 前段使用）

### 4.2 FW_SPAN_DETECTOR

- 输入：`rawAsrText`（immutable）
- 输出：写 `segmentForJobResult`（apply 后）；`fwDetectorResult` → extra
- 分层：detect（无 lexicon）→ recall/decision（orchestrator）→ apply

### 4.3 AGGREGATION

```ts
currentSegment = (ctx.segmentForJobResult ?? '').trim();
```

- segment 空 → `segmentReady=false`，defer / skip Translation
- **禁止** `detectorSegment || ctx.asrText` 等 fallback
- defer 只改门控 flag，不清 segment

### 4.4 DEDUP → TRANSLATION

- 输入：`resolveBusinessAsrText(ctx)` = segment trim
- segment 空 → skip NMT

---

## 5. FW Detector 契约

详见 `electron-node/docs/FW_DETECTOR.md`。核心：

- Detector 层禁止 `recallSpanTopK` / `repairTarget` 门控
- Candidate 层：`recallSpanTopK` + KenLM `weak_veto` + D-greedy apply
- `candidateRequireRepairTarget: true`（默认）
- orchestrator 不接 `span-replacement-eval`

---

## 6. Aggregation 契约

- `AggregationResult.shouldSendToSemanticRepair` 仍为 **AggregationStage 输出字段**（非 JobContext）
- `aggregation-step` 用其决定 `wantsPostAsrPipeline`；JobContext 仅保留 `shouldRunSemanticRepairHttp` 等门控 flag

---

## 7. Translation 契约

```ts
export function resolveBusinessAsrText(ctx: JobContext): string {
  return (ctx.segmentForJobResult ?? '').trim();
}
```

- `getTextForTranslation` 与 `buildJobResult.text_asr` 同源
- 无 `resolveBusinessAsrTextSource`；无 fallback 链

---

## 8. Result 契约

### 8.1 text_asr

```ts
text_asr = resolveBusinessAsrText(ctx);
```

### 8.2 FW 模式 extra（最小）

```ts
{
  raw_asr_text,
  fw_detector,
  lexicon_runtime_status,
  lexicon_manifest_version,
  aggregation / session / diagnostics ...
}
```

**FW 默认禁止输出：** `sentence_repair`、`window_candidates`、`ctc_nbest_preserved`、Recover 专用结构

### 8.3 Recover 模式

- 仍通过 `buildRecoverResultExtra` 打包完整 Recover extra
- 与 FW 主链互斥（`asr.engine` 切换）

---

## 9. 写锁规则

```ts
export function isSegmentWriteLocked(ctx: JobContext): boolean {
  return ctx.asrRepairApplied === true;
}
```

FW apply 或 semantic repair 成功后，5015/5016/5017 不得覆盖 `segmentForJobResult`。

---

## 10. 禁止事项

1. 恢复 CTC / n-best / sentence repair 到 FW 默认 pipeline  
2. NMT / text_asr / Aggregation 从 `asrText` 或 `rawAsrText` fallback  
3. 覆盖 `rawAsrText`  
4. 跳过 AGGREGATION  
5. Detector 内接 lexicon recall  
6. 恢复 `pinyin-probe.ts`  
7. fw-gate / freeze-contract 保护 fallback 旧契约  

---

## 11. 测试门禁

| 门禁 | 路径 |
|------|------|
| 冻结合约 | `main/src/fw-detector/freeze-contract.test.ts` |
| FW gate | `scripts/fw-detector-gate.mjs` |
| post-asr-routing | `main/src/pipeline/post-asr-routing.test.ts` |
| aggregation-step | `main/src/pipeline/steps/aggregation-step.test.ts` |
| result-builder | `main/src/pipeline/result-builder.test.ts` |
| translation-step | `main/src/pipeline/steps/translation-step.test.ts` |
| pipeline 集成 | `tests/pipeline/*.test.ts` |

---

## 12. 验收命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
npm run build:main
node scripts/fw-detector-gate.mjs
npx jest --testPathPattern="freeze-contract|post-asr-routing|aggregation-step|result-builder|translation-step"
npx jest --config tests/pipeline/jest.config.js

# 批测（节点运行 + PROJECT_ROOT）
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/run-fw-detector-dialog-200-batch.js "D:\Programs\github\lingua_1\test wav\dialog_200" --limit 50
```

**通过标准：** 单测 PASS；fw-gate PASS；dialog_200 × 50 = 50/50 PASS；`lexicon_runtime_status=ok`；无 `window_candidates` / `sentence_repair.executed`

---

## 13. P2 已完成（2026-05-30）

### Recover 物理隔离

- 源码目录：`main/src/legacy/recover/`（见目录内 `README.md`）
- FW 共享 KenLM：`main/src/asr-repair/kenlm-batch-types.ts` + `sentence-rerank/kenlm-scorer.ts`
- `pipeline-step-registry.ts` 从 legacy 注册 `LEXICON_RECALL` / `SENTENCE_REPAIR`（仅 Recover 模式执行）
- `fw-detector-gate.mjs`：FW 主链不得 import `legacy/recover`

### Intent wire

- Node payload / warmup：`turns[].finalText`（原 `repairedText` 已删除）
- Python `lexicon_intent_cpu`：`TurnInput.finalText`
- Session：`RollingTurn.finalText` 不变

---

## 14. 后续允许优化项（非冻结）

- P1.3 Recall / Lexicon Coverage（alias、confusions、hotwords）
- 可调 `spanDetectBudget`、prior、topK（**禁止** Detector 层 recall）

---

## 15. 废止文档列表

以下文档为历史阶段记录，**不再作为实现规范**；以本文 + `FW_DETECTOR.md` 为准：

| 文档 | 说明 |
|------|------|
| `docs/ASR_unity/ASR_主链统一方案_SegmentForJobResult_V1*.md` | SSOT V1 草案 |
| `docs/ASR_unity/ASR_主链统一方案_V1_1_补充完整版.md` | SSOT V1.1 |
| `docs/ASR_unity/ASR_FW主链继续冻结方案_V1*.md` | 冻结方案阶段稿 |
| `docs/ASR_unity/ASR_FW主链冻结后只读清理审计_2026_05_30.md` | 只读审计 |
| `docs/ASR_unity/ASR_FW主链冻结后清理方案_P0_P1_P2_2026_05_30.md` | 清理任务清单（执行后归档） |
| `electron-node/docs/ASR前后处理链路审计报告_2026_05_27.md` | 已加废止头 |

**保留（历史报告，非规范）：** `ASR_SSOT_V1_1_*`、`ASR_FW主链冻结补丁_*` 开发/测试报告

---

## 相关代码索引

| 模块 | 路径 |
|------|------|
| 业务文本解析 | `pipeline/post-asr-routing.ts` |
| Result 构建 | `pipeline/result-builder.ts` |
| 聚合 | `pipeline/steps/aggregation-step.ts` |
| FW 步骤 | `pipeline/steps/fw-detector-step.ts` |
| Pipeline 模式 | `fw-detector/pipeline-mode-fw.ts` |
| JobContext | `pipeline/context/job-context.ts` |
| Recover legacy | `legacy/recover/` |
