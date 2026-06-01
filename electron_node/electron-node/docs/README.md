# Electron Node 文档索引

节点端主进程、渲染进程与本地 Python 服务。**以当前代码为准。**

---

## 模块文档（`main/src/`）

| 模块 | 文档 | 说明 |
|------|------|------|
| Pipeline | [main/src/pipeline/README.md](../main/src/pipeline/README.md) | 步骤编排、SSOT、Result Builder |
| FW Detector | [main/src/fw-detector/README.md](../main/src/fw-detector/README.md) | **冻结主链** + 门禁 + 回滚 |
| Enhancement | [main/src/pipeline/enhancement/README.md](../main/src/pipeline/enhancement/README.md) | 5015/5016/5017 |
| Legacy ASR Repair | [main/src/legacy/asr-repair/README.md](../main/src/legacy/asr-repair/README.md) | 非 FW CTC 修复链 |
| Legacy FW 回滚 | [main/src/legacy/fw-detector/README.md](../main/src/legacy/fw-detector/README.md) | P1.2b topK |
| Lexicon V3 | [main/src/lexicon/README.md](../main/src/lexicon/README.md) | Canonical bundle / 窗召回 |
| Session | [main/src/session-runtime/README.md](../main/src/session-runtime/README.md) | Intent / Affinity |
| 音频聚合 | [main/src/pipeline-orchestrator/README.md](../main/src/pipeline-orchestrator/README.md) | AudioAggregator |
| 文本聚合 | [main/src/aggregator/README.md](../main/src/aggregator/README.md) | AggregatorMiddleware |

---

## 节点级文档（本目录）

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 整体架构、Registry、NodeAgent |
| [CONFIGURATION.md](./CONFIGURATION.md) | 配置与环境变量 |
| [SERVICES.md](./SERVICES.md) | 子服务启停 |
| [NODE_SCHEDULER_CONNECTION.md](./NODE_SCHEDULER_CONNECTION.md) | 调度器连接 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 排错 |
| [DEPENDENCY_INSTALLATION.md](./DEPENDENCY_INSTALLATION.md) | 依赖安装 |
| [FFMPEG.md](./FFMPEG.md) | 音频工具 |
| [PHONETIC_GPU_AND_SEMANTIC_TIMEOUT.md](./PHONETIC_GPU_AND_SEMANTIC_TIMEOUT.md) | GPU / 超时 |
| [GPU_USAGE_VERIFICATION.md](./GPU_USAGE_VERIFICATION.md) | GPU 验证 |

---

## 仓库级

| 类型 | 路径 |
|------|------|
| Lexicon V2 | [../docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../docs/lexicon_v2/LEXICON_RUNTIME_V2.md) |
| Lexicon V3 规范 | [../../docs/lexicon-v3/](../../docs/lexicon-v3/) |
| 词库资产 | [../lexicon-assets/docs/](../lexicon-assets/docs/README.md) |
| 常用命令 | [../../docs/CODING/常用命令](../../docs/CODING/常用命令) |
| 脚本 | [../scripts/README.md](../scripts/README.md) |
| Python 服务 | `electron_node/services/<name>/README.md` |

---

## 快速验证（FW 冻结）

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
node scripts/fw-detector-gate.mjs
```
