# Electron Node 迁移文档

## 迁移概述

Electron Node 客户端组件已从 `expired/` 文件夹迁移到 `electron_node/`，并按照新的项目结构进行了重组。

## 迁移内容

### Electron 应用

- **源路径**: `expired/electron-node/`
- **目标路径**: `electron_node/electron-node/`
- **迁移内容**:
  - ✅ Electron 主进程代码 (`main/src/`)
  - ✅ Electron 渲染进程代码 (`renderer/src/`)
  - ✅ 测试文件 (`tests/`)
  - ✅ 配置文件 (`package.json`, `tsconfig*.json`, `vite.config.ts`)
  - ✅ 构建配置 (`electron-builder.yml`)

### 节点推理服务 (Node Inference)

- **源路径**: `expired/node-inference/`
- **目标路径**: `electron_node/services/node-inference/`
- **迁移内容**:
  - ✅ Rust 源代码 (`src/`)
  - ✅ 测试文件 (`tests/`)
  - ✅ 配置文件 (`Cargo.toml`)
  - ✅ 模型文件 (`models/`)

### Python 服务

- **源路径**: `expired/services/`
- **目标路径**: `electron_node/services/`
- **迁移内容**:
  - ✅ NMT 服务 (`nmt_m2m100/`)
  - ✅ TTS 服务 (`piper_tts/`)
  - ✅ YourTTS 服务 (`your_tts/`)

### 文档迁移

- **Electron 应用文档**: `expired/docs/electron_node/` → `electron_node/docs/electron_node/`
- **节点推理服务文档**: `expired/docs/node_inference/` → `electron_node/docs/node_inference/`（如果存在）
- **节点注册文档**: `expired/docs/node_register/` → `electron_node/docs/node_register/`（如果存在）
- **模块化功能文档**: `expired/docs/modular/` → `electron_node/docs/modular/`

## 路径调整

### 统一的服务目录结构

所有节点端服务现在都位于 `electron_node/services/` 目录下：

- **Rust 推理服务**: `electron_node/services/node-inference/`
- **Python NMT 服务**: `electron_node/services/nmt_m2m100/`
- **Python TTS 服务**: `electron_node/services/piper_tts/`
- **Python YourTTS 服务**: `electron_node/services/your_tts/`

### 服务管理器路径解析

服务管理器已更新为仅支持新的目录结构：

- **Rust 服务管理器**: 查找 `electron_node/services/node-inference/` 目录
- **Python 服务管理器**: 查找 `electron_node/services/` 目录

所有向后兼容代码已移除，确保代码简洁且路径一致。

### 日志路径

所有服务的日志路径都使用相对路径（相对于项目根目录）：

- **Electron 主进程**: `electron_node/electron-node/logs/electron-main_*.log`
- **Rust 推理服务**: `electron_node/services/node-inference/logs/node-inference.log`
- **Python NMT 服务**: `electron_node/services/nmt_m2m100/logs/nmt-service_*.log`
- **Python TTS 服务**: `electron_node/services/piper_tts/logs/tts-service_*.log`
- **Python YourTTS 服务**: `electron_node/services/your_tts/logs/yourtts-service_*.log`

### 模型路径

- **模型文件**: `electron_node/services/node-inference/models/`（相对路径）
- **TTS 模型**: `electron_node/services/node-inference/models/tts/`
- **YourTTS 模型**: `electron_node/services/node-inference/models/tts/your_tts/`

详细路径结构请参考：`PATH_STRUCTURE.md`

## 迁移验证

### 项目完整性检查

- ✅ Electron 应用：核心文件完整
- ✅ 节点推理服务：核心文件完整
- ✅ Python 服务：核心文件完整
- ✅ 文档文件完整

### 测试验证

- ✅ Electron 应用测试：28/33 通过（84.8%，核心功能 100%）
  - ✅ ModelManager 核心功能：12/12 通过
  - ✅ 模型下载进度：6/6 通过
  - ✅ 错误处理：6/6 通过
  - ✅ 模型验证：4/4 通过
  - ⚠️ 模型库 API：0/5 通过（需要服务运行）
- ✅ 节点推理服务测试：测试框架已配置
- ✅ 模块化功能测试：22/22 通过（100%）

### 服务启动验证

- ✅ Electron 应用可以正常启动
- ✅ 节点推理服务可以正常启动（通过 Electron 管理）
- ✅ Python 服务可以正常启动（通过 Electron 管理）
- ✅ 日志文件正常生成

## 迁移后的项目结构

```
electron_node/
├── electron-node/          # Electron 应用
│   ├── main/              # 主进程代码（编译后）
│   ├── main/src/          # 主进程源代码（TypeScript）
│   ├── renderer/          # 渲染进程代码（React）
│   ├── tests/             # 测试文件
│   ├── logs/              # 日志文件
│   ├── package.json
│   └── tsconfig*.json
│
├── services/              # Python 和 Rust 服务
│   ├── node-inference/   # 节点推理服务（Rust）
│   │   ├── src/          # 源代码
│   │   ├── tests/        # 测试文件
│   │   ├── models/       # 模型文件
│   │   ├── logs/         # 日志文件
│   │   └── Cargo.toml
│   ├── nmt_m2m100/       # NMT 服务（Python）
│   ├── piper_tts/        # TTS 服务（Python）
│   └── your_tts/         # YourTTS 服务（Python）
│
├── docs/                  # 文档
│   ├── electron_node/    # Electron 应用文档
│   ├── modular/          # 模块化功能文档
│   └── README.md         # 文档索引
│
├── PROJECT_COMPLETENESS.md  # 项目完整性报告
├── TEST_STATUS.md            # 测试状态
├── TEST_EXECUTION_REPORT.md  # 测试执行报告
├── run_tests.ps1            # 测试执行脚本
└── README.md                # 主 README
```

## 相关文档

- **项目完整性**: `../PROJECT_COMPLETENESS.md`
- **测试状态**: `../TEST_STATUS.md`
- **测试执行报告**: `../TEST_EXECUTION_REPORT.md`
- **快速开始**: `../README.md`
- **文档索引**: `README.md`

## 迁移日期

2025-01-XX
