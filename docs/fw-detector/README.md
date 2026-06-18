# FW Detector 文档

> **状态**：V4-only · Assembly V1.2 · Coverage V1.2 · Compatibility V1.1 · Recall V1.0.1 · Diagnostics V1.0.2 · **KenLM Batch-Only**（2026-06-17）  
> **代码**：`electron_node/electron-node/main/src/fw-detector/`

## 生产主链

```text
ASR → runFwDetectorOrchestrator → runFwDetectorV4Path
→ Global Window → Recall (tone-first) → Tone Score
→ Compatibility → Domain Assembly (Pool→Vote→Filter→Select→Assemble)
→ SentenceCandidate → KenLM (batch-only) → applyFwSpanReplacements → segmentForJobResult
```

Shadow（仅 diagnostics）：`Emit → ParentSpan → Graph → Beam`（不进入 KenLM/Apply）。

`pipelinePath = 'v4'` 为唯一合法值。Assembly / Recall / Compatibility / KenLM runtime **已冻结**，禁止 Silent Change。

## 文档索引

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | V4 主链总览与目录结构 |
| [CONFIG.md](./CONFIG.md) | 配置 SSOT（含 KenLM subprocess） |
| [assembly/FROZEN_V1_2.md](./assembly/FROZEN_V1_2.md) | SameDomain + Base Per-Span Assembly |
| [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](./recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) | Tone-First Recall |
| [compatibility/FROZEN.md](./compatibility/FROZEN.md) | Coverage 分类 + Merge + Authority |
| [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md) | KenLM batch-only subprocess |
| [diagnostics/TRACE_FROZEN_V1_0_2.md](./diagnostics/TRACE_FROZEN_V1_0_2.md) | Diagnostics Summary + Trace |
| [freeze/FINAL_FREEZE_2026_06_17.md](./freeze/FINAL_FREEZE_2026_06_17.md) | 2026-06-17 冻结裁决 |

## 关联模块

| 模块 | 文档 |
|------|------|
| 粗边界 / IME | [../pinyin-v2/README.md](../pinyin-v2/README.md) |
| 声学声调 | [../tone-module/README.md](../tone-module/README.md) |
| Lexicon Runtime | [../lexicon-v3/ARCHITECTURE.md](../lexicon-v3/ARCHITECTURE.md) |
| Legacy 回滚链 | `main/src/legacy/fw-detector/README.md` |

## 常用命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run build:main
npm run test:fw-detector
node scripts/fw-detector-gate.mjs
npx jest --testPathPattern="freeze-contract|freeze-config-ssot|kenlm-scorer"
```

dialog200 批测（需节点 + Test Server :5020）：

```powershell
node tests/run-dialog200-timed-batch.mjs "D:\Programs\github\lingua_1\test wav\dialog_200" --max-minutes 18 --out kenlm-batch-subprocess-dialog200-batch-result.json
node tests/experiments/analyze-kenlm-batch-dialog200.mjs
```

KenLM 性能门槛：`kenlmVetoMs` P95 &lt; 2000ms，`fw_detector_step_ms` P95 &lt; 4000ms。
