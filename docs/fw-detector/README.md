# FW Detector 文档

> **状态**：V4-only · SameDomain Assembly **V1.2 FROZEN** · Tone-First Recall **V1.0.1 FROZEN** · Diagnostics Trace **V1.0.2 FROZEN**（2026-06-17）  
> **代码**：`electron_node/electron-node/main/src/fw-detector/`  
> **最终裁决**：[freeze/FINAL_FREEZE_2026_06_17.md](./freeze/FINAL_FREEZE_2026_06_17.md)

## 生产主链（唯一）

```text
ASR → runFwDetectorOrchestrator → runFwDetectorV4Path
→ Global Window → Recall (tone-first composite SQL + plain fallback) → Tone Score
→ Compatibility → Domain Assembly (Pool→Vote→Filter→Select→Assemble)
→ SentenceCandidate → KenLM → applyFwSpanReplacements → segmentForJobResult
```

Shadow（仅 diagnostics）：`Emit → ParentSpan → Graph → Beam → shadowBeamSpanSets`（不进入 KenLM/Apply）。

`pipelinePath = 'v4'` 为唯一合法值。Assembly / Domain Vote / Beam 主链 / Recall 机制 **已停止开发**；下一阶段：**KenLM 审计**（`docs/KenLM Audit/`）。

## 文档索引

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | V4 主链、Recall/Tone/Compatibility/Assembly/KenLM/Apply 总览 |
| [CONFIG.md](./CONFIG.md) | 冻结默认配置与 diagnostics 开关 |
| [assembly/FROZEN_V1_2.md](./assembly/FROZEN_V1_2.md) | SameDomain + Base Per-Span Assembly 冻结合约 |
| [recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md](./recall/TONE_FIRST_RECALL_FROZEN_V1_0_1.md) | Tone-First Recall 机制冻结 |
| [diagnostics/TRACE_FROZEN_V1_0_2.md](./diagnostics/TRACE_FROZEN_V1_0_2.md) | Diagnostics Summary + Trace 完整性 |
| [compatibility/COVERAGE_MERGE_FROZEN_V1_2.md](./compatibility/COVERAGE_MERGE_FROZEN_V1_2.md) | Coverage 分类与 Merge |
| [compatibility/AUTHORITY_REDUCTION_FROZEN_V1_1.md](./compatibility/AUTHORITY_REDUCTION_FROZEN_V1_1.md) | Compatibility 权威下沉 |
| [freeze/FINAL_FREEZE_2026_06_17.md](./freeze/FINAL_FREEZE_2026_06_17.md) | 2026-06-17 最终冻结裁决 |

## 关联模块

| 模块 | 文档 |
|------|------|
| 粗边界 / IME | [../pinyin-v2/README.md](../pinyin-v2/README.md) |
| 声学声调 | [../tone-module/README.md](../tone-module/README.md) |
| Lexicon Runtime | [../lexicon-v3/ARCHITECTURE.md](../lexicon-v3/ARCHITECTURE.md) |
| KenLM 审计 | [../KenLM Audit/](../KenLM%20Audit/) |
| Legacy 回滚链 | `main/src/legacy/fw-detector/README.md`（非 orchestrator 默认） |

## 常用命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run build:main
npm run test:fw-detector
node scripts/fw-detector-gate.mjs
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
```

批测（需节点 + Test Server :5020）：

```powershell
node tests/run-dialog200-timed-batch.mjs "D:\Programs\github\lingua_1\test wav\dialog_200" --max-minutes 15
```

Diagnostics trace 批测（审计用，patch 脚本开启 trace，不改 SSOT 默认）：

```powershell
node tests/patch-span-assembly-v4-config.mjs
node tests/experiments/analyze-tone-first-recall-dialog200.mjs
```
