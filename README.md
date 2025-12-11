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
  - 会话设备：手机 App（Android / iOS）
  - 调度服务器：云端服务端
  - 第三方客户端：PC 端 Electron Node 客户端
- ✅ 支持用户贡献自己的 PC（CPU + GPU）作为算力节点
- ✅ 手机端采用 **"轻量 VAD + 手动截断按钮"** 的分句策略
- ✅ 调度服务器负责任务拆分、节点调度、结果聚合
- ✅ **模块化功能设计**：支持实时启用/禁用可选功能模块
- ✅ **可选功能模块**：音色识别、音色生成、语速识别、语速控制等
- ✅ **对外开放 API**：支持第三方应用通过 REST/WebSocket API 接入
- ✅ **多租户支持**：每个外部应用作为独立租户，支持 API Key 鉴权和限流

## 系统架构

```
┌───────────────────────── 会话设备（手机 App） ──────────────────────────┐
│ - 采集语音 + 本地轻量 VAD                                              │
│ - 手动截断按钮（结束当前句子）                                          │
│ - 将句级音频作为 utterance 发送到调度服务器                                │
│ - 接收翻译文本 + TTS 音频                                               │
│ - 可选功能选择（音色识别、语速控制等）                                    │
└───────────────────────────────▲────────────────────────────────────────┘
                                │ wss://dispatcher.example.com/ws/session
                                │
┌───────────────────────── 外部应用（Web/App/IM） ────────────────────────┐
│ - 通过 REST/WebSocket API 接入                                          │
│ - API Key 鉴权                                                          │
└───────────────────────────────▲────────────────────────────────────────┘
                                │ https/wss://api.example.com
                                │
                                ▼
┌──────────────────────────── API Gateway ───────────────────────────────┐
│ - REST API: POST /v1/speech/translate                                  │
│ - WebSocket API: /v1/stream                                            │
│ - 鉴权、限流、协议转换                                                  │
└───────────────────────────────▲────────────────────────────────────────┘
                                │ 内部 WebSocket
                                │
                                ▼
┌──────────────────────────── 调度服务器 ────────────────────────────────┐
│ ① Session Manager（会话管理，支持多租户）                                │
│ ② Job Dispatcher / Scheduler（任务分发与调度）                          │
│ ③ Node Registry（节点注册表，支持功能感知选择）                          │
│ ④ Pairing Service（6位安全码配对服务）                                  │
│ ⑤ Model Registry & Model Hub（模型库管理）                              │
└───────────────────────────────▲────────────────────────────────────────┘
                                │ wss + https
                                ▼
┌──────────────────── 第三方 PC 节点（Electron Node 客户端） ───────────────────┐
│ Electron App                                                           │
│  - 主进程（Main Process, Node.js）                                      │
│      - Node Agent（WebSocket 连接调度服务器）                              │
│      - Model Manager（模型管理）                                         │
│      - Inference Service（本地模型推理，支持模块化）                        │
│      - Module Manager（模块状态管理）                                    │
│  - 渲染进程（Renderer, 前端界面）                                         │
│      - 系统资源监控面板                                                  │
│      - 模型管理界面                                                      │
│      - 功能模块管理界面（启用/禁用可选功能）                               │
└────────────────────────────────────────────────────────────────────────┘
```

## 模块化功能设计

### 核心模块（必需）

- **ASR** (语音识别) - Whisper
- **NMT** (机器翻译) - M2M100
- **TTS** (语音合成) - Piper TTS
- **VAD** (语音活动检测) - Silero VAD

### 可选模块（可动态启用/禁用）

- 🔧 **Speaker Identification** (音色识别)
- 🔧 **Voice Cloning** (音色生成/克隆)
- 🔧 **Speech Rate Detection** (语速识别)
- 🔧 **Speech Rate Control** (语速生成/控制)
- 🔧 **Emotion Detection** (情感分析)
- 🔧 **Persona Adaptation** (个性化适配)

### 模块化特性

✅ **模块独立性**: 每个模块可以独立启用/禁用，互不影响  
✅ **运行时切换**: 无需重启服务即可切换模块状态  
✅ **优雅降级**: 模块禁用时，系统仍能正常工作  
✅ **按需加载**: 模块只在需要时加载模型，节省资源  
✅ **客户端控制**: 客户端可以按需选择功能

### 使用示例

#### 节点端启用/禁用模块

```rust
// 启用音色识别模块
inference_service.enable_module("speaker_identification").await?;

// 禁用语速控制模块
inference_service.disable_module("speech_rate_control").await?;
```

#### 客户端请求指定功能

```typescript
const message = {
    type: 'utterance',
    session_id: 's-123',
    utterance_index: 1,
    src_lang: 'zh',
    tgt_lang: 'en',
    audio: base64Audio,
    features: {
        speaker_identification: true,  // 启用音色识别
        voice_cloning: true,           // 启用音色生成
        speech_rate_detection: true,   // 启用语速识别
        speech_rate_control: false,    // 禁用语速控制
    }
};
```

## 技术栈

### 调度服务器
- **语言**: Rust + Tokio
- **框架**: Axum (HTTP/WebSocket)
- **数据库**: SQLite / PostgreSQL（可选）

### API Gateway
- **语言**: Rust + Tokio
- **框架**: Axum (HTTP/WebSocket)
- **功能**: 鉴权、限流、协议转换

### Electron Node 客户端
- **框架**: Electron
- **主进程**: Node.js + TypeScript
- **渲染进程**: React + TypeScript + Vite
- **推理引擎**: ONNX Runtime / PyTorch / Whisper-rs

### 移动端客户端
- **框架**: React Native + Expo
- **语言**: TypeScript
- **VAD**: WebRTC VAD / Silero VAD

### 模型库服务
- **语言**: Python
- **框架**: FastAPI
- **存储**: 文件系统 / 对象存储

### 节点推理服务
- **语言**: Rust
- **推理引擎**: ONNX Runtime, Whisper-rs
- **模型**: Whisper (ASR), M2M100 (NMT), Piper (TTS), Silero (VAD)

## 项目结构

```
lingua_1/
├── scheduler/                    # 调度服务器 (Rust)
│   ├── src/
│   │   ├── main.rs
│   │   ├── session.rs           # 会话管理
│   │   ├── dispatcher.rs        # 任务分发
│   │   ├── node_registry.rs     # 节点注册表
│   │   ├── pairing.rs           # 配对服务
│   │   ├── model_hub.rs         # 模型库接口
│   │   ├── websocket/           # WebSocket 处理模块
│   │   │   ├── mod.rs           # 模块声明和辅助函数
│   │   │   ├── session_handler.rs  # 会话端处理
│   │   │   └── node_handler.rs     # 节点端处理
│   │   ├── messages.rs          # 消息协议定义
│   │   └── config.rs            # 配置管理
│   ├── Cargo.toml
│   └── config.toml
│
├── electron-node/                # Electron Node 客户端
│   ├── main/                     # 主进程
│   │   ├── src/
│   │   │   ├── index.ts         # 主入口
│   │   │   ├── agent/           # Node Agent
│   │   │   ├── model-manager/   # 模型管理器
│   │   │   └── inference/       # 推理服务接口
│   │   └── preload.ts           # 预加载脚本
│   ├── renderer/                 # 渲染进程
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   └── components/      # UI 组件
│   │   └── index.html
│   ├── package.json
│   └── vite.config.ts
│
├── mobile-app/                   # 移动端客户端
│   ├── src/
│   │   ├── App.tsx
│   │   ├── hooks/
│   │   │   ├── useVAD.ts        # VAD 检测
│   │   │   └── useWebSocket.ts  # WebSocket 通信
│   │   └── components/
│   ├── package.json
│   └── app.json
│
├── model-hub/                    # 模型库服务
│   ├── src/
│   │   └── main.py              # FastAPI 服务
│   ├── requirements.txt
│   └── config.yaml
│
├── api-gateway/                  # 对外 API 网关
│   ├── src/
│   │   ├── main.rs              # 主入口
│   │   ├── tenant.rs            # 租户管理
│   │   ├── auth.rs              # 鉴权中间件
│   │   ├── rate_limit.rs        # 限流模块
│   │   ├── rest_api.rs          # REST API 处理
│   │   ├── ws_api.rs            # WebSocket API 处理
│   │   ├── scheduler_client.rs  # Scheduler 客户端
│   │   └── config.rs            # 配置管理
│   ├── Cargo.toml
│   ├── config.toml
│   └── README.md
│
├── node-inference/               # 节点推理服务
│   ├── src/
│   │   ├── main.rs              # 主入口
│   │   ├── asr.rs               # ASR 引擎
│   │   ├── nmt.rs               # NMT 引擎
│   │   ├── tts.rs               # TTS 引擎
│   │   ├── vad.rs               # VAD 引擎
│   │   ├── modules.rs           # 模块管理器
│   │   ├── speaker.rs           # 音色识别/生成
│   │   └── speech_rate.rs       # 语速识别/控制
│   ├── Cargo.toml
│   └── models/                  # 本地模型存储
│
├── shared/                       # 共享代码
│   └── protocols/
│       └── messages.ts          # 消息协议定义
│
├── scripts/                      # 脚本工具
│   ├── README.md                # 脚本工具说明
│   ├── copy_models.ps1          # 复制模型文件（Windows）
│   ├── copy_models.sh           # 复制模型文件（Linux/macOS）
│   ├── start_scheduler.ps1      # 启动调度服务器
│   ├── start_model_hub.ps1      # 启动模型库服务
│   ├── start_api_gateway.ps1    # 启动 API Gateway
│   └── start_all.ps1            # 一键启动所有服务
│
└── docs/                         # 文档
    ├── ARCHITECTURE.md          # 架构文档
    ├── GETTING_STARTED.md       # 快速开始指南
    ├── MODULAR_FEATURES.md      # 模块化功能设计（包含快速参考）
    ├── PROTOCOLS.md             # WebSocket 消息协议规范
    └── PUBLIC_API.md            # 对外开放 API 设计与实现
```

## 快速开始

### 前置要求

- **Rust**: 1.70+ (用于调度服务器和节点推理服务)
- **Node.js**: 18+ (用于 Electron 和移动端)
- **Python**: 3.10+ (用于模型库服务)
- **CUDA**: 12.1+ (可选，用于 GPU 加速)

### 1. 启动模型库服务

```powershell
cd model-hub
python -m venv venv
.\venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/macOS
pip install -r requirements.txt
python src/main.py
```

服务将在 `http://localhost:5000` 启动。

### 2. 启动调度服务器

```powershell
cd scheduler
cargo build --release
cargo run --release
```

服务将在 `http://localhost:8080` 启动。

### 3. 启动 API Gateway（可选）

如果需要对外提供 API 服务：

```powershell
cd api-gateway
cargo build --release
cargo run --release
```

服务将在 `http://localhost:8081` 启动。

### 4. 启动 Electron Node 客户端

```powershell
cd electron-node
npm install
npm run build
npm start
```

### 5. 启动移动端客户端

```powershell
cd mobile-app
npm install
npm start
```

### 一键启动（Windows）

```powershell
.\scripts\start_all.ps1
```

这将启动所有服务（模型库、调度服务器、API Gateway）。

详细说明请参考 [快速开始指南](./docs/GETTING_STARTED.md)

## 项目状态

### ✅ 已完成

#### 1. 项目框架搭建
- ✅ 完整的目录结构
- ✅ 配置文件（.gitignore, README 等）
- ✅ 启动脚本
- ✅ 模型文件已复制到项目

#### 2. 调度服务器 (Scheduler)
- ✅ Rust 项目结构
- ✅ 核心模块实现：
  - 会话管理 (Session Manager) - 支持多租户
  - 任务分发 (Job Dispatcher)
  - 节点注册表 (Node Registry) - 支持功能感知选择
  - 配对服务 (Pairing Service)
  - 模型库接口 (Model Hub)
  - WebSocket 处理模块（模块化设计：session_handler, node_handler）
- ✅ **消息协议定义** (`messages.rs`)：
  - 完整的消息类型定义（SessionMessage, NodeMessage）
  - FeatureFlags、PipelineConfig、InstalledModel 等辅助类型
  - 错误码枚举
- ✅ **数据结构扩展**：
  - Session 结构支持 `tenant_id`、`client_version`、`platform`、`dialect`、`features`
  - Job 结构支持 `dialect`、`features`、`pipeline`、`audio_format`、`sample_rate`
  - Node 结构支持 `version`、`platform`、`hardware`、`features_supported`、`accept_public_jobs`
- ✅ **WebSocket 消息处理实现**（模块化设计）：
  - 会话端消息处理（`websocket/session_handler.rs`）- session_init, utterance, heartbeat, session_close
  - 节点端消息处理（`websocket/node_handler.rs`）- node_register, node_heartbeat, job_result
  - 公共辅助函数（`websocket/mod.rs`）- 消息发送、错误处理等
  - 连接管理（SessionConnectionManager, NodeConnectionManager）
  - 结果队列管理（ResultQueueManager）- 支持乱序结果排序
- ✅ **单元测试**：
  - 阶段一.1 完整单元测试（46个测试，全部通过）
  - 覆盖所有核心模块（会话、任务分发、节点注册、配对、连接管理、结果队列）
- ✅ 配置文件

#### 3. API Gateway（对外 API 网关）
- ✅ 项目结构创建
- ✅ 核心模块实现：
  - 租户管理 (`tenant.rs`)
  - API Key 鉴权中间件 (`auth.rs`)
  - 限流模块 (`rate_limit.rs`)
  - REST API 处理 (`rest_api.rs`)
  - WebSocket API 处理 (`ws_api.rs`)
  - Scheduler 客户端 (`scheduler_client.rs`)
- ✅ 配置文件

#### 4. Electron Node 客户端
- ✅ Electron 项目结构
- ✅ 主进程实现：
  - Node Agent（WebSocket 连接）
  - Model Manager（模型管理）
  - Inference Service（推理服务接口）
- ✅ 渲染进程实现：
  - React UI 框架
  - 系统资源监控组件
  - 模型管理组件
- ✅ IPC 通信机制

#### 5. 移动端客户端
- ✅ React Native + Expo 项目
- ✅ VAD Hook 框架
- ✅ WebSocket Hook 框架
- ✅ 基础 UI 组件

#### 6. 模型库服务
- ✅ Python FastAPI 服务
- ✅ 模型元数据管理 API
- ✅ RESTful 接口
- ✅ 模型文件已复制

#### 7. 节点推理服务
- ✅ Rust 项目结构
- ✅ 核心模块框架：
  - ASR 引擎接口
  - NMT 引擎接口
  - TTS 引擎接口
  - VAD 引擎接口
- ✅ **模块化功能支持**：
  - 模块管理器 (Module Manager)
  - 音色识别/生成模块
  - 语速识别/控制模块
  - 动态启用/禁用机制
- ✅ 模型文件已复制

#### 8. 共享协议
- ✅ 消息协议定义 (TypeScript) - 与 Rust 端保持一致

#### 9. 文档
- ✅ 架构文档
- ✅ 快速开始指南
- ✅ 模块化功能设计文档
- ✅ 协议规范文档（包含实现状态）
- ✅ 对外开放 API 设计与实现文档

#### 10. 测试
- ✅ 阶段一.1 单元测试框架
- ✅ 测试目录结构（按阶段编号组织）
- ✅ 测试文档和报告

### 🔨 进行中 / 待完成

#### 1. 调度服务器
- [ ] 实现完整的任务分发算法（负载均衡优化）
- [ ] 功能感知节点选择完善（更智能的节点匹配）
- [ ] 添加数据库支持（可选，当前使用内存存储）
- [ ] 实现租户限流器（可选）
- [ ] 添加集成测试
- [ ] 性能测试和优化

#### 2. API Gateway
- [ ] 完善错误处理和日志
- [ ] 编写单元测试和集成测试
- [ ] 数据库集成（租户存储）
- [ ] 监控和告警
- [ ] 生产环境优化

#### 3. Electron Node 客户端
- [ ] **对齐消息格式**（高优先级）
  - [ ] `register` 消息格式对齐协议规范
  - [ ] `heartbeat` 消息格式对齐协议规范
  - [ ] `job_result` 消息格式对齐协议规范
- [ ] 集成节点推理服务（调用 Rust 库或 HTTP 服务）
- [ ] 完善模型下载和安装逻辑
- [ ] 实现系统资源监控
- [ ] 实现功能模块管理 UI
- [ ] 完善错误处理和重连机制

#### 4. 移动端客户端
- [ ] **对齐消息格式**（高优先级）
  - [ ] `init_session` 消息补充字段：`client_version`, `platform`, `dialect`, `features`
  - [ ] `utterance` 消息补充字段：`audio_format`, `sample_rate`, `dialect`, `features`
- [ ] 实现完整的 VAD 检测（WebRTC VAD 或 Silero VAD）
- [ ] 实现音频采集和处理
- [ ] 完善 WebSocket 通信
- [ ] 实现 TTS 音频播放
- [ ] 实现可选功能选择界面
- [ ] 添加 UI 优化

#### 5. 节点推理服务
- [ ] 实现 Whisper ASR 推理
- [ ] 实现 M2M100 NMT 推理
- [ ] 实现 Piper TTS 调用
- [ ] 实现 Silero VAD 检测
- [ ] 完善可选模块的模型加载逻辑
- [ ] 添加模型加载和缓存

#### 6. 模型库服务
- [ ] 实现模型文件存储
- [ ] 实现模型下载接口
- [ ] 添加模型版本管理
- [ ] 实现模型校验（SHA256）

#### 7. SDK 开发（可选）
- [ ] JS Web SDK
- [ ] Android SDK
- [ ] iOS SDK
- [ ] SDK 文档和示例

#### 8. 测试和优化
- [x] 单元测试（阶段一.1 已完成，46个测试全部通过）
- [ ] 集成测试
- [ ] 性能优化
- [ ] 错误处理完善
- [ ] 日志系统完善

## 开发计划

### 阶段一：核心功能实现（4-6 周）

#### 1.1 调度服务器核心功能
- [x] 项目框架搭建
- [x] 核心模块结构
- [x] 消息协议定义
- [x] 数据结构扩展（支持多租户、功能感知）
- [x] **WebSocket 消息处理实现**（高优先级，模块化设计）
  - [x] 会话端消息处理（`websocket/session_handler.rs`）- session_init, utterance, heartbeat, session_close
  - [x] 节点端消息处理（`websocket/node_handler.rs`）- node_register, node_heartbeat, job_result
  - [x] 公共辅助函数（`websocket/mod.rs`）- 消息发送、错误处理等
  - [x] 结果聚合和排序（按 utterance_index 顺序）
  - [x] WebSocket 连接管理（SessionConnectionManager, NodeConnectionManager）
- [x] **单元测试**（阶段一.1）
  - [x] 会话管理测试（7个测试）
  - [x] 任务分发测试（6个测试）
  - [x] 节点注册表测试（10个测试）
  - [x] 配对服务测试（6个测试）
  - [x] 连接管理测试（8个测试）
  - [x] 结果队列测试（9个测试）
  - [x] 测试报告和文档
- [ ] 任务分发算法优化（负载均衡）
- [ ] 功能感知节点选择完善（更智能匹配）

#### 1.2 客户端消息格式对齐
- [ ] 移动端消息格式对齐协议规范
- [ ] Electron Node 消息格式对齐协议规范

#### 1.3 节点推理服务
- [ ] 实现 Whisper ASR 推理
- [ ] 实现 M2M100 NMT 推理
- [ ] 实现 Piper TTS 调用
- [ ] 实现 Silero VAD 检测

### 阶段二：移动端和 Electron 客户端（3-4 周）

#### 2.1 移动端客户端
- [x] 项目框架搭建
- [x] VAD Hook 框架
- [x] WebSocket Hook 框架
- [ ] 消息格式对齐
- [ ] 麦克风采集
- [ ] 轻量 VAD 实现
- [ ] 手动截断按钮
- [ ] WebSocket 通信完善
- [ ] TTS 音频播放
- [ ] 可选功能选择界面
- [ ] UI 优化

#### 2.2 Electron Node 客户端
- [x] Electron 项目初始化
- [x] Node Agent 框架
- [x] Model Manager 框架
- [x] 推理服务接口框架
- [x] UI 界面框架
- [ ] 消息格式对齐
- [ ] 推理服务集成
- [ ] 系统资源监控实现
- [ ] 功能模块管理 UI
- [ ] 模型下载和安装逻辑完善

### 阶段三：模型库与模块化功能（3-4 周）

#### 3.1 模型库服务
- [x] Model Registry API 框架
- [x] 模型文件已复制
- [ ] Model Hub REST API 完善
- [ ] 模型下载与安装实现
- [ ] 模型版本管理
- [ ] 模型校验（SHA256）

#### 3.2 模块化功能实现
- [x] 模块化架构设计
- [x] 模块管理器实现
- [x] 可选模块框架
- [ ] 音色识别模型集成
- [ ] 音色生成模型集成
- [ ] 语速识别实现
- [ ] 语速控制实现
- [ ] Electron UI 集成

### 阶段四：对外开放 API（2-3 周）

#### 4.1 API Gateway 完善
- [x] 项目框架搭建
- [x] 核心模块实现（租户管理、鉴权、限流、REST/WebSocket API）
- [x] Scheduler 扩展（tenant_id 支持）
- [ ] 错误处理和日志完善
- [ ] 单元测试和集成测试
- [ ] 数据库集成（租户存储）

#### 4.2 SDK 开发（可选）
- [ ] JS Web SDK
- [ ] Android SDK
- [ ] iOS SDK
- [ ] SDK 文档和示例

### 阶段五：联调与优化（2-3 周）
- [ ] 全链路联调
- [ ] 性能优化
- [ ] 稳定性测试
- [ ] 模块化功能测试
- [ ] API Gateway 生产环境优化
- [ ] 监控和告警系统

## 相关文档

### 核心文档

- [系统设计文档](./distributed_speech_translation_design_electron.md) - 完整的系统设计方案
- [技术架构报告](./docs/v0.1版本项目架构与技术报告.md) - 之前版本的技术架构参考
- [架构文档](./docs/ARCHITECTURE.md) - 系统架构详细说明
- [快速开始指南](./docs/GETTING_STARTED.md) - 快速上手指南
- [模块化功能设计](./docs/MODULAR_FEATURES.md) - 模块化功能设计（包含快速参考）
- [协议规范](./docs/PROTOCOLS.md) - WebSocket 消息协议规范
- [对外开放 API](./docs/PUBLIC_API.md) - 对外 API 设计与实现

### 脚本和工具文档

- [脚本工具说明](./scripts/README.md) - 脚本工具使用说明

## 核心优势

1. **分布式架构**: 支持多节点并行处理，可扩展性强
2. **模块化设计**: 核心功能与可选功能分离，灵活可配置
3. **实时切换**: 支持运行时动态启用/禁用功能模块
4. **隐私保护**: 支持随机节点模式和指定节点模式
5. **低延迟**: 轻量 VAD + 手动截断，减少延迟
6. **可扩展性**: 易于添加新的可选功能模块
7. **对外开放**: 支持第三方应用通过 REST/WebSocket API 接入
8. **多租户**: 每个外部应用作为独立租户，支持 API Key 鉴权和限流

## 许可证

[待定]

## 贡献

欢迎贡献代码、报告问题或提出建议！
