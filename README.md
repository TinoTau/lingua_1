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
                                ▼
┌──────────────────────────── 调度服务器 ────────────────────────────────┐
│ ① Session Manager（会话管理）                                          │
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
│   │   ├── websocket.rs         # WebSocket 处理
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
│   ├── start_scheduler.ps1      # 启动调度服务器
│   ├── start_model_hub.ps1      # 启动模型库服务
│   └── start_all.ps1            # 一键启动所有服务
│
└── docs/                         # 文档
    ├── ARCHITECTURE.md          # 架构文档
    ├── GETTING_STARTED.md       # 快速开始指南
    ├── MODULAR_FEATURES.md      # 模块化功能详细设计
    └── MODULAR_FEATURES_SUMMARY.md  # 模块化功能总结
```

## 快速开始

### 前置要求

- **Rust**: 1.70+ (用于调度服务器和节点推理服务)
- **Node.js**: 18+ (用于 Electron 和移动端)
- **Python**: 3.10+ (用于模型库服务)
- **CUDA**: 12.1+ (可选，用于 GPU 加速)

### 1. 启动调度服务器

```powershell
cd scheduler
cargo build --release
cargo run --release
```

服务将在 `http://localhost:8080` 启动。

### 2. 启动模型库服务

```powershell
cd model-hub
python -m venv venv
.\venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/macOS
pip install -r requirements.txt
python src/main.py
```

服务将在 `http://localhost:5000` 启动。

### 3. 启动 Electron Node 客户端

```powershell
cd electron-node
npm install
npm run build
npm start
```

### 4. 启动移动端客户端

```powershell
cd mobile-app
npm install
npm start
```

### 一键启动（Windows）

```powershell
.\scripts\start_all.ps1
```

## 项目状态

### ✅ 已完成

#### 1. 项目框架搭建
- ✅ 完整的目录结构
- ✅ 配置文件（.gitignore, README 等）
- ✅ 启动脚本

#### 2. 调度服务器 (Scheduler)
- ✅ Rust 项目结构
- ✅ 核心模块实现：
  - 会话管理 (Session Manager)
  - 任务分发 (Job Dispatcher)
  - 节点注册表 (Node Registry)
  - 配对服务 (Pairing Service)
  - 模型库接口 (Model Hub)
  - WebSocket 处理框架
- ✅ 配置文件

#### 3. Electron Node 客户端
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

#### 4. 移动端客户端
- ✅ React Native + Expo 项目
- ✅ VAD Hook 框架
- ✅ WebSocket Hook 框架
- ✅ 基础 UI 组件

#### 5. 模型库服务
- ✅ Python FastAPI 服务
- ✅ 模型元数据管理 API
- ✅ RESTful 接口

#### 6. 节点推理服务
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

#### 7. 共享协议
- ✅ 消息协议定义 (TypeScript)

#### 8. 文档
- ✅ 架构文档
- ✅ 快速开始指南
- ✅ 模块化功能设计文档

### 🔨 进行中 / 待完成

#### 1. 调度服务器
- [ ] 完善 WebSocket 消息处理逻辑
- [ ] 实现完整的任务分发算法
- [ ] 实现节点负载均衡
- [ ] 实现功能感知的节点选择
- [ ] 添加数据库支持（可选）
- [ ] 实现结果聚合和排序

#### 2. Electron Node 客户端
- [ ] 集成节点推理服务（调用 Rust 库或 HTTP 服务）
- [ ] 完善模型下载和安装逻辑
- [ ] 实现系统资源监控
- [ ] 实现功能模块管理 UI
- [ ] 完善错误处理和重连机制

#### 3. 移动端客户端
- [ ] 实现完整的 VAD 检测（WebRTC VAD 或 Silero VAD）
- [ ] 实现音频采集和处理
- [ ] 完善 WebSocket 通信
- [ ] 实现 TTS 音频播放
- [ ] 实现可选功能选择界面
- [ ] 添加 UI 优化

#### 4. 节点推理服务
- [ ] 实现 Whisper ASR 推理
- [ ] 实现 M2M100 NMT 推理
- [ ] 实现 Piper TTS 调用
- [ ] 实现 Silero VAD 检测
- [ ] 完善可选模块的模型加载逻辑
- [ ] 添加模型加载和缓存

#### 5. 模型库服务
- [ ] 实现模型文件存储
- [ ] 实现模型下载接口
- [ ] 添加模型版本管理
- [ ] 实现模型校验（SHA256）

#### 6. 测试和优化
- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能优化
- [ ] 错误处理完善
- [ ] 日志系统完善

## 开发计划

### 阶段一：调度服务器基础（2-4 周）
- [x] 项目框架搭建
- [x] 核心模块结构
- [ ] WebSocket 会话管理完善
- [ ] 任务分发算法实现
- [ ] 功能感知节点选择

### 阶段二：移动端采音模块（2-3 周）
- [x] 项目框架搭建
- [ ] 麦克风采集
- [ ] 轻量 VAD 实现
- [ ] 手动截断按钮
- [ ] WebSocket 通信完善
- [ ] 可选功能选择界面

### 阶段三：Electron Node 客户端（4-6 周）
- [x] Electron 项目初始化
- [x] Node Agent 框架
- [x] Model Manager 框架
- [x] 推理服务接口框架
- [x] UI 界面框架
- [ ] 功能模块管理 UI
- [ ] 推理服务集成
- [ ] 系统资源监控实现

### 阶段四：模型库与方言模型分发（2-3 周）
- [x] Model Registry API 框架
- [ ] Model Hub REST API 完善
- [ ] 模型下载与安装实现
- [ ] 模型版本管理

### 阶段五：模块化功能实现（3-4 周）
- [x] 模块化架构设计
- [x] 模块管理器实现
- [x] 可选模块框架
- [ ] 音色识别模型集成
- [ ] 音色生成模型集成
- [ ] 语速识别实现
- [ ] 语速控制实现
- [ ] Electron UI 集成

### 阶段六：联调与优化（2-3 周）
- [ ] 全链路联调
- [ ] 性能优化
- [ ] 稳定性测试
- [ ] 模块化功能测试

## 相关文档

- [系统设计文档](./distributed_speech_translation_design_electron.md) - 完整的系统设计方案
- [技术架构报告](./docs/v0.1版本项目架构与技术报告.md) - 之前版本的技术架构参考
- [项目状态报告](./docs/PROJECT_STATUS.md) - 详细的项目状态
- [架构文档](./docs/ARCHITECTURE.md) - 系统架构详细说明
- [快速开始指南](./docs/GETTING_STARTED.md) - 快速上手指南
- [模块化功能设计](./docs/MODULAR_FEATURES.md) - 模块化功能详细设计
- [模块化功能总结](./docs/MODULAR_FEATURES_SUMMARY.md) - 模块化功能快速参考

## 核心优势

1. **分布式架构**: 支持多节点并行处理，可扩展性强
2. **模块化设计**: 核心功能与可选功能分离，灵活可配置
3. **实时切换**: 支持运行时动态启用/禁用功能模块
4. **隐私保护**: 支持随机节点模式和指定节点模式
5. **低延迟**: 轻量 VAD + 手动截断，减少延迟
6. **可扩展性**: 易于添加新的可选功能模块

## 许可证

[待定]

## 贡献

欢迎贡献代码、报告问题或提出建议！
