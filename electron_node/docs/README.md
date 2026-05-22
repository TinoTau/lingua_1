# Electron Node 文档

本目录为 **electron_node** 模块级说明。节点应用细节在 `electron-node/docs/`；各 Python/Rust 服务在 `services/<name>/`。

## 模块文档

| 文档 | 说明 |
|------|------|
| [RECOVER.md](./RECOVER.md) | ASR 后修复主链：词库 recall → 句候选 → KenLM 写回 |
| [LEXICON.md](./LEXICON.md) | 词库运行时、窗召回、诊断字段 |

### Recover V5（规划中）

| 文档 | 说明 |
|------|------|
| [v5/Recover V5 冻结方案.md](./v5/Recover%20V5%20冻结方案.md) | V5 冻结架构：diff 窗 + Scored Lexicon TopK |
| [v5/Recover_V5_Frozen_Decisions_2026-05-22.md](./v5/Recover_V5_Frozen_Decisions_2026-05-22.md) | **已确认决策**（替换 V4、near 限额、2 窗、双尺度、KenLM 0.15 等） |
| [v5/Recover_V5_Readonly_Code_Audit_2026-05-22.md](./v5/Recover_V5_Readonly_Code_Audit_2026-05-22.md) | V5 相对当前代码的只读审计与开发方案 |

**阶段技术方案**

| Phase | 方案 | 代码补充与约束 |
|-------|------|----------------|
| A 数据基础 | [Phase_A_Scored_Lexicon_Data_Foundation](./v5/Recover_V5_Phase_A_Scored_Lexicon_Data_Foundation_2026-05-22.md) | [Phase_A_Supplement_Constraints](./v5/Recover_V5_Phase_A_Supplement_Constraints_2026-05-22.md) |
| B diff 窗 | [Phase_B_Nbest_Diff_Window_Pipeline](./v5/Recover_V5_Phase_B_Nbest_Diff_Window_Pipeline_2026-05-22.md) | [Phase_B_Supplement_Constraints](./v5/Recover_V5_Phase_B_Supplement_Constraints_2026-05-22.md) |
| C TopK 召回 | [Phase_C_TopK_Pinyin_Recall_CandidateScore](./v5/Recover_V5_Phase_C_TopK_Pinyin_Recall_CandidateScore_2026-05-22.md) | [Phase_C_Supplement_Constraints](./v5/Recover_V5_Phase_C_Supplement_Constraints_2026-05-22.md) |
| D 安全门控 | [Phase_D_Safety_Gates_KenLM_Boundary](./v5/Recover_V5_Phase_D_Safety_Gates_KenLM_Boundary_2026-05-22.md) | [Phase_D_Supplement_Constraints](./v5/Recover_V5_Phase_D_Supplement_Constraints_2026-05-22.md) |
| E 观测与批测 | [Phase_E_Observability_Tests_Batch_Contract](./v5/Recover_V5_Phase_E_Observability_Tests_Batch_Contract_2026-05-22.md) | [Phase_E_Supplement_Constraints](./v5/Recover_V5_Phase_E_Supplement_Constraints_2026-05-22.md) |

## 节点应用（electron-node）

| 文档 | 说明 |
|------|------|
| [../electron-node/docs/ARCHITECTURE.md](../electron-node/docs/ARCHITECTURE.md) | 主进程架构、Registry、NodeAgent |
| [../electron-node/docs/AGGREGATOR.md](../electron-node/docs/AGGREGATOR.md) | 聚合中间件 |
| [../electron-node/docs/CONFIGURATION.md](../electron-node/docs/CONFIGURATION.md) | 配置与环境变量 |
| [../electron-node/docs/SERVICES.md](../electron-node/docs/SERVICES.md) | 子服务启停 |
| [../electron-node/docs/ASR_Module_Flow.md](../electron-node/docs/ASR_Module_Flow.md) | ASR 调用链 |
| [../electron-node/docs/AUDIO_AGGREGATOR_Data_Format.md](../electron-node/docs/AUDIO_AGGREGATOR_Data_Format.md) | 聚合数据格式 |
| [../electron-node/docs/Long_Utterance_Job_Container_Policy.md](../electron-node/docs/Long_Utterance_Job_Container_Policy.md) | 长句 Job 策略 |
| [../electron-node/docs/TROUBLESHOOTING.md](../electron-node/docs/TROUBLESHOOTING.md) | 排错 |
| [../electron-node/docs/NODE_SCHEDULER_CONNECTION.md](../electron-node/docs/NODE_SCHEDULER_CONNECTION.md) | 与 Scheduler 连接 |

## 服务（services）

各服务目录下的 `README.md` 为准，例如：

- `services/asr_sherpa_lm/` — 中文 ASR + KenLM n-best
- `services/asr_sherpa_en/` — 英文 CTC
- `services/faster_whisper_vad/` — VAD
- `services/nmt_m2m100/`、`services/piper_tts/`、`services/semantic_repair_en_zh/` 等

## 脚本

- [electron-node/scripts/README.md](../electron-node/scripts/README.md) — 构建、词库、批测入口
- [scripts/README.md](../scripts/README.md) — 运维（杀残留进程、查日志）

## 仓库级规范

- `docs/CODING/` — 开发规范与常用命令

文档以代码为准。
