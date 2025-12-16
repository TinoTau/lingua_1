# Lingua 分布式实时语音翻译系统

版本：v2.0.0  
基于分布式架构的实时语音翻译系统，支持多会话、多节点调度、可插拔模型、模块化功能。

## 项目概述

本系统是一个**可扩展、多会话、可插拔模型、可分布式计算、支持模块化功能**的实时语音翻译系统。

### 核心特性

- ✅ 支持实时语音翻译（连续输入 + 连续输出）
- ✅ 支持多语种与后续扩展的方言模型
- ✅ 支持多会话并行，一个会话对应一条 WebSocket 连接
- ✅ 支持多种产品形态：
  - 会话设备：手机 App（Android / iOS）、**Web 客户端（iOS 开发设备替代方案）**
  - 调度服务器：云端服务端
  - 第三方客户端：PC 端 Electron Node 客户端
- ✅ 支持用户贡献自己的 PC（CPU + GPU）作为算力节点
- ✅ 手机端采用 **"轻量 VAD + 手动截断按钮"** 的分句策略
- ✅ 调度服务器负责任务拆分、节点调度、结果聚合
- ✅ **模块化功能设计**：支持实时启用/禁用可选功能模块
- ✅ **可选功能模块**：音色识别、音色生成、语速识别、语速控制等
- ✅ **对外开放 API**：支持第三方应用通过 REST/WebSocket API 接入
- ✅ **多租户支持**：每个外部应用作为独立租户，支持 API Key 鉴权和限流

## 项目结构

```
lingua_1/
├── webapp/                    # Web 客户端
│   ├── src/                  # 源代码
│   ├── tests/                # 测试
│   └── docs/                 # Web 客户端文档
│
├── central_server/            # 中央服务器
│   ├── scheduler/            # 调度服务器
│   ├── api-gateway/          # API 网关
│   ├── model-hub/            # 模型库服务
│   └── docs/                 # 中央服务器文档
│
├── electron_node/             # Electron 节点客户端
│   ├── electron-node/        # Electron 应用
│   ├── node-inference/       # 节点推理服务（Rust）
│   ├── services/             # Python 服务（NMT、TTS、YourTTS）
│   └── docs/                 # 节点客户端文档
│
├── scripts/                   # 启动脚本
├── shared/                    # 共享代码（协议定义等）
└── expired/                   # 备份代码（旧版本）
```

## 快速开始

### 1. Web 客户端

```bash
cd webapp
npm install
npm run dev
```

详细文档：`webapp/docs/README.md`

### 2. 中央服务器

#### 调度服务器
```bash
cd central_server/scheduler
cargo build --release
cargo run --release
```

#### API 网关
```bash
cd central_server/api-gateway
cargo build --release
cargo run --release
```

#### 模型库服务
```bash
cd central_server/model-hub
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

详细文档：`central_server/docs/README.md`

### 3. Electron 节点客户端

```bash
cd electron_node/electron-node
npm install
npm run build
npm start
```

详细文档：`electron_node/docs/README.md`

## 系统架构

```
┌─────────────┐
│  Web Client │ (webapp/)
└──────┬──────┘
       │ WebSocket
       ▼
┌─────────────────────────────────────┐
│      Central Server                 │
│  - Scheduler (调度服务器)            │
│  - API Gateway (API 网关)           │
│  - Model Hub (模型库)                │
└──────┬──────────────────┬───────────┘
       │                  │
       │ WebSocket        │ WebSocket
       ▼                  ▼
┌─────────────┐    ┌─────────────┐
│ Electron    │    │ Electron    │
│ Node Client │    │ Node Client │
│ (electron_  │    │ (electron_  │
│  node/)     │    │  node/)     │
└─────────────┘    └─────────────┘
```

## 技术栈

### Web 客户端 (webapp/)
- **框架**: TypeScript + Vite
- **功能**: 实时语音采集、WebSocket 通信、TTS 播放

### 中央服务器 (central_server/)
- **调度服务器**: Rust + Tokio + Axum
- **API 网关**: Rust + Tokio + Axum
- **模型库服务**: Python + FastAPI

### Electron 节点客户端 (electron_node/)
- **Electron 应用**: Electron + Node.js + TypeScript + React
- **推理服务**: Rust + ONNX Runtime
- **Python 服务**: Python (NMT、TTS、YourTTS)

## 文档

- **Web 客户端文档**: `webapp/docs/`
  - 迁移文档: `webapp/docs/MIGRATION.md`
- **中央服务器文档**: `central_server/docs/`
  - 迁移文档: `central_server/docs/MIGRATION.md`
- **节点客户端文档**: `electron_node/docs/`
  - 迁移文档: `electron_node/docs/MIGRATION.md`
  - 项目完整性: `electron_node/PROJECT_COMPLETENESS.md`
  - 测试状态: `electron_node/TEST_STATUS.md`
- **项目级文档**: `docs/`
  - 项目迁移: `docs/PROJECT_MIGRATION.md`
  - 项目重组指南: `PROJECT_REORGANIZATION_GUIDE.md`

## 开发指南

详细开发指南请参考各模块的 `docs/` 目录。

## 项目迁移

项目已按照产品设计重新组织，从 `expired/` 文件夹迁移到新的目录结构：

- ✅ **Web 客户端**: 已迁移到 `webapp/`，114 个测试全部通过
- ✅ **中央服务器**: 已迁移到 `central_server/`，106+ 个测试通过
- ✅ **Electron 节点客户端**: 已迁移到 `electron_node/`，核心功能测试 100% 通过
- ✅ **路径调整**: 所有启动脚本和日志路径已更新为相对路径

详细迁移内容请参考：
- `docs/PROJECT_MIGRATION.md` - 项目迁移总览
- `webapp/docs/MIGRATION.md` - Web 客户端迁移详情
- `central_server/docs/MIGRATION.md` - 中央服务器迁移详情
- `electron_node/docs/MIGRATION.md` - Electron 节点客户端迁移详情

## 许可证

[许可证信息]
