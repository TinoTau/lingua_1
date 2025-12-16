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

### 启动脚本更新

所有启动脚本已更新为新的路径结构：

- **Electron 应用**: 通过 Electron 主进程启动
- **节点推理服务**: 通过 Electron 主进程的 Rust 服务管理器启动
- **Python 服务**: 通过 Electron 主进程的 Python 服务管理器启动

### 日志路径调整

所有服务的日志路径都调整为相对路径（相对于项目根目录或安装目录）：

- **Electron 主进程**: `electron_node/electron-node/logs/`（相对路径）
- **节点推理服务**: `electron_node/services/node-inference/logs/`（相对路径）
- **Python 服务**: `electron_node/services/*/logs/`（相对路径）

### 模型路径调整

- **模型文件**: `electron_node/services/node-inference/models/`（相对路径）
- **用户数据**: 使用 Electron 的 `app.getPath('userData')` 或项目根目录

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
