# Electron 节点客户端

Electron 节点客户端是 Lingua 系统的算力提供方，利用个人PC的闲置算力（GPU/CPU）提供翻译服务。

## 目录结构

```
electron_node/
├── electron-node/          # Electron 应用
│   ├── main/src/          # 主进程源代码（TypeScript）
│   ├── renderer/          # 渲染进程代码（React）
│   ├── tests/             # 测试文件
│   └── logs/              # 日志文件
│
├── services/              # 所有节点端服务
│   ├── node-inference/   # 节点推理服务（Rust）
│   │   ├── src/          # 源代码
│   │   ├── tests/        # 测试文件
│   │   ├── models/       # 模型文件
│   │   └── logs/         # 日志文件
│   ├── nmt_m2m100/       # NMT 服务（Python）
│   ├── piper_tts/        # TTS 服务（Python）
│   └── your_tts/         # YourTTS 服务（Python）
│
└── docs/                  # 文档
```

## Electron 应用

**技术栈**: Electron + Node.js + TypeScript + React

**功能**:
- 系统资源监控
- 模型管理（安装/卸载/更新）
- 服务管理（启动/停止）
- 节点注册和心跳

**启动**:
```bash
cd electron-node
npm install
npm run build
npm start
```

## 节点推理服务 (Node Inference)

**技术栈**: Rust + ONNX Runtime

**功能**:
- ASR（语音识别）- Whisper
- NMT（机器翻译）- M2M100
- TTS（语音合成）- Piper TTS / YourTTS（动态选择）
- VAD（语音活动检测）- Silero VAD
- 模块化功能（音色识别、音色克隆、语速控制等）

**TTS 服务选择**:
- 根据任务请求中的 `features.voice_cloning` 自动选择：
  - 标准流程 → Piper TTS（端口 5006）
  - 音色克隆 → YourTTS（端口 5004）
- 支持优雅降级：YourTTS 不可用时自动使用 Piper TTS

**构建**:
```bash
cd services/node-inference
cargo build --release
```

## Python 服务

**服务列表**:
- **NMT 服务** (services/nmt_m2m100/): 机器翻译服务（端口 5008）
- **TTS 服务** (services/piper_tts/): 语音合成服务（端口 5006）
- **YourTTS 服务** (services/your_tts/): 语音克隆服务（端口 5004，可选）

**服务热插拔**:
- ✅ 所有服务支持动态启动/停止
- ✅ 服务状态自动保存和恢复
- ✅ 根据任务需求自动选择服务（如 TTS 服务选择）

**启动**:
```bash
# NMT 服务
cd services/nmt_m2m100
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python nmt_service.py

# TTS 服务
cd services/piper_tts
# 类似操作...

# YourTTS 服务
cd services/your_tts
# 类似操作...
```

## 测试

### Electron 应用测试

```bash
cd electron-node
npm test                    # 运行所有测试
npm run test:stage3.1       # 运行阶段 3.1 测试（模型管理）
```

**测试状态**:
- ✅ 阶段 2.2: 全部通过
- ✅ 阶段 3.1: 28/33 通过（84.8%，API 测试需要服务运行）
- ✅ 阶段 3.2: 22/22 通过（100%）

### 节点推理服务测试

```bash
cd electron_node/services/node-inference
cargo test                  # 运行所有测试
cargo test --lib            # 运行库测试
```

**测试状态**: ✅ 测试框架已配置（部分测试需要模型文件和服务运行）

详细测试状态请参考：
- **测试状态**: `TEST_STATUS.md`
- **测试执行报告**: `TEST_EXECUTION_REPORT.md`

## 文档

详细文档请参考 `docs/` 目录。

### 快速参考

- **项目完整性**: `PROJECT_COMPLETENESS.md`
- **测试状态**: `TEST_STATUS.md`
