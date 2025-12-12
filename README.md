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

### Web 客户端（iOS 开发设备替代方案）✅
- **框架**: TypeScript + Vite
- **语言**: TypeScript
- **特性**: 半双工模式、Send 按钮、静音自动结束、ASR 字幕、Utterance Group
- **项目位置**: `web-client/`
- **文档**: [Web 客户端文档](./docs/webClient/README.md)

### 移动端客户端
- **框架**: React Native + Expo
- **语言**: TypeScript
- **VAD**: WebRTC VAD / Silero VAD
- **注意**: 由于没有 iOS 开发设备，已开发 Web 客户端作为替代方案

### 模型库服务
- **语言**: Python
- **框架**: FastAPI
- **存储**: 文件系统 / 对象存储

### 节点推理服务（阶段一.3）✅

#### 核心功能

**核心功能**：
- ✅ ASR (Whisper) 引擎 - 语音识别，支持 GPU 加速
- ✅ NMT (M2M100) 引擎 - 机器翻译，通过 HTTP 调用 Python 服务
- ✅ TTS (Piper) 引擎 - 语音合成，通过 HTTP 调用 Piper TTS 服务
- ✅ VAD (Silero VAD) 引擎 - 语音活动检测，支持自适应阈值调整
- ✅ LanguageDetector 模块（框架已完成 ✅）- 自动语种识别（中英日韩）
- ✅ 推理服务核心 - 统一接口，模块化设计
- ✅ 自动语种识别与双向模式框架（阶段一.4）
  - ✅ LanguageDetector 模块框架
  - ✅ 消息协议扩展（支持 `src_lang="auto"`、双向模式）
  - ✅ 推理流程集成语言检测逻辑
  - ⏸️ 待完善：实际检测逻辑实现、测试
- ✅ 单元测试 - 20+ 个测试（10个本地模型测试全部通过）

**技术栈**：
- Rust + Tokio（异步运行时）
- whisper-rs（ASR，支持 CUDA，本地模型调用）
- ort 1.16.3（ONNX Runtime，VAD，本地模型调用）
- HTTP 客户端（NMT、TTS，需要外部服务）

**测试状态**：
- 本地模型测试：✅ 10个测试全部通过（ASR: 3个，VAD: 7个）
- 外部服务测试：⏸️ 需要启动 NMT 和 TTS 服务
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
├── web-client/                   # Web 客户端（iOS 开发设备替代方案）
│   ├── src/
│   │   ├── state_machine.ts     # 状态机
│   │   ├── recorder.ts          # 录音模块
│   │   ├── websocket_client.ts  # WebSocket 客户端
│   │   ├── tts_player.ts        # TTS 播放
│   │   ├── asr_subtitle.ts      # ASR 字幕
│   │   └── main.ts              # 主应用
│   ├── index.html
│   ├── package.json
│   └── README.md
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

### 5. 启动 Web 客户端（iOS 开发设备替代方案）

```powershell
cd web-client
npm install
npm run dev
```

服务将在 `http://localhost:3000` 启动。

### 6. 启动移动端客户端

```powershell
cd mobile-app
npm install
npm start
```

**注意**: 由于没有 iOS 开发设备，已开发 Web 客户端作为替代方案。

### 一键启动（Windows）

```powershell
.\scripts\start_all.ps1
```

这将启动所有服务（模型库、调度服务器、API Gateway）。

详细说明请参考 [快速开始指南](./docs/GETTING_STARTED.md)

## 项目状态与开发计划

- [项目状态](./docs/PROJECT_STATUS.md) - 已完成功能和待完成任务
- [开发计划](./docs/DEVELOPMENT_PLAN.md) - 详细的开发阶段和任务列表

## 相关文档

### 核心文档

- [系统设计文档](./distributed_speech_translation_design_electron.md) - 完整的系统设计方案
- [技术架构报告](./docs/v0.1版本项目架构与技术报告.md) - 之前版本的技术架构参考
- [架构文档](./docs/ARCHITECTURE.md) - 系统架构详细说明
- [快速开始指南](./docs/GETTING_STARTED.md) - 快速上手指南
- [模块化功能设计](./docs/MODULAR_FEATURES.md) - 模块化功能设计（包含快速参考）
- [协议规范](./docs/PROTOCOLS.md) - WebSocket 消息协议规范
- [对外开放 API](./docs/PUBLIC_API.md) - 对外 API 设计与实现
- [iOS 技术文档分析](./docs/MOBILE_APP_IOS_DOCS_ANALYSIS.md) - iOS 技术文档对移动端开发的参考价值分析
- [Web 客户端文档](./docs/webClient/README.md) - Web 客户端文档索引（iOS 开发设备替代方案）

### 项目状态与开发计划

- [项目状态](./docs/PROJECT_STATUS.md) - 已完成功能和待完成任务
- [开发计划](./docs/DEVELOPMENT_PLAN.md) - 详细的开发阶段和任务列表
- [任务分发算法优化方案](./docs/DISPATCHER_OPTIMIZATION_PLAN.md) - 负载均衡和功能感知节点选择优化方案

### 测试文档

- [测试目录说明](./scheduler/tests/README.md) - 测试组织结构
- [阶段一.1 测试报告](./scheduler/tests/stage1.1/TEST_REPORT.md) - 调度服务器核心功能测试报告（47个测试）
- [阶段一.2 测试报告](./scheduler/tests/stage1.2/TEST_REPORT.md) - 客户端消息格式对齐测试报告（7个测试）
- [阶段一.3 测试报告](./node-inference/tests/stage1.3/TEST_REPORT.md) - 节点推理服务测试报告（10个本地模型测试通过）
- [阶段 2.1.2 测试报告（调度服务器）](./scheduler/tests/stage2.1.2/TEST_REPORT.md) - ASR 字幕功能测试报告（12个测试全部通过）
- [阶段 2.1.2 测试报告（节点推理服务）](./node-inference/tests/stage2.1.2/TEST_REPORT.md) - ASR 字幕功能测试报告（5个测试：2个通过 ✅，3个跳过 ⏸️，需要模型文件）
- [本地模型测试说明](./node-inference/tests/LOCAL_MODEL_TESTING.md) - 本地模型测试指南（ASR、VAD）
- [Web 客户端阶段 2.1 测试报告](./web-client/tests/stage2.1/TEST_REPORT.md) - Web 客户端核心功能测试报告（22个测试全部通过）

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
