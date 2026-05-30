# Electron Node 文档

主进程、渲染进程与本地 Python 服务协作的节点端应用。**以当前代码为准。**

## 核心文档

| 文档 | 说明 |
|------|------|
| [FW_DETECTOR.md](./FW_DETECTOR.md) | **默认主链** fw_detector_v1：分层、配置、冻结合约 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构、Registry、NodeAgent、GPU |
| [CONFIGURATION.md](./CONFIGURATION.md) | 配置与环境变量 |
| [SERVICES.md](./SERVICES.md) | 子服务启停 |
| [ASR_Module_Flow.md](./ASR_Module_Flow.md) | ASR 调用链（含 FW 路由） |
| [ASR前后处理链路审计报告_2026_05_27.md](./ASR前后处理链路审计报告_2026_05_27.md) | **只读审计**：ASR 前/后处理至 NMT 前全链路 |
| [RECOVER.md](./RECOVER.md) | Recover V5（非 FW 默认主链） |
| [LEXICON.md](./LEXICON.md) | 词库运行时 + FW span recall |
| [SESSION_AFFINITY.md](./SESSION_AFFINITY.md) | Intent / Session 路由（V2） |
| [AGGREGATOR.md](./AGGREGATOR.md) | 音频与文本聚合 |
| [AUDIO_AGGREGATOR_Data_Format.md](./AUDIO_AGGREGATOR_Data_Format.md) | 聚合数据格式 |
| [Long_Utterance_Job_Container_Policy.md](./Long_Utterance_Job_Container_Policy.md) | 长句 Job 策略 |
| [NODE_SCHEDULER_CONNECTION.md](./NODE_SCHEDULER_CONNECTION.md) | 调度器连接 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 排错 |
| [PHONETIC_GPU_AND_SEMANTIC_TIMEOUT.md](./PHONETIC_GPU_AND_SEMANTIC_TIMEOUT.md) | 音韵/GPU/超时 |
| [FFMPEG.md](./FFMPEG.md) | 音频工具 |
| [DEPENDENCY_INSTALLATION.md](./DEPENDENCY_INSTALLATION.md) | 依赖安装 |

## 脚本与测试

[../scripts/README.md](../scripts/README.md) — 构建、词库、批测命令（无历史测试报告）。

## 词库

| 类型 | 路径 |
|------|------|
| 运行时说明 | [LEXICON.md](./LEXICON.md) |
| Mock / golden jsonl | [../../lexicon-assets/tests/](../../lexicon-assets/tests/) |
| 资产包（jsonl/benchmark） | [../../docs/lexicon-assets/](../../docs/lexicon-assets/) |
| 资产包说明 | [../../lexicon-assets/docs/README.md](../../lexicon-assets/docs/README.md) |
| V3 冻结规范（仓库级） | [../../../docs/lexicon-v3/](../../../docs/lexicon-v3/README.md) |

## Python 服务

`electron_node/services/<name>/README.md`

## 仓库级

- [docs/CODING/常用命令](../../../docs/CODING/常用命令) — 启动与运维
- [electron_node/docs/README.md](../../docs/README.md) — 模块文档索引
