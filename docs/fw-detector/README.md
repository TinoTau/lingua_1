# FW Detector 文档

> **状态**：**V4-only 已冻结**（2026-06-15 P1 Residue Cleanup 后）  
> **代码**：`electron_node/electron-node/main/src/fw-detector/`  
> **架构 SSOT**：[ARCHITECTURE.md](./ARCHITECTURE.md)  
> **配置 SSOT**：[CONFIG.md](./CONFIG.md)

## 生产主链（唯一）

```text
ASR → runFwDetectorOrchestrator → runFwDetectorV4Path
→ Global Window → Recall → Tone Score → Compatibility
→ Graph → Beam → KenLM → applyFwSpanReplacements → segmentForJobResult
```

`pipelinePath = 'v4'` 为唯一合法值。V2 句级 rerank pipeline、V3 `span-assembly-v3/` 已退役。

## 子模块文档

| 模块 | 文档 |
|------|------|
| 粗边界 / IME | [../pinyin-v2/README.md](../pinyin-v2/README.md) |
| 声学声调 CNN | [../tone-module/README.md](../tone-module/README.md) |
| Lexicon Runtime | [../lexicon-v3/ARCHITECTURE.md](../lexicon-v3/ARCHITECTURE.md) |
| Legacy 回滚链 | `main/src/legacy/fw-detector/README.md`（非 orchestrator 默认） |

## 常用命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run build:main
npm run test:fw-detector
node scripts/fw-detector-gate.mjs
```

批测（需节点 + Test Server :5020）：

```powershell
node tests/run-dialog200-timed-batch.mjs "D:\Programs\github\lingua_1\test wav\dialog_200" --max-minutes 15
```

## 本目录

| 文件 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | V4 主链、目录结构、Recall/Tone/KenLM/Apply、Diagnostics |
| [CONFIG.md](./CONFIG.md) | 冻结默认配置与 deprecated 字段 |

**已移除**：`docs/tone`、`docs/tone_v2`、`docs/tone_v3` 下全部开发/测试/审计报告（内容已并入本文档体系或作废）。
