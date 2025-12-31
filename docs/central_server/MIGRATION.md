# 中央服务器迁移文档

## 迁移概述

中央服务器组件已从 `expired/` 文件夹迁移到 `central_server/`，并按照新的项目结构进行了重组。

## 迁移内容

### 调度服务器 (Scheduler)

- **源路径**: `expired/scheduler/`
- **目标路径**: `central_server/scheduler/`
- **迁移内容**:
  - ✅ Rust 源代码 (`src/`)
  - ✅ 测试文件 (`tests/`)
  - ✅ 配置文件 (`Cargo.toml`)
  - ✅ 文档文件

### API 网关 (API Gateway)

- **源路径**: `expired/api-gateway/`
- **目标路径**: `central_server/api-gateway/`
- **迁移内容**:
  - ✅ Rust 源代码 (`src/`)
  - ✅ 配置文件 (`Cargo.toml`, `config.toml`)
  - ✅ 文档文件

### 模型库服务 (Model Hub)

- **源路径**: `expired/model-hub/`
- **目标路径**: `central_server/model-hub/`
- **迁移内容**:
  - ✅ Python 源代码 (`src/`)
  - ✅ 依赖文件 (`requirements.txt`)

### 文档迁移

- **调度服务器文档**: `expired/docs/scheduler/` → `central_server/docs/scheduler/`
- **API 网关文档**: `expired/docs/api_gateway/` → `central_server/docs/api_gateway/`
- **架构文档**: `expired/docs/ARCHITECTURE*.md` → `central_server/docs/`
- **协议文档**: `expired/docs/PROTOCOLS*.md` → `central_server/docs/`
- **模型管理文档**: `expired/docs/modelManager/` → `central_server/docs/modelManager/`

## 路径调整

### 启动脚本更新

- **调度服务器脚本**: `scripts/start_scheduler.ps1`
  - ✅ 更新了项目路径为 `central_server/scheduler`
  - ✅ 更新了日志路径为相对路径
  - ✅ 添加了服务 URL 输出

- **API 网关脚本**: `scripts/start_api_gateway.ps1`
  - ✅ 更新了项目路径为 `central_server/api-gateway`

- **模型库服务脚本**: `scripts/start_model_hub.ps1`
  - ✅ 更新了项目路径为 `central_server/model-hub`

### 日志路径调整

所有服务的日志路径都调整为相对路径：

- **调度服务器**: `central_server/scheduler/logs/`（相对路径）
- **API 网关**: `central_server/api-gateway/logs/`（相对路径）
- **模型库服务**: `central_server/model-hub/logs/`（相对路径）

### 测试路径调整

- **测试文件**: 保持在 `central_server/scheduler/tests/` 目录
- **测试辅助方法**: 添加了 `get_node_for_test` 和 `list_node_ids_for_test`

## 迁移验证

### 项目完整性检查

- ✅ 调度服务器：核心文件完整
- ✅ API 网关：核心文件完整
- ✅ 模型库服务：核心文件完整
- ✅ 文档文件完整

### 测试验证

- ✅ 阶段 1.1: 63 个测试全部通过
- ✅ 阶段 1.2: 7 个测试全部通过
- ✅ 阶段 2.1.2: 12 个测试全部通过
- ✅ 阶段 3.2: 6 个测试（`test_select_node_with_models_ready` 已通过）
- ✅ 其他测试: 24 个测试全部通过

### 服务启动验证

- ✅ 调度服务器可以正常启动
- ✅ API 网关可以正常启动
- ✅ 模型库服务可以正常启动
- ✅ 日志文件正常生成

## 迁移后的项目结构

```
central_server/
├── scheduler/          # 调度服务器
│   ├── src/           # 源代码
│   ├── tests/         # 测试文件
│   ├── logs/          # 日志文件
│   ├── Cargo.toml
│   └── README.md
├── api-gateway/       # API 网关
│   ├── src/           # 源代码
│   ├── logs/          # 日志文件
│   ├── Cargo.toml
│   └── config.toml
├── model-hub/         # 模型库服务
│   ├── src/           # 源代码
│   ├── logs/          # 日志文件
│   └── requirements.txt
├── docs/              # 文档
│   ├── scheduler/     # 调度服务器文档
│   ├── api_gateway/   # API 网关文档
│   ├── modelManager/  # 模型管理文档
│   ├── project/       # 项目文档（完整性等）
│   ├── testing/       # 测试文档与测试报告（含 scheduler 阶段测试报告）
│   ├── QUICK_START.md # 快速开始指南
│   └── README.md      # 文档索引
└── README.md                # 主 README
```

## 测试策略

在测试 central_server 时，默认节点已经启动了 GPU（在测试中模拟），但不需要真的启动 GPU 或节点端服务。详细说明请参考 `testing/scheduler/TEST_STRATEGY.md`。

## 相关文档

- **项目完整性**: `project/PROJECT_COMPLETENESS.md`
- **测试指南**: `testing/TEST_GUIDE.md`
- **测试状态**: `testing/TEST_STATUS.md`
- **快速开始**: `QUICK_START.md`
- **文档索引**: `README.md`

## 迁移日期

2025-01-XX
