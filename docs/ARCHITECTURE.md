# Lingua 分布式语音翻译系统架构文档

## 系统概述

本系统是一个分布式实时语音翻译系统，采用微服务架构，支持多会话、多节点调度。

## 核心组件

### 1. 调度服务器 (Scheduler)

**位置**: `scheduler/`  
**技术栈**: Rust + Tokio + Axum  
**职责**:
- 管理会话生命周期
- 节点注册与心跳监控
- 任务分发与负载均衡
- 配对服务（6位安全码）
- 模型库元数据管理

**主要模块**:
- `session.rs`: 会话管理
- `dispatcher.rs`: 任务分发
- `node_registry.rs`: 节点注册表
- `pairing.rs`: 配对服务
- `model_hub.rs`: 模型库接口
- `websocket.rs`: WebSocket 处理

### 2. Electron Node 客户端

**位置**: `electron-node/`  
**技术栈**: Electron + Node.js + TypeScript + React  
**职责**:
- 作为算力节点接入系统
- 运行本地模型推理（ASR/NMT/TTS）
- 提供系统资源监控界面
- 管理本地模型（安装/卸载/更新）

**主要模块**:
- `main/agent/`: Node Agent（WebSocket 连接调度服务器）
- `main/model-manager/`: 模型管理器
- `main/inference/`: 推理服务接口
- `renderer/`: 前端界面（React）

**功能**:
- 系统资源监控
- 模型管理（安装/卸载/更新）
- 功能模块管理（启用/禁用可选功能）

### 3. 移动端客户端

**位置**: `mobile-app/`  
**技术栈**: React Native + TypeScript  
**职责**:
- 采集用户语音
- 本地轻量 VAD 检测
- 手动截断按钮
- WebSocket 通信
- 播放翻译结果

**主要功能**:
- 实时录音
- VAD 自动分句
- 手动截断按钮
- 配对码输入（可选）
- 翻译结果显示

### 4. 模型库服务 (Model Hub)

**位置**: `model-hub/`  
**技术栈**: Python + FastAPI  
**职责**:
- 管理模型元数据
- 提供模型列表查询 API
- 提供模型下载 URL

### 5. API Gateway（对外 API 网关）

**位置**: `api-gateway/`  
**技术栈**: Rust + Tokio + Axum  
**职责**:
- 提供对外 REST API 和 WebSocket API
- API Key 鉴权
- 租户管理
- 请求限流
- 协议转换（外部 API ↔ 内部协议）

**主要模块**:
- `tenant.rs`: 租户管理
- `auth.rs`: API Key 鉴权中间件
- `rate_limit.rs`: 限流模块
- `rest_api.rs`: REST API 处理
- `ws_api.rs`: WebSocket API 处理
- `scheduler_client.rs`: 与 Scheduler 通信

**功能**:
- REST API: `POST /v1/speech/translate` - 非实时翻译
- WebSocket API: `/v1/stream` - 实时流式翻译
- 多租户支持（每个外部应用作为一个租户）
- 按租户的请求限流

详细设计请参考 [对外开放 API 文档](./PUBLIC_API.md)

### 6. 节点推理服务

**位置**: `node-inference/`  
**技术栈**: Rust + ONNX Runtime + Whisper  
**职责**:
- ASR（语音识别）- Whisper
- NMT（机器翻译）- M2M100
- TTS（语音合成）- Piper TTS（HTTP 调用）
- VAD（语音活动检测）- Silero VAD

**核心模块（必需）**:
- ASR 引擎
- NMT 引擎
- TTS 引擎
- VAD 引擎

**可选模块（可动态启用/禁用）**:
- 音色识别 (Speaker Identification)
- 音色生成 (Voice Cloning)
- 语速识别 (Speech Rate Detection)
- 语速控制 (Speech Rate Control)
- 情感分析 (Emotion Detection)
- 个性化适配 (Persona Adaptation)

**主要模块**:
- `asr.rs`: ASR 引擎
- `nmt.rs`: NMT 引擎
- `tts.rs`: TTS 引擎
- `vad.rs`: VAD 引擎
- `modules.rs`: 模块管理器
- `speaker.rs`: 音色识别/生成模块
- `speech_rate.rs`: 语速识别/控制模块

## 数据流

### 一句翻译的完整流程

1. **移动端采集语音**
   - 用户说话，移动端持续录音
   - 本地 VAD 检测或用户手动截断
   - 封装为 utterance 消息

2. **发送到调度服务器**
   - 通过 WebSocket 发送 utterance
   - 调度服务器创建 job

3. **任务分发**
   - 调度服务器选择节点（随机或指定）
   - 通过 WebSocket 下发 job 到节点

4. **节点处理**
   - 节点接收 job
   - 根据请求中的功能标记，启用相应的可选模块
   - 运行 ASR → [可选模块] → NMT → [可选模块] → TTS
   - 返回结果（包含可选功能的处理结果）

5. **结果返回**
   - 节点发送结果到调度服务器
   - 调度服务器转发给移动端
   - 移动端播放 TTS 音频并显示文本

## 网络架构

### 内部架构

```
移动端客户端 ←→ WebSocket ←→ 调度服务器 ←→ WebSocket ←→ Electron 节点
                                    ↓
                              模型库服务 (HTTP)
```

### 对外 API 架构

```
外部应用 (Web/App/IM)
    ↓ HTTPS/WSS
[API Gateway] ← 鉴权、限流、协议转换
    ↓ 内部 WebSocket
[调度服务器] ←→ [节点]
```

- **内部连接**: 移动端和 Electron 节点直接连接调度服务器
- **外部连接**: 第三方应用通过 API Gateway 接入
- API Gateway 负责鉴权、限流和协议转换

- 所有连接都是客户端主动连接服务器
- 无需 NAT 穿透
- 使用 WebSocket 长连接
- 心跳机制保持连接活跃

## 部署架构

### 开发环境

- 调度服务器: `localhost:8080`
- API Gateway: `localhost:8081` (可选)
- 模型库服务: `localhost:5000`
- TTS 服务: `localhost:5005` (可选，使用之前的 Piper TTS)

### 生产环境

- **调度服务器**: 需要公网 IP 和域名（内部服务）
- **API Gateway**: 需要公网 IP 和域名（对外服务）
- 使用 HTTPS/WSS
- 支持多实例部署（负载均衡）
- API Gateway 可独立扩展

## 安全与隐私

1. **随机节点模式**: 按句分发，单一节点无法看到完整对话
2. **指定节点模式**: 用户使用自己的 PC 节点，数据在本地处理
3. **配对码机制**: 6位数字码，5分钟有效期
4. **数据加密**: 建议使用 TLS/SSL

## 模块化功能设计

### 核心模块（必需）

- **ASR** (语音识别) - Whisper
- **NMT** (机器翻译) - M2M100
- **TTS** (语音合成) - Piper TTS
- **VAD** (语音活动检测) - Silero VAD

### 可选模块（可动态启用/禁用）

- **Speaker Identification** (音色识别)
- **Voice Cloning** (音色生成/克隆)
- **Speech Rate Detection** (语速识别)
- **Speech Rate Control** (语速生成/控制)
- **Emotion Detection** (情感分析)
- **Persona Adaptation** (个性化适配)

### 模块化特性

- ✅ **模块独立性**: 每个模块可以独立启用/禁用，互不影响
- ✅ **运行时切换**: 无需重启服务即可切换模块状态
- ✅ **优雅降级**: 模块禁用时，系统仍能正常工作
- ✅ **按需加载**: 模块只在需要时加载模型，节省资源
- ✅ **客户端控制**: 客户端可以按需选择功能

### 工作流程

```
客户端请求 → 指定需要的可选功能
    ↓
调度服务器 → 选择支持这些功能的节点
    ↓
节点处理 → 根据请求启用/禁用相应模块
    ↓
返回结果 → 包含可选功能的处理结果
```

详细设计请参考 [模块化功能设计文档](./MODULAR_FEATURES.md)

## 扩展性

- 支持水平扩展（多个调度服务器实例）
- 支持动态添加/移除节点
- 支持模型热更新
- 支持多语言对和方言模型
- 支持模块化功能扩展（易于添加新的可选功能模块）
- **支持对外开放 API**（通过 API Gateway）
- **支持多租户**（每个外部应用作为独立租户）

