# Electron Node 文档索引

节点端（主进程 + 渲染进程 + 本地 Python/Rust 服务）。**以当前代码为准。**

## 节点级文档（本目录）

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 整体架构、服务发现、NodeAgent、子服务一览 |
| [CONFIGURATION.md](./CONFIGURATION.md) | 配置、环境变量、依赖与 FFmpeg、GPU 摘要 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 调度器连接、Pipeline、GPU 验证、常见故障 |

## 模块文档（`main/src/`）

| 模块 | 文档 |
|------|------|
| Pipeline | [main/src/pipeline/README.md](../main/src/pipeline/README.md) |
| FW Detector | [main/src/fw-detector/README.md](../main/src/fw-detector/README.md) |
| Task Router | [main/src/task-router/README.md](../main/src/task-router/README.md) |
| Enhancement | [main/src/pipeline/enhancement/README.md](../main/src/pipeline/enhancement/README.md) |
| Legacy ASR Repair | [main/src/legacy/asr-repair/README.md](../main/src/legacy/asr-repair/README.md) |
| Legacy FW 回滚 | [main/src/legacy/fw-detector/README.md](../main/src/legacy/fw-detector/README.md) |
| Lexicon V3 | [main/src/lexicon/README.md](../main/src/lexicon/README.md) |
| Lexicon Runtime V2 | [main/src/lexicon-v2/README.md](../main/src/lexicon-v2/README.md) |
| Lexicon Patch V3.1 | [main/src/lexicon-patch-v3/README.md](../main/src/lexicon-patch-v3/README.md) |
| Session | [main/src/session-runtime/README.md](../main/src/session-runtime/README.md) |
| 音频聚合 | [main/src/pipeline-orchestrator/README.md](../main/src/pipeline-orchestrator/README.md) |
| 文本聚合 | [main/src/aggregator/README.md](../main/src/aggregator/README.md) |

## 仓库级

| 类型 | 路径 |
|------|------|
| Lexicon V3 SSOT | [../../docs/lexicon-v3/README.md](../../docs/lexicon-v3/README.md) |
| 词库脚本 | [../scripts/lexicon/README.md](../scripts/lexicon/README.md) |
| 词库资产 | [../lexicon-assets/docs/README.md](../lexicon-assets/docs/README.md) |
| 常用命令 | [../../docs/CODING/常用命令](../../docs/CODING/常用命令) |
| 脚本 | [../scripts/README.md](../scripts/README.md) |
| Python/Rust 服务 | `electron_node/services/<name>/README.md` 或 `docs/` |

## 快速验证（FW 冻结）

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
node scripts/fw-detector-gate.mjs
```
