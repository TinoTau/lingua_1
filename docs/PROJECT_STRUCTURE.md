# 项目结构文档

## 系统架构概述

Lingua 系统采用**三层架构**设计：

1. **客户端层** - 三个不同类型的客户端
2. **服务层** - 中央服务器（调度、网关、模型库）
3. **算力层** - 分布式节点（提供推理算力）

详细架构说明请参考：[系统架构文档](./SYSTEM_ARCHITECTURE.md)

## 当前项目结构

```
lingua_1/
├── webapp/                    # Web端客户端
│   ├── web-client/           # Web客户端项目
│   │   ├── src/              # 源代码
│   │   │   ├── main.ts       # 应用入口
│   │   │   ├── app.ts        # 主应用类
│   │   │   ├── state_machine.ts  # 状态机
│   │   │   ├── recorder.ts       # 录音模块
│   │   │   ├── websocket_client.ts # WebSocket客户端
│   │   │   ├── tts_player.ts     # TTS播放器
│   │   │   ├── asr_subtitle.ts   # ASR字幕
│   │   │   └── audio_mixer.ts    # 音频混控器
│   │   ├── tests/            # 测试文件
│   │   ├── logs/             # 日志文件
│   │   └── package.json
│   ├── mobile-app/           # 移动应用（参考）
│   └── docs/                 # Web客户端文档
│       ├── webClient/        # Web客户端文档
│       ├── webRTC/           # WebRTC文档
│       ├── QUICK_START.md    # 快速开始指南
│       ├── MIGRATION.md      # 迁移文档
│       └── README.md         # 文档索引
│
├── central_server/            # 公司端（服务器）
│   ├── scheduler/            # 调度服务器（端口 5010）
│   │   ├── src/              # 源代码
│   │   │   ├── session.rs     # 会话管理
│   │   │   ├── dispatcher.rs # 任务分发
│   │   │   ├── node_registry/ # 节点注册表
│   │   │   ├── websocket/    # WebSocket处理
│   │   │   └── ...
│   │   ├── tests/            # 测试文件
│   │   ├── logs/             # 日志文件
│   │   └── Cargo.toml
│   ├── model-hub/            # 模型库服务（端口 5000）
│   │   ├── src/              # 源代码
│   │   │   └── main.py       # FastAPI应用
│   │   ├── models/           # 模型文件存储
│   │   ├── logs/             # 日志文件
│   │   └── requirements.txt
│   ├── api-gateway/          # API网关（待开发）
│   │   ├── src/              # 源代码
│   │   │   ├── rest_api.rs   # REST API
│   │   │   ├── ws_api.rs     # WebSocket API
│   │   │   ├── auth.rs       # 鉴权
│   │   │   ├── tenant.rs     # 租户管理
│   │   │   └── rate_limit.rs # 限流
│   │   ├── logs/             # 日志文件
│   │   └── Cargo.toml
│   └── docs/                 # 中央服务器文档
│       ├── scheduler/        # 调度服务器文档
│       ├── api_gateway/      # API网关文档
│       ├── QUICK_START.md    # 快速开始指南
│       ├── MIGRATION.md      # 迁移文档
│       └── README.md         # 文档索引
│
├── electron_node/             # 节点端客户端（算力提供方）
│   ├── electron-node/        # Electron应用
│   │   ├── main/src/        # 主进程源代码（TypeScript）
│   │   │   ├── rust-service-manager/ # Rust服务管理
│   │   │   ├── model-manager/        # 模型管理
│   │   │   └── node-agent/           # 节点代理
│   │   ├── renderer/        # 渲染进程代码（React）
│   │   ├── tests/           # 测试文件
│   │   └── logs/            # Electron主进程日志
│   ├── services/             # 所有节点端服务（统一目录）
│   │   ├── node-inference/  # 节点推理服务（Rust）
│   │   │   ├── src/         # 源代码
│   │   │   │   ├── asr.rs    # ASR引擎（Whisper）
│   │   │   │   ├── nmt.rs    # NMT引擎（M2M100）
│   │   │   │   ├── tts.rs    # TTS引擎（Piper/YourTTS）
│   │   │   │   ├── vad.rs    # VAD引擎（Silero）
│   │   │   │   └── inference_service.rs # 推理服务
│   │   │   ├── tests/       # 测试文件
│   │   │   ├── models/      # 模型文件
│   │   │   └── logs/        # 日志文件
│   │   ├── nmt_m2m100/      # NMT服务（Python，端口 5008）
│   │   ├── piper_tts/       # TTS服务（Python，端口 5006）
│   │   └── your_tts/        # YourTTS服务（Python，端口 5004，可选）
│   ├── docs/                 # 节点客户端文档
│   │   ├── PATH_STRUCTURE.md    # 路径结构文档
│   │   ├── MIGRATION.md         # 迁移文档
│   │   ├── SERVICE_HOT_PLUG_VERIFICATION.md  # 服务热插拔验证报告
│   │   └── YOURTTS_INTEGRATION_IMPLEMENTATION.md  # YourTTS集成实现文档
│   ├── PROJECT_COMPLETENESS.md  # 项目完整性报告
│   ├── TEST_STATUS.md           # 测试状态
│   └── TEST_EXECUTION_REPORT.md # 测试执行报告
│
├── scripts/                   # 启动脚本
│   ├── start_webapp.ps1      # 启动Web端
│   ├── start_central_server.ps1  # 启动服务层
│   ├── start_electron_node.ps1   # 启动节点端
│   ├── start_scheduler.ps1   # 启动调度服务器
│   ├── start_api_gateway.ps1 # 启动API网关
│   └── start_model_hub.ps1   # 启动模型库服务
│
├── shared/                    # 共享代码（协议定义等）
│   └── protocols/            # 消息协议定义
│       ├── messages.ts       # TypeScript类型定义
│       └── messages.js       # JavaScript类型定义
│
├── docs/                      # 项目级文档
│   ├── SYSTEM_ARCHITECTURE.md # 系统架构文档（新增）
│   ├── logging/              # 日志和可观测性文档
│   ├── project_management/   # 项目管理文档
│   ├── reference/            # 参考文档
│   ├── testing/              # 测试文档
│   ├── PROJECT_MIGRATION.md  # 项目迁移文档
│   └── README.md             # 文档索引
│
└── expired/                   # 备份代码（旧版本）
```

## 三个客户端说明

### 1. Web端 (`webapp/web-client/`)

- **定位**: 浏览器端实时翻译客户端
- **技术栈**: TypeScript + Vite
- **连接方式**: 直接 WebSocket 连接到 Scheduler
- **端口**: 9001 (客户端), 5010 (Scheduler)
- **功能**: 实时语音采集、WebSocket 通信、TTS 播放、ASR 字幕

### 2. 公司端 (`central_server/`)

- **定位**: 公司内部部署的服务器
- **组成**: 
  - **调度服务器 (Scheduler)** - `central_server/scheduler/`
  - **模型库服务 (Model Hub)** - `central_server/model-hub/`
- **技术栈**: 
  - 调度服务器: Rust + Tokio + Axum
  - 模型库服务: Python + FastAPI
- **端口**: 
  - 调度服务器: 5010
  - 模型库服务: 5000
- **功能**: 
  - 调度服务器: 会话管理、任务分发、节点调度、结果聚合
  - 模型库服务: 模型元数据管理、模型文件下载、模型统计
- **连接**: 
  - Web端通过 WebSocket 连接到调度服务器
  - 节点端通过 WebSocket 连接到调度服务器（节点注册）
  - 节点端通过 HTTP 访问模型库服务（模型下载）

**注**: API Gateway (API网关) 为待开发功能，暂未包含在公司端中

### 3. 节点端 (`electron_node/`)

- **定位**: PC 端算力提供节点
- **技术栈**: Electron + Node.js + TypeScript + React + Rust
- **连接方式**: WebSocket 连接到 Scheduler（节点注册）
- **端口**: 5010 (Scheduler)
- **功能**: 节点注册、模型管理、推理服务（ASR/NMT/TTS/VAD）

## 路径说明

### 相对路径

所有服务和脚本都使用相对路径（相对于项目根目录）：

- **Web端**: `webapp/web-client/`
- **调度服务器**: `central_server/scheduler/`
- **API 网关**: `central_server/api-gateway/`（公司端接入点）
- **模型库服务**: `central_server/model-hub/`
- **节点端**: `electron_node/`
- **日志文件**: 各服务目录下的 `logs/` 子目录

### 启动脚本路径

所有启动脚本位于 `scripts/` 目录，使用相对路径引用项目目录：

- `scripts/start_webapp.ps1` → `webapp/web-client/`
- `scripts/start_central_server.ps1` → 启动公司端（Scheduler + Model Hub）
- `scripts/start_electron_node.ps1` → `electron_node/electron-node/`
- `scripts/start_scheduler.ps1` → `central_server/scheduler/`
- `scripts/start_model_hub.ps1` → `central_server/model-hub/`

## 迁移历史

项目已从 `expired/` 文件夹迁移到新的目录结构。详细迁移内容请参考：

- **项目迁移总览**: `PROJECT_MIGRATION.md`
- **Web 客户端迁移**: `../webapp/docs/MIGRATION.md`
- **中央服务器迁移**: `../central_server/docs/MIGRATION.md`
- **Electron 节点客户端迁移**: `../electron_node/docs/MIGRATION.md`

## 相关文档

- **项目迁移**: `PROJECT_MIGRATION.md`
- **项目重组指南**: `../PROJECT_REORGANIZATION_GUIDE.md`
- **Web 客户端文档**: `../webapp/docs/README.md`
- **中央服务器文档**: `../central_server/docs/README.md`
