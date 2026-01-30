# Lingua 分布式实时语音翻译系统

版本：v2.1.0  
基于分布式架构的实时语音翻译系统，支持多会话、多节点调度、可插拔模型、模块化功能。

## 项目概述

本系统是一个**可扩展、多会话、可插拔模型、可分布式计算、支持模块化功能**的实时语音翻译系统。

### 核心特性

- ✅ 支持实时语音翻译（连续输入 + 连续输出）
- ✅ 支持多语种与后续扩展的方言模型
- ✅ 支持多会话并行，一个会话对应一条 WebSocket 连接
- ✅ **平台化服务包管理**（2025-12-17）
  - 支持多平台服务包（Windows/Linux/macOS）
  - 服务包签名验证（SHA256 + Ed25519）
  - 原子安装和回滚机制
- ✅ **三种客户端形态**：
  - **Web端** (`webapp/web-client/`) - 浏览器端实时翻译客户端
  - **公司端** (`central_server/`) - 公司内部服务器（调度服务器 + 模型库服务）
  - **节点端** (`electron_node/`) - PC 端算力提供节点
- ✅ 支持用户贡献自己的 PC（CPU + GPU）作为算力节点
- ✅ 调度服务器负责任务拆分、节点调度、结果聚合
- ✅ **模块化功能设计**：支持实时启用/禁用可选功能模块
- ✅ **可选功能模块**：音色识别、音色生成、语速识别、语速控制等
- ✅ **对外开放 API**：支持第三方应用通过 REST/WebSocket API 接入
- ✅ **多租户支持**：每个外部应用作为独立租户，支持 API Key 鉴权和限流

## 项目结构

```
lingua_1/
├── webapp/                    # Web端客户端
│   ├── web-client/           # Web客户端项目
│   └── docs/                 # Web客户端文档
│
├── central_server/            # 公司端（服务器）
│   ├── scheduler/            # 调度服务器（端口 5010）
│   ├── model-hub/            # 模型库服务（端口 5000）
│   ├── api-gateway/          # API网关（待开发）
│   └── docs/                 # 公司端文档
│
├── electron_node/             # 节点端客户端
│   ├── electron-node/        # Electron应用
│   ├── services/             # 推理服务
│   │   ├── node-inference/  # 节点推理服务（Rust）
│   │   ├── nmt_m2m100/      # NMT服务（Python）
│   │   ├── piper_tts/       # TTS服务（Python）
│   │   ├── your_tts/        # YourTTS服务（Python）
│   │   ├── faster_whisper_vad/  # Faster Whisper VAD服务（Python，GPU加速）
│   │   └── speaker_embedding/  # Speaker Embedding服务（Python，GPU加速）
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
┌─────────────────────────────────────────────────────────────┐
│                      客户端层                                │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│  │  Web端   │    │  公司端  │    │  节点端  │             │
│  │(webapp/) │    │(API接入) │    │(electron_│             │
│  └────┬─────┘    └────┬─────┘    │  node/)  │             │
│       │               │           └────┬─────┘             │
└───────┼───────────────┼────────────────┼────────────────────┘
        │               │                │
        │ WebSocket     │ HTTP/内部协议  │ WebSocket
        │ (直接连接)     │                │ (节点注册)
        ▼               ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    服务层 (公司端服务器)                     │
│  ┌──────────────┐              ┌──────────────┐            │
│  │  Scheduler   │              │  Model Hub   │            │
│  │ (调度服务器)  │              │ (模型库服务)  │            │
│  │  端口: 5010  │              │  端口: 5000  │            │
│  └──────┬───────┘              └──────┬───────┘            │
│         │                              │                     │
│         └──────────────┬───────────────┘                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ WebSocket (任务分发)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    算力层 (Compute Nodes)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Node Client  │  │ Node Client  │  │ Node Client  │    │
│  │ (Electron)   │  │ (Electron)   │  │ (Electron)   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

详细架构说明请参考：[系统架构文档](docs/SYSTEM_ARCHITECTURE.md)

## 技术栈

### Web端 (webapp/web-client/)
- **框架**: TypeScript + Vite
- **功能**: 实时语音采集、WebSocket 通信、TTS 播放、ASR 字幕
- **连接**: 直接 WebSocket 连接到 Scheduler

### 公司端 (central_server/)
- **组成**: 调度服务器 (Scheduler) + 模型库服务 (Model Hub)
- **技术栈**: 
  - 调度服务器: Rust + Tokio + Axum (端口 5010)
  - 模型库服务: Python + FastAPI (端口 5000)
- **功能**: 
  - 调度服务器: 会话管理、任务分发、节点调度
  - 模型库服务: 模型管理、模型下载、平台化服务包管理（新增）
- **连接**: Web端和节点端连接到调度服务器

### 节点端 (electron_node/)
- **Electron 应用**: Electron + Node.js + TypeScript + React
- **推理服务**: Rust + ONNX Runtime
  - **ASR**: Whisper (GGML)
  - **VAD**: Silero VAD (ONNX) - 支持 Level 2 断句和上下文优化
  - **音频处理**: Opus 解码支持（opus-rs）
- **Python 服务**: 
  - **NMT**: M2M100 机器翻译服务（端口 5008）
  - **TTS**: Piper TTS 服务（端口 5006）
  - **YourTTS**: 零样本语音克隆服务（端口 5004）
  - **Faster Whisper VAD**: ASR + VAD 整合服务（端口 6007，GPU加速）
  - **Speaker Embedding**: 说话者特征提取服务（端口 5003，GPU加速）
- **连接**: WebSocket 连接到 Scheduler (节点注册)
- **GPU 加速**: 
  - Faster Whisper VAD 支持 CUDA 加速（10-20x 性能提升）
  - Speaker Embedding 支持 CUDA 加速（5-10x 性能提升）
- **音频优化**:
  - Opus 压缩支持（端到端）
  - VAD 语音段检测和静音过滤
  - VAD 上下文缓冲区优化

### 中央服务器 (central_server/)
- **调度服务器**: Rust + Tokio + Axum (端口 5010)
- **API 网关**: Rust + Tokio + Axum (端口 8081)
- **模型库服务**: Python + FastAPI (端口 5000)

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
