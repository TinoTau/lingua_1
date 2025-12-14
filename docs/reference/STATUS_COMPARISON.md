# Reference 文档与当前项目状态对比

**创建日期**: 2025-01-XX  
**对比版本**: v0.1.0 (reference) vs 当前版本 (lingua_1)

---

## 📋 执行摘要

**结论**: ⚠️ **Reference 文档已过时**，描述的是 v0.1.0 版本的单体架构，而当前项目已经演变为**分布式微服务架构**。

**主要差异**:
- ❌ 架构：单体 CoreEngine → 分布式 Scheduler + Node Inference
- ❌ 服务端口：9000 → 8080 (Scheduler)
- ❌ 部署方式：单一服务 → 多服务分布式部署
- ❌ 功能范围：基础翻译 → 多节点调度、负载均衡、功能选择、会议室模式等

**建议**: Reference 文档应标记为"历史参考"，仅用于了解项目演进历史。

---

## 1. 架构对比

### 1.1 v0.1.0 (Reference 文档)

**架构模式**: **单体服务架构**

```
客户端 → CoreEngine Service (Rust, Port 9000)
         ├─ VAD (Silero)
         ├─ ASR (Whisper)
         ├─ EventBus
         ├─ NMT (Marian) → NMT Service (Python, Port 5008)
         └─ TTS (Piper) → TTS Service (Piper HTTP, Port 5005)
```

**特点**:
- 单一 CoreEngine 服务
- 内部 EventBus 协调
- NMT 和 TTS 作为外部 Python 服务

### 1.2 当前项目 (lingua_1)

**架构模式**: **分布式微服务架构**

```
Web Client → Scheduler (Rust, Port 8080)
              ├─ Session Management
              ├─ Job Dispatcher
              ├─ Node Registry
              └─ GroupManager
                    ↓
              Node Client (Electron) → Node Inference Service (Rust)
                                        ├─ ASR (Whisper)
                                        ├─ NMT (M2M100, HTTP)
                                        ├─ TTS (Piper, HTTP)
                                        └─ VAD (Silero)
```

**特点**:
- 分布式调度架构
- 多节点支持
- 负载均衡
- 功能感知节点选择
- 会话管理和 Group 管理

---

## 2. 服务端口对比

| 服务 | v0.1.0 | 当前版本 | 变化 |
|------|--------|---------|------|
| **核心服务** | CoreEngine: 9000 | Scheduler: 8080 | ✅ 已更改 |
| **NMT 服务** | 5008 | 5008 | ✅ 未变化 |
| **TTS 服务** | 5005 | 5005 | ✅ 未变化 |
| **API Gateway** | ❌ 无 | 8081 | ✅ 新增 |
| **Model Hub** | ❌ 无 | 8000 | ✅ 新增 |
| **Node Inference** | ❌ 内置于 CoreEngine | 9000 | ✅ 分离 |

---

## 3. 技术栈对比

### 3.1 CoreEngine vs Scheduler

| 维度 | v0.1.0 (CoreEngine) | 当前版本 (Scheduler) |
|------|---------------------|---------------------|
| **技术栈** | Rust + Tokio | Rust + Tokio + Axum |
| **职责** | 统一编排所有模块 | 调度、会话管理、节点注册 |
| **端口** | 9000 | 8080 |
| **架构** | 单体服务 | 微服务（仅调度） |

### 3.2 Node Inference Service

| 维度 | v0.1.0 | 当前版本 |
|------|--------|---------|
| **位置** | 内置于 CoreEngine | 独立服务 |
| **技术栈** | 与 CoreEngine 共享 | Rust + ONNX Runtime + Whisper |
| **端口** | 无（内部调用） | 9000 (HTTP) |
| **职责** | 作为 CoreEngine 的一部分 | 独立推理服务，由 Node Client 调用 |

### 3.3 客户端

| 维度 | v0.1.0 | 当前版本 |
|------|--------|---------|
| **客户端类型** | Chrome Extension, Electron, Mobile, PWA | Web Client, Electron Node Client |
| **通信方式** | HTTP | WebSocket (Scheduler) + HTTP (Node Inference) |
| **架构** | 直接连接 CoreEngine | 通过 Scheduler 调度到 Node |

---

## 4. 功能对比

### 4.1 v0.1.0 功能

- ✅ 实时翻译 (ASR → NMT → TTS)
- ✅ 多语言支持 (中英)
- ✅ 本地部署
- ✅ GPU 加速
- ✅ 流式处理

**缺失功能**:
- ❌ 多节点调度
- ❌ 负载均衡
- ❌ 功能选择
- ❌ 会议室模式
- ❌ Utterance Group
- ❌ API Gateway

### 4.2 当前版本功能

**核心功能**:
- ✅ 实时翻译 (ASR → NMT → TTS)
- ✅ 多语言支持 (中英 + 自动语言检测)
- ✅ 本地部署
- ✅ GPU 加速
- ✅ 流式处理

**新增功能**:
- ✅ **多节点调度**: 支持多个 Node Client 并发
- ✅ **负载均衡**: 最少连接数策略
- ✅ **功能感知节点选择**: 根据任务需求选择节点
- ✅ **会话管理**: 多会话并发支持
- ✅ **Utterance Group**: 上下文拼接提升翻译质量
- ✅ **会议室模式**: WebRTC P2P 连接和音频混控
- ✅ **双向模式**: 自动语言检测和双向翻译
- ✅ **API Gateway**: 对外 API 网关
- ✅ **模型管理**: 模型库服务和模型管理 UI

---

## 5. 部署架构对比

### 5.1 v0.1.0 部署

```
Windows 主系统
├─ CoreEngine Service (Rust, Port 9000)
└─ NMT Service (Python, Port 5008)

WSL2 (Ubuntu)
└─ TTS Service (Piper HTTP, Port 5005)
```

### 5.2 当前版本部署

```
Windows 主系统
├─ Scheduler (Rust, Port 8080)
├─ Model Hub (Python, Port 8000)
├─ API Gateway (Rust, Port 8081)
├─ NMT Service (Python, Port 5008)
└─ Node Client (Electron)
    └─ Node Inference Service (Rust, Port 9000)

WSL2 (Ubuntu)
└─ TTS Service (Piper HTTP, Port 5005)
```

---

## 6. 项目结构对比

### 6.1 v0.1.0 项目结构

```
lingua/
├── core/                    # CoreEngine Service
│   ├── engine/
│   ├── modules/
│   └── services/
├── clients/                 # 各种客户端
└── config/                  # 配置文件
```

### 6.2 当前版本项目结构

```
lingua_1/
├── scheduler/               # 调度服务器
├── node-inference/          # 节点推理服务
├── electron-node/           # Electron Node 客户端
├── web-client/              # Web 客户端
├── api-gateway/             # API 网关
├── model-hub/               # 模型库服务
└── services/                # Python 服务
    ├── nmt_m2m100/
    └── piper_tts/
```

---

## 7. 消息协议对比

### 7.1 v0.1.0

- **协议**: HTTP REST API
- **通信**: 客户端直接调用 CoreEngine

### 7.2 当前版本

- **协议**: WebSocket (Scheduler) + HTTP (Node Inference)
- **通信**: 客户端 → Scheduler → Node Client → Node Inference Service

**新增消息类型**:
- SessionInit
- JobAssign
- JobResult
- RoomCreate/RoomJoin
- WebRTC signaling messages
- TTS_PLAY_ENDED
- Utterance Group 相关消息

---

## 8. 配置文件对比

### 8.1 v0.1.0

**配置文件**: `lingua_core_config.toml`

```toml
[nmt]
url = "http://127.0.0.1:5008"

[tts]
url = "http://127.0.0.1:5005/tts"

[asr]
url = "http://127.0.0.1:6006"

[engine]
port = 9000
whisper_model_path = "models/asr/whisper-base"
silero_vad_model_path = "models/vad/silero/silero_vad_official.onnx"
```

### 8.2 当前版本

**配置文件**: 多个配置文件

- `scheduler/config.toml` - 调度服务器配置
- `node-inference/config.toml` - 节点推理服务配置
- `electron-node/` - Electron 客户端配置
- `web-client/` - Web 客户端配置

---

## 9. 启动方式对比

### 9.1 v0.1.0

**启动脚本**: `start_all_services_simple.ps1`

```powershell
# 启动流程
1. 设置 CUDA 环境变量
2. 启动 NMT Service (Python)
3. 启动 CoreEngine (Rust)
4. 验证服务健康状态
```

### 9.2 当前版本

**启动脚本**: `scripts/start_all.ps1`

```powershell
# 启动流程
1. 启动 Model Hub
2. 启动 Scheduler
3. 启动 API Gateway
4. 启动 NMT Service
5. 启动 TTS Service
6. 启动 Node Client (Electron)
```

---

## 10. 总结

### 10.1 主要变化

1. **架构演进**: 单体 → 分布式微服务
2. **服务分离**: CoreEngine → Scheduler + Node Inference
3. **功能扩展**: 基础翻译 → 多节点、负载均衡、功能选择、会议室模式
4. **通信协议**: HTTP → WebSocket + HTTP
5. **部署方式**: 单一服务 → 多服务协调

### 10.2 Reference 文档状态

**状态**: ⚠️ **已过时**

**适用场景**:
- ✅ 了解项目历史演进
- ✅ 参考原始设计思路
- ✅ 对比架构变化

**不适用场景**:
- ❌ 作为当前项目架构参考
- ❌ 部署指导
- ❌ 开发指南

### 10.3 建议

1. **更新 Reference README**: 明确标注为"历史参考文档"
2. **保留文档**: 作为项目演进历史记录
3. **参考当前文档**: 
   - [架构文档](../ARCHITECTURE.md)
   - [快速开始指南](../GETTING_STARTED.md)
   - [项目状态文档](../project_management/PROJECT_STATUS.md)

---

## 11. 当前项目准确文档

**核心架构文档**:
- [ARCHITECTURE.md](../ARCHITECTURE.md) - 当前系统架构
- [ARCHITECTURE_ANALYSIS.md](../ARCHITECTURE_ANALYSIS.md) - 架构分析与性能评估
- [GETTING_STARTED.md](../GETTING_STARTED.md) - 快速开始指南

**功能文档**:
- [PROTOCOLS.md](../PROTOCOLS.md) - 消息协议规范
- [Web 客户端文档](../webClient/README.md) - Web 客户端功能
- [节点推理服务文档](../node_inference/README.md) - 节点推理服务

**项目状态**:
- [PROJECT_STATUS.md](../project_management/PROJECT_STATUS.md) - 项目当前状态
- [DEVELOPMENT_PLAN.md](../project_management/DEVELOPMENT_PLAN.md) - 开发计划

---

**最后更新**: 2025-01-XX

