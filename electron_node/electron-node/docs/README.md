# Electron Node 文档

主进程、渲染进程与本地 Python 服务协作的节点端应用。**以当前代码为准。**

## 核心文档

| 文档 | 说明 |
|------|------|
| [PIPELINE.md](./PIPELINE.md) | **默认主链** ASR → FW Metadata Gate → V2 Recall → P4 Rerank → NMT |
| [FW_MAINLINE_FREEZE.md](./FW_MAINLINE_FREEZE.md) | 冻结契约与回滚开关 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构、Registry、NodeAgent、GPU |
| [CONFIGURATION.md](./CONFIGURATION.md) | 配置与环境变量 |
| [SERVICES.md](./SERVICES.md) | 子服务启停 |
| [RECOVER.md](./RECOVER.md) | Recover V5（非 FW 默认主链） |
| [LEXICON.md](./LEXICON.md) | V3 Recover 词库运行时 |
| [SESSION_AFFINITY.md](./SESSION_AFFINITY.md) | Intent / Session 路由 |
| [AGGREGATOR.md](./AGGREGATOR.md) | 音频与文本聚合 |
| [AUDIO_AGGREGATOR_Data_Format.md](./AUDIO_AGGREGATOR_Data_Format.md) | 聚合数据格式 |
| [Long_Utterance_Job_Container_Policy.md](./Long_Utterance_Job_Container_Policy.md) | 长句 Job 策略 |
| [NODE_SCHEDULER_CONNECTION.md](./NODE_SCHEDULER_CONNECTION.md) | 调度器连接 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 排错 |
| [PHONETIC_GPU_AND_SEMANTIC_TIMEOUT.md](./PHONETIC_GPU_AND_SEMANTIC_TIMEOUT.md) | 音韵/GPU/超时 |
| [FFMPEG.md](./FFMPEG.md) | 音频工具 |
| [DEPENDENCY_INSTALLATION.md](./DEPENDENCY_INSTALLATION.md) | 依赖安装 |

## 词库

| 类型 | 路径 |
|------|------|
| V2（FW 默认） | [../docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../docs/lexicon_v2/LEXICON_RUNTIME_V2.md) |
| V3 Recover | [LEXICON.md](./LEXICON.md) · [docs/lexicon-v3/](../../../docs/lexicon-v3/README.md) |
| Mock / golden | [../../lexicon-assets/tests/](../../lexicon-assets/tests/) |
| 资产包 | [../docs/lexicon-assets/](../docs/lexicon-assets/) · [../lexicon-assets/docs/](../lexicon-assets/docs/README.md) |

## 脚本与测试

[../scripts/README.md](../scripts/README.md) — 构建、词库、批测命令。

## Python 服务

`electron_node/services/<name>/README.md`

## 仓库级

- [docs/CODING/常用命令](../../../docs/CODING/常用命令) — 启动与运维
- [../docs/README.md](../docs/README.md) — 模块文档索引
