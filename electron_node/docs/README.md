# Electron 节点客户端文档

本文档目录包含 Electron 节点客户端的所有产品设计、说明和技术方案文档。

## 文档列表

### Electron 应用
- `electron_node/` - Electron 应用相关文档
  - `ARCHITECTURE_RECOMMENDATION.md` - 架构推荐方案
  - `NODE_CLIENT_STARTUP_AND_LOGGING.md` - 启动和日志文档
  - `THIRD_PARTY_PLUGIN_SCENARIOS.md` - 第三方插件场景
  - `SERVICE_MIGRATION_ASSESSMENT.md` - 服务迁移评估
  - `PLUGIN_ARCHITECTURE_NECESSITY_ASSESSMENT.md` - 插件化架构必要性评估

### 节点推理服务 (Node Inference)
- `node_inference/` - 节点推理服务文档
  - `README.md` - 推理服务文档
  - `AUTO_LANGUAGE_DETECTION_*.md` - 自动语言检测相关文档
  - `TWO_LEVEL_VAD_DESIGN.md` - 两级 VAD 设计

### 节点注册 (Node Register)
- `node_register/` - 节点注册相关文档
  - `README.md` - 节点注册文档
  - `NODE_REGISTRATION_*.md` - 节点注册协议和规范
  - `NODE_STATUS_AND_TESTS_v1.md` - 节点状态和测试

### 模块化功能 (Modular)
- `modular/` - 模块化功能文档
  - `README.md` - 模块化功能文档
  - `MODULAR_FEATURES.md` - 模块化功能设计
  - `LINGUA_完整技术说明书_v2.md` - 完整技术说明书

## 快速参考

- **Electron 应用**: Electron + Node.js + TypeScript + React
- **推理服务**: Rust + ONNX Runtime
- **Python 服务**: Python (NMT、TTS、YourTTS)
- **项目位置**: `electron_node/`

## 项目状态

- **项目完整性**: `../PROJECT_COMPLETENESS.md`
- **测试状态**: `../TEST_STATUS.md`
- **测试执行报告**: `../TEST_EXECUTION_REPORT.md`
- **迁移文档**: `MIGRATION.md`

## 快速开始

- **主 README**: `../README.md`
- **测试运行**: `../run_tests.ps1`
