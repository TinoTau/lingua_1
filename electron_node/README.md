# Electron 节点客户端（`electron_node`）

Electron 节点客户端是 Lingua 系统的算力提供方，核心由 **Electron 应用（`electron-node`）** + **节点端服务/资源目录（`services/`、模型缓存等）** 组成。

## 从这里开始

- **本模块文档**：`docs/README.md`（含架构、流程、集成测试说明）
- **架构与设计**：`docs/architecture/`（节点处理流程、服务发现、语义修复、聚合等）
- **Electron 应用工程**：`electron-node/README.md`

> 说明：本 README 只做导航与总览；每个具体 service 的说明请直接看 `services/` 下对应目录（本文不展开）。

## 核心功能

### 1. 节点代理（NodeAgent）
- WebSocket 连接调度服务器
- 任务接收与结果上报
- 心跳机制与状态同步
- 能力注册与管理

### 2. 推理服务管理
- **Rust 推理服务**：ASR（Whisper）、VAD（Silero）
- **Python 服务**：NMT（M2M100）、TTS（Piper/YourTTS）
- 服务热插拔：动态启动/停止服务
- 健康检查与自动重启

### 3. 文本聚合与后处理
- **AggregatorMiddleware**：ASR 结果聚合（NMT 之前）
- **PostProcessCoordinator**：后处理协调（翻译、去重、TTS）
- **AudioAggregator**：音频聚合与超时切割
- 短句准确率提升（S1/S2）

### 4. 模型管理
- 从 Model Hub 下载模型
- 模型版本管理
- 模型验证（SHA256）
- 服务包管理（平台化）

### 5. 平台化服务包
- 多平台服务包下载与安装
- 服务注册表管理（installed.json, current.json）
- 签名验证（Ed25519）
- 原子切换与回滚

## 目录结构（简版）

```
electron_node/
├── electron-node/          # Electron 应用（主进程 TS + 渲染进程 React）
│   ├── main/src/          # 主进程源代码
│   │   ├── agent/        # 节点代理、聚合中间件、后处理协调器
│   │   ├── aggregator/   # 文本聚合器
│   │   ├── pipeline-orchestrator/  # 流水线编排器
│   │   ├── model-manager/  # 模型管理
│   │   ├── service-*-manager/  # 服务管理器
│   │   └── ...
│   └── renderer/         # 渲染进程（React UI）
├── services/               # 节点端服务目录
│   ├── node-inference/   # Rust 推理服务
│   ├── faster_whisper_vad/  # ASR + VAD 服务
│   ├── nmt_m2m100/       # NMT 服务
│   ├── piper_tts/        # TTS 服务
│   └── your_tts/         # YourTTS 服务
├── shared/                 # 跨端共享协议与类型
└── docs/                   # 文档
```

## 相关文档

- **路径结构**：`docs/PATH_STRUCTURE.md`
- **服务热插拔**：`docs/SERVICE_HOT_PLUG_VERIFICATION.md`
- **TTS 服务**：`docs/TTS_SERVICES.md`
- **迁移文档**：`docs/MIGRATION.md`
- **项目完整性**：`PROJECT_COMPLETENESS.md`
