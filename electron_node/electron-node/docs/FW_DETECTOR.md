# FW Detector 主链（fw_detector_v1）

**状态：** P0/P1 冻结清理完成（2026-05-30）  
**规范 SSOT：** [ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md](../docs/ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md)
**代码根：** `main/src/fw-detector/`、`pipeline/steps/fw-detector-step.ts`  
**默认引擎：** `asr.engine = fw_detector_v1`（`node-config-defaults.ts`）

当 `asr.engine === fw_detector_v1` 时，中文主链走 **FW-only**：不恢复 CTC、n-best 句级 Recover、ASR rerun、secondary decode。

---

## 1. 主链数据流

```text
Audio → AudioAggregator
  → faster-whisper-vad (medium, CUDA: int8_float16)
  → rawAsrText freeze（asr-step 首段一次）
  → FW_SPAN_DETECTOR
      → span-detector-hint（纯音节）
      → detectSuspiciousSpansV1（budget top-K）
      → runFwTopKDecisionPipeline
          → lexicon/recallSpanTopK
          → candidate-sentence-builder
          → candidate-scorer + kenlm-span-gate (weak_veto)
          → pick-approved-replacements (D-greedy)
      → applyFwSpanReplacements
  → AGGREGATION（读写 segmentForJobResult）
  → result-builder（text_asr ← segmentForJobResult；extra.raw_asr_text ← rawAsrText）
```

**Pipeline 顺序：** `ASR → FW_SPAN_DETECTOR → AGGREGATION → …`  
**移除步骤：** `LEXICON_RECALL`、`SENTENCE_REPAIR`（`pipeline-mode-fw.ts`）

**ASR 路由：**

- `resolve-preferred-asr-service.ts` → `faster-whisper-vad`
- `task-router-asr.ts` 将 CTC 端点重定向至 FW

---

## 2. 分层职责（冻结）

### 2.1 Detector

**职责：** 宽松怀疑，枚举 suspicious span。

| 允许 | 禁止 |
|------|------|
| `domain_anchor_nearby` | `recallSpanTopK` / lexicon |
| `detector_pinyin_hint`（2–5 音节） | `repairTarget` / `hasReplacementCandidate` |
| `mixed_language_anomaly`、`low_no_speech_prob` | `finalScore`、KenLM、applied 门控 |
| `spanDetectBudget` + `minRiskScore` 截断 | detect 阶段 overlap 剔除 |

**排序键：** `riskScore DESC → spanLength ASC → start DESC`  
**模块：** `span-detector-hint.ts`、`suspicious-span-detector-v1.ts`  
**已删除不得恢复：** `pinyin-probe.ts`

### 2.2 Candidate / Recall

**职责：** 词库 span recall、打分、KenLM 弱否决、pick、apply。

| 允许 | 禁止 |
|------|------|
| `lexicon/local-span-recall.ts`（`recallSpanTopK`） | 修改 `rawAsrText` |
| `word !== span.text` 过滤（`scoreRecallHits`） | 参与 Detector 入口 |
| `repairTarget` pick 池过滤（`candidateRequireRepairTarget`） | — |
| KenLM `weak_veto`（`asr-repair/kenlm-span-gate.ts`） | — |
| D-greedy 非重叠 apply（`maxSpans`） | — |

**编排：** `fw-detector-orchestrator.ts` → `fw-topk-decision-pipeline.ts`

### 2.3 文本契约（P0）

| 字段 | 规则 |
|------|------|
| `ctx.rawAsrText` | 仅 `asr-step` 首段写入一次；immutable |
| `ctx.segmentForJobResult` | SSOT：FW apply / 聚合 / 5015 / NMT / `text_asr` |
| `extra.raw_asr_text` | 观测用，与 `text_asr` 分离 |
| `ctx.asrRepairApplied` | FW **有 approved replacement** 时 `true`；5015/5016/5017 写锁 |
| `ctx.asrText` | diagnostics / debug；**禁止**作为 NMT / text_asr / Aggregation 输入 |

**业务文本：** `resolveBusinessAsrText(ctx)` = `(ctx.segmentForJobResult ?? '').trim()`；**无** `asrText` / `rawAsrText` / `repairedText` fallback。

**Aggregation：** 读写 `segmentForJobResult`；`currentSegment` 只读 segment；segment 空 → `segmentReady=false`、defer/skip。

**Session：** `RollingTurn.finalText` 为 turn 快照；Intent HTTP wire 键 **`finalText`**（与 Session 字段同名）。

---

## 2.4 双开关（engine vs feature）

| 函数 | 条件 | 效果 |
|------|------|------|
| `isFwDetectorEngineEnabled()` | `asr.engine === fw_detector_v1` | 改 pipeline 步骤；ASR 不拉 nbest |
| `isFwDetectorPipelineActive()` | 上项 + `features.fwDetector.enabled` + zh/yue | **才执行** `FW_SPAN_DETECTOR` |

生产默认两者均为 `true`。feature 关、engine 开时 FW 步骤 skip；聚合仍只读 `segmentForJobResult`（segment 须由 ASR 步骤写入）。dialog_200 批测须 feature 开。

---

## 3. 配置（默认）

```json
{
  "asr": { "engine": "fw_detector_v1" },
  "features": {
    "lexiconRecall": { "enabled": false },
    "fwDetector": {
      "enabled": true,
      "disableAsrRerun": true,
      "spanDetectBudget": 12,
      "maxSpans": 2,
      "topK": 3,
      "minPrior": 0.5,
      "minRiskScore": 2,
      "candidateRequireRepairTarget": true,
      "repairTargetScoreBoost": 0,
      "enableKenLMGate": true,
      "kenlmGateMode": "weak_veto",
      "kenlmVetoThreshold": -0.2,
      "kenlmDeltaThreshold": 0.8,
      "recallMinPhoneticScore": 0.5,
      "enabledDomains": ["tech_ai", "travel", "transport", "restaurant"],
      "domainAnchorPath": "data/lexicon/domain_anchor.json",
      "windowChars": 8,
      "minSpanChars": 2,
      "maxSpanChars": 4,
      "finalScoreWeights": { "pinyin": 0.4, "prior": 0.3, "domain": 0.2, "kenlm": 0.1 }
    }
  }
}
```

**环境变量：**

| 变量 | 用途 |
|------|------|
| `PROJECT_ROOT` | 词库 bundle、`domain_anchor.json`（dist 必设） |
| `ASR_MODEL` | 默认 `medium`（`python-service-config.ts`） |
| `ASR_COMPUTE_TYPE` | 未设时 CUDA → `int8_float16` |

**信号权重默认：** `domain_anchor_nearby=2`, `detector_pinyin_hint=2`, `mixed_language_anomaly=1`, `low_no_speech_prob=1`

---

## 4. 核心类型

```ts
// JobContext（FW 相关）
rawAsrText?: string;           // ASR freeze，只写一次；Detector 输入
segmentForJobResult?: string;   // SSOT：NMT / text_asr
asrText?: string;              // diagnostics only
asrRepairApplied?: boolean;
fwDetectorResult?: FwDetectorResult;

// FwSpanDiagnostics（Detector 输出）
{ text, start, end, domain, riskScore, signals[], detectorHint?, candidates[], applied }

// FwSpanCandidateDiag（Candidate）
{ word, priorScore, phoneticScore, repairTarget?, candidateSentence, finalScore, vetoed, kenlm? }

// FwDetectorResult
{ enabled, triggered, reason?, configSnapshot, summary, spanSelection, spans[], replacements? }
```

`triggered` = `summary.spanCount > 0`（有 kept span 即 triggered）。

**Diagnostics：** `extra.asr_service_id`、`extra.raw_asr_text`、`extra.fw_detector`。

---

## 5. 模块索引

| 路径 | 职责 |
|------|------|
| `fw-detector/fw-mode.ts` | 引擎开关、语言判定 |
| `fw-detector/pipeline-mode-fw.ts` | 插入 FW 步骤、移除 Recover |
| `fw-detector/fw-config.ts` | 运行时配置、domain anchor 路径 |
| `fw-detector/fw-detector-orchestrator.ts` | detect → pipeline → apply |
| `fw-detector/span-detector-hint.ts` | 纯音节 hint |
| `fw-detector/suspicious-span-detector-v1.ts` | span 枚举与 risk |
| `fw-detector/fw-topk-decision-pipeline.ts` | recall + KenLM + pick |
| `fw-detector/candidate-sentence-builder.ts` | candidateSentence |
| `fw-detector/candidate-scorer.ts` | finalScore 四维权重 |
| `fw-detector/pick-approved-replacements.ts` | D-greedy |
| `fw-detector/apply-span-replacements.ts` | 局部替换 |
| `lexicon/local-span-recall.ts` | `recallSpanTopK` |
| `asr-repair/kenlm-span-gate.ts` | weak_veto 语义 |
| `asr/resolve-preferred-asr-service.ts` | FW 服务 id |
| `task-router/task-router-asr.ts` | CTC → FW 重定向 |
| `task-router/faster-whisper-asr-strategy.ts` | disable rerun |
| `pipeline/steps/asr-step.ts` | raw freeze；FW 不写 n-best |
| `pipeline/steps/fw-detector-step.ts` | 步骤入口 |
| `pipeline/steps/aggregation-step.ts` | postDetectorSegment |
| `pipeline/post-asr-routing.ts` | segment 写锁、resolveBusinessAsrText |
| `pipeline/result-builder.ts` | text_asr / raw_asr_text |
| `utils/python-service-config.ts` | medium + int8_float16 |

---

## 6. 词库字段（FW Candidate）

```json
{ "word": "美式", "domains": ["restaurant"], "anchor": true, "repair_target": true }
{ "alias": "美食", "canonical": "美式", "repair_target": true }
```

- `anchor: true, repair_target: false` → 仅助 Detector 场景判断  
- `repair_target: true` → 可进入 Candidate pick 池（需 `candidateRequireRepairTarget`）

---

## 7. 门禁与测试

```powershell
cd electron_node\electron-node
npm run build:main
npx jest --testPathPattern="fw-detector|repaired-text-not-overwritten|asr-aggregation-contract"
node scripts/fw-detector-gate.mjs
```

| 门禁 | 测试 |
|------|------|
| P0 Aggregation 不绕过 | `tests/pipeline/asr-aggregation-contract.test.ts` |
| P0 repaired 不被覆盖 | `tests/pipeline/repaired-text-not-overwritten.test.ts` |
| Detector 分层 | `fw-detector/detector-layering.test.ts` |
| 冻结合约 | `fw-detector/freeze-contract.test.ts` |
| Recover 隔离 | `scripts/fw-detector-gate.mjs` |

**批测（需节点 + PROJECT_ROOT）：**

```powershell
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/run-fw-detector-homophone-acceptance.js
node tests/run-fw-detector-false-repair-acceptance.js
node tests/run-fw-detector-dialog-200-batch.js "<dialog_200路径>" --limit 50
```

Mock 集：`lexicon-assets/tests/restaurant_homophone.jsonl`、`false_repair_golden.jsonl`

---

## 8. 冻结后禁止

- 恢复 CTC / n-best / sentence repair / ASR rerun / secondary decode 到 FW 主链  
- Detector 内 recall 或 `repairTarget` 门控  
- 覆盖 `rawAsrText` 或跳过 AGGREGATION  
- 为 applied 关闭 `candidateRequireRepairTarget`  
- 修改 `kenlm-span-gate` weak_veto 语义、D-greedy 结构（无全量回归）  
- 恢复 `pinyin-probe.ts`

---

## 9. 与 Recover 的关系

| 模式 | 主链 |
|------|------|
| `fw_detector_v1`（默认） | FW Detector + AGGREGATION；`lexiconRecall.enabled=false` |
| Recover V5 | CTC n-best + LEXICON_RECALL + SENTENCE_REPAIR（见 [RECOVER.md](./RECOVER.md)） |

二者互斥于同一 job pipeline；切换靠 `asr.engine` 与 `applyFwDetectorPipelineMode`。

---

## 10. 下一阶段（P1.3，未冻结）

瓶颈在 **Recall / Lexicon Coverage**（非 Detector）：

- 补 alias：`少病→少糖`、`小背→大杯` 等  
- 扩展 `confusions.jsonl` / hotwords / 10k canonical  
- 可调：`spanDetectBudget`、prior、topK（**禁止** Detector recall）

---

## 相关文档

- [ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md](../docs/ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md) — **主链冻结规范（SSOT）**
- [LEXICON.md](./LEXICON.md) — 词库运行时 + span recall  
- [AGGREGATOR.md](./AGGREGATOR.md) — 聚合契约  
- [RECOVER.md](./RECOVER.md) — Recover V5（非 FW 主链）  
- `services/faster_whisper_vad/README.md` — ASR Python 服务
