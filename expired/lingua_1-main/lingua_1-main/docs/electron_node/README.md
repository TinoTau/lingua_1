# Electron 节点客户端文档索引（`electron_node/docs`）

这里集中存放 Electron 节点客户端相关文档。为避免“方案文档 / 阶段文档 / README”口径不一致，本索引将 **现行口径** 与 **历史/阶段性材料** 分开整理。

## 从这里开始（现行口径）

- **Electron Node 主文档（以代码为准）**：`electron_node/README.md`
  - 入口在：`docs/electron_node/README.md`
- **路径结构与目录口径**：`PATH_STRUCTURE.md`

> 本轮整理重点是 `electron-node`（Electron 应用本体）相关内容；每个 service 的细节文档请直接看 `../services/` 下对应目录（此处不展开）。

## Electron Node（Electron 应用）

- **主文档**：`electron_node/README.md`
- **阶段性方案/评估（阅读时以代码与主文档为准）**：`electron_node/`
  - `ARCHITECTURE_RECOMMENDATION.md`
  - `NODE_CLIENT_STARTUP_AND_LOGGING.md`
  - `SERVICE_MANAGER_REFACTORING.md`
  - `GPU_STATISTICS_TRACKING.md`
  - `SERVICE_MIGRATION_ASSESSMENT.md`
  - `PLUGIN_ARCHITECTURE_NECESSITY_ASSESSMENT.md`
  - `THIRD_PARTY_PLUGIN_SCENARIOS.md`
  - 以及其它同目录文档

## 核心参考（仍然有价值）

- **迁移文档**：`MIGRATION.md` - 从 expired/ 迁移到 electron_node/ 的详细说明
- **服务热插拔验证**：`SERVICE_HOT_PLUG_VERIFICATION.md` - 服务热插拔与任务链验证
- **TTS 服务文档**：`TTS_SERVICES.md` - Piper TTS 和 YourTTS 服务说明
- **路径结构**：`PATH_STRUCTURE.md` - 路径结构与目录解析
- **音频处理索引**：`AUDIO_PROCESSING_INDEX.md` - 音频处理相关文档索引
- **音频聚合完整机制**：`short_utterance/AUDIO_AGGREGATION_COMPLETE_MECHANISM.md` ⭐ **重要** - 完整的音频聚合、ASR、NMT、调度服务器finalize和Web端机制文档

## 模块化功能（历史/设计材料）

- `modular/README.md`
- `modular/MODULAR_FEATURES.md`
- `modular/LINGUA_完整技术说明书_v2.md`

## 项目状态

- `../PROJECT_COMPLETENESS.md` - 项目完整性报告
