# Lingua 系统架构文档

**版本**: v2.0.0  
**最后更新**: 2025-01-XX

---

## 📐 系统架构概览

Lingua 是一个**分布式实时语音翻译系统**，采用**三层架构**设计：

1. **客户端层** - 三个不同类型的客户端
2. **服务层** - 公司端服务器（调度服务器、模型库）
3. **算力层** - 分布式节点（提供推理算力）

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端层 (Clients)                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│  │  Web端   │    │  公司端  │    │  节点端  │             │
│  │(浏览器端)│    │(服务器端)│    │(算力提供)│             │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘             │
│       │               │                │                    │
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
└────────────────────────┼─────────────────────────────────────┘
                         │
                         │ WebSocket (任务分发)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    算力层 (Compute Nodes)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Node Client  │  │ Node Client  │  │ Node Client  │    │
│  │ (Electron)   │  │ (Electron)   │  │ (Electron)   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                    (提供 ASR/NMT/TTS 推理)                   │
└─────────────────────────────────────────────────────────────┘

注：API Gateway (API网关) 为待开发功能，暂未包含在公司端中
```

---

## 🎯 三个客户端详解

### 1. Web端 (Web Client)

**位置**: `webapp/web-client/`  
**技术栈**: TypeScript + Vite  
**连接方式**: 直接 WebSocket 连接到 Scheduler  
**端口**: 9001 (客户端), 5010 (Scheduler)

**功能特性**:
- ✅ 实时语音采集和播放
- ✅ 半双工状态机（输入/输出模式切换）
- ✅ ASR 实时字幕显示
- ✅ 会话模式（持续输入+输出）
- ✅ 双向模式（面对面翻译）
- ✅ 会议室模式（WebRTC 原声传递）
- ✅ 功能选择（模块化功能）

**连接端点**: `ws://localhost:5010/ws/session`

**适用场景**:
- 个人用户使用
- 浏览器端实时翻译
- 演示和测试

---

### 2. 公司端 (Company Server)

**位置**: `central_server/`  
**组成**: 
- **调度服务器 (Scheduler)** - `central_server/scheduler/`
- **模型库服务 (Model Hub)** - `central_server/model-hub/`

**技术栈**:
- **调度服务器**: Rust + Tokio + Axum
- **模型库服务**: Python + FastAPI

**端口**:
- 调度服务器: 5010
- 模型库服务: 5000

**功能特性**:

#### 调度服务器 (Scheduler)
- ✅ 会话生命周期管理
- ✅ 任务分发与负载均衡
- ✅ 节点注册与心跳监控
- ✅ Utterance Group 管理
- ✅ 会议室管理（WebRTC 信令）
- ✅ 模块依赖解析和节点选择
- ✅ WebSocket 连接管理（Web端和节点端）

#### 模型库服务 (Model Hub)
- ✅ 模型元数据管理（列表查询、详情查询、版本管理）
- ✅ 模型文件下载（支持断点续传）
- ✅ 模型统计（热门模型排行）
- ✅ 文件校验（SHA256）
- ✅ 路径安全（防止路径遍历攻击）

**连接端点**:
- 调度服务器: `ws://localhost:5010/ws/session` (Web端), `ws://localhost:5010/ws/node` (节点端)
- 模型库服务: `http://localhost:5000/api/models`

**适用场景**:
- 公司内部部署的服务器
- 提供调度和模型管理服务
- 支持 Web端和节点端的连接

**架构说明**:
```
Web端 → WebSocket → [Scheduler] ← WebSocket ← 节点端
                          │
                          ↓ HTTP
                    [Model Hub]
                    (模型下载和管理)
```

**注**: API Gateway (API网关) 为待开发功能，暂未包含在公司端中

---

### 3. 节点端 (Node Client)

**位置**: `electron_node/`  
**技术栈**: Electron + Node.js + TypeScript + React + Rust  
**连接方式**: WebSocket 连接到 Scheduler（节点注册）  
**端口**: 5010 (Scheduler)

**功能特性**:
- ✅ 节点注册和心跳
- ✅ 系统资源监控（CPU/GPU/内存）
- ✅ 模型管理（下载、安装、更新）
- ✅ 推理服务管理（ASR/NMT/TTS/VAD）
- ✅ 模块化功能支持（动态启用/禁用）
- ✅ 服务热插拔（Python 服务）

**连接端点**: `ws://localhost:5010/ws/node`

**适用场景**:
- 个人 PC 贡献算力
- 企业内部分布式算力池
- GPU 资源提供

**节点端架构**:
```
Electron App (主进程)
    ├── Node Agent (WebSocket 连接)
    ├── Model Manager (模型管理)
    └── Service Manager (服务管理)
            │
            ├── Node Inference Service (Rust)
            │   ├── ASR (Whisper)
            │   ├── NMT (M2M100)
            │   ├── TTS (Piper/YourTTS)
            │   └── VAD (Silero)
            │
            └── Python Services
                ├── NMT Service (端口 5008)
                ├── TTS Service (端口 5006)
                └── YourTTS Service (端口 5004)
```

---

## 🏗️ 公司端服务器架构

### Scheduler (调度服务器)

**位置**: `central_server/scheduler/`  
**技术栈**: Rust + Tokio + Axum  
**端口**: 5010

**核心功能**:
- 会话生命周期管理
- 任务分发与负载均衡
- 节点注册与心跳监控
- Utterance Group 管理
- 会议室管理（WebRTC 信令）
- 模块依赖解析和节点选择

**连接管理**:
- `/ws/session` - Web端会话连接
- `/ws/node` - 节点端注册连接

**详细文档**: [调度服务器文档](../central_server/docs/scheduler/README.md)

---

### Model Hub (模型库服务)

**位置**: `central_server/model-hub/`  
**技术栈**: Python + FastAPI  
**端口**: 5000

**核心功能**:
- 模型元数据管理
- 模型文件下载（支持断点续传）
- 模型统计（热门模型排行）
- 文件校验（SHA256）

**API 端点**:
- `GET /api/models` - 获取模型列表
- `GET /api/models/{model_id}` - 获取单个模型信息
- `GET /storage/models/{model_id}/{version}/{file_path}` - 下载模型文件
- `GET /api/model-usage/ranking` - 热门模型排行

**详细文档**: [模型库服务文档](../central_server/model-hub/README.md)

---

### API Gateway (API 网关) - 待开发

**位置**: `central_server/api-gateway/`  
**状态**: ⚠️ **待开发**（框架已创建，功能待完善）

**计划功能**:
- REST API 端点
- WebSocket API 端点
- API Key 鉴权
- 租户管理
- 请求限流
- 协议转换（外部 API ↔ 内部协议）

**注**: API Gateway 为未来功能，用于支持第三方应用接入，当前系统不依赖此组件。

---

## 🔄 数据流

### Web端数据流

```
用户语音输入
    ↓
[Web端] 采集音频 → WebSocket → [Scheduler]
    ↓                                    ↓
[Scheduler] 任务分发 → WebSocket → [Node Client]
    ↓                                    ↓
[Node Client] ASR → NMT → TTS → 返回结果
    ↓                                    ↓
[Scheduler] 结果聚合 → WebSocket → [Web端]
    ↓
[Web端] 播放 TTS 音频
```

### 公司端数据流（调度服务器和模型库）

```
[Web端] 请求翻译
    ↓ WebSocket
[Scheduler] 接收会话请求
    ↓
[Scheduler] 任务分发 → WebSocket → [Node Client]
    ↓                                    ↓
[Node Client] 需要模型 → HTTP → [Model Hub]
    ↓                                    ↓
[Model Hub] 返回模型文件
    ↓                                    ↓
[Node Client] ASR/NMT/TTS 推理
    ↓                                    ↓
[Scheduler] 接收结果并聚合
    ↓ WebSocket
[Web端] 接收翻译结果

[节点端] 需要下载模型
    ↓ HTTP
[Model Hub] 提供模型下载
    ↓
[节点端] 模型下载完成，更新能力状态
```

### 节点端数据流

```
[Scheduler] 任务分发
    ↓ WebSocket
[Node Client] 接收任务
    ↓
[Node Inference Service] ASR/NMT/TTS
    ↓
[Node Client] 返回结果
    ↓ WebSocket
[Scheduler] 接收结果
```

---

## 📁 目录结构对应关系

```
lingua_1/
├── webapp/                    # Web端
│   └── web-client/           # Web客户端项目
│
├── central_server/            # 公司端（服务器）
│   ├── scheduler/            # 调度服务器（端口 5010）
│   ├── model-hub/            # 模型库服务（端口 5000）
│   └── api-gateway/          # API网关（待开发）
│
├── electron_node/             # 节点端
│   ├── electron-node/        # Electron应用
│   └── services/             # 推理服务
│       ├── node-inference/  # Rust推理服务
│       ├── nmt_m2m100/      # NMT服务
│       ├── piper_tts/       # TTS服务
│       └── your_tts/        # YourTTS服务
│
└── scripts/                   # 启动脚本
    ├── start_webapp.ps1      # 启动Web端
    ├── start_central_server.ps1  # 启动公司端（Scheduler + Model Hub）
    └── start_electron_node.ps1   # 启动节点端
```

---

## 🔌 连接关系总结

| 客户端 | 连接目标 | 协议 | 端口 | 用途 |
|--------|---------|------|------|------|
| **Web端** | Scheduler | WebSocket | 5010 | 直接连接，实时翻译 |
| **公司端** | - | - | - | 服务器端（Scheduler + Model Hub） |
| **节点端** | Scheduler | WebSocket | 5010 | 节点注册，提供算力 |
| **节点端** | Model Hub | HTTP | 5000 | 模型下载和管理 |

**公司端说明**:
- **Scheduler** (端口 5010): 接收 Web端和节点端的连接，负责任务调度
- **Model Hub** (端口 5000): 提供模型下载服务，节点端通过 HTTP 访问

---

## 🚀 启动顺序

### 开发环境

1. **启动公司端**（调度服务器和模型库）
   ```powershell
   .\scripts\start_central_server.ps1
   ```
   - 启动 Scheduler (5010)
   - 启动 Model Hub (5000)

2. **启动节点端**（提供算力）
   ```powershell
   .\scripts\start_electron_node.ps1
   ```

3. **启动Web端**（用户界面）
   ```powershell
   .\scripts\start_webapp.ps1
   ```

### 生产环境

1. **公司端** - 部署 Scheduler 和 Model Hub（公司内部服务器）
2. **节点端** - 部署多个节点客户端（分布式算力池）
3. **Web端** - 通过浏览器访问，连接到公司端的 Scheduler

---

## 📚 相关文档

- [项目结构文档](./PROJECT_STRUCTURE.md) - 详细目录结构
- [开发计划](./project_management/DEVELOPMENT_PLAN.md) - 功能开发计划
- [项目状态](./project_management/PROJECT_STATUS.md) - 当前项目状态
- [调度服务器文档](../central_server/docs/scheduler/README.md) - 调度服务器详细文档
- [模型库服务文档](../central_server/model-hub/README.md) - 模型库服务详细文档
- [Web端文档](../webapp/docs/README.md) - Web客户端文档
- [节点端文档](../electron_node/docs/README.md) - 节点客户端文档

---

**返回**: [文档首页](./README.md)

