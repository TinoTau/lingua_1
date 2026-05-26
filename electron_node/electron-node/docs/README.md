# Electron Node 文档

主进程、渲染进程与本地 Python 服务协作的节点端应用。以 **当前代码** 为准。

## 核心文档

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构、Registry、NodeAgent、GPU |
| [CONFIGURATION.md](./CONFIGURATION.md) | 配置与环境变量 |
| [SERVICES.md](./SERVICES.md) | 子服务启停 |
| [RECOVER.md](./RECOVER.md) | ASR 后修复主链（V5） |
| [LEXICON.md](./LEXICON.md) | Canonical 词库运行时（V3） |
| [SESSION_AFFINITY.md](./SESSION_AFFINITY.md) | Intent / Session 路由（V2） |
| [AGGREGATOR.md](./AGGREGATOR.md) | 音频与文本聚合 |
| [ASR_Module_Flow.md](./ASR_Module_Flow.md) | ASR 调用链 |
| [AUDIO_AGGREGATOR_Data_Format.md](./AUDIO_AGGREGATOR_Data_Format.md) | 聚合数据格式 |
| [Long_Utterance_Job_Container_Policy.md](./Long_Utterance_Job_Container_Policy.md) | 长句 Job 策略 |
| [NODE_SCHEDULER_CONNECTION.md](./NODE_SCHEDULER_CONNECTION.md) | 调度器连接 |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 排错 |
| [PHONETIC_GPU_AND_SEMANTIC_TIMEOUT.md](./PHONETIC_GPU_AND_SEMANTIC_TIMEOUT.md) | 音韵/GPU/超时 |
| [FFMPEG.md](./FFMPEG.md) | 音频工具 |
| [DEPENDENCY_INSTALLATION.md](./DEPENDENCY_INSTALLATION.md) | 依赖安装 |

## 脚本

[../scripts/README.md](../scripts/README.md) — 构建、词库导入、dialog_200 批测。

## 词库资产（数据）

JSONL / benchmark / gate 文件（非设计文档）：

`../../docs/lexicon-assets/` — 见各包内 `README.md`。

## 仓库级

- `docs/lexicon-v3/` — V3 冻结规范（架构、import、gate）
- `docs/CODING/常用命令` — 启动与运维命令

## Python 服务

各服务目录 `electron_node/services/<name>/` 下的 `README.md` 与 `docs/` 为准。
