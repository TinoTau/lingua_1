# 文档库

本目录包含项目的长期维护文档，按模块分类组织。

## 📁 文档目录结构

```
docs/
├── README.md                    # 本文件
├── ARCHITECTURE.md              # 系统架构文档（核心）
├── PROTOCOLS.md                 # WebSocket 消息协议规范（核心）
├── GETTING_STARTED.md           # 快速开始指南（核心）
│
├── scheduler/                   # 调度服务器文档
│   ├── README.md
│   └── DISPATCHER_OPTIMIZATION_PLAN.md
│
├── node_inference/              # 节点推理服务文档
│   ├── README.md
│   ├── AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md
│   └── TWO_LEVEL_VAD_DESIGN.md
│
├── api_gateway/                 # API Gateway 文档
│   ├── README.md
│   └── PUBLIC_API.md
│
├── electron_node/               # Electron Node 客户端文档
│   └── STAGE2.2_IMPLEMENTATION.md
│
├── webClient/                   # Web 客户端文档
│   ├── README.md
│   ├── Web_端实时语音翻译_统一设计方案_v3.md
│   ├── WEB_CLIENT_SCHEME_FEASIBILITY_ANALYSIS.md
│   ├── WEB_CLIENT_V3_FEASIBILITY_ASSESSMENT.md
│   └── ...
│
├── modelManager/                # 模型管理文档
│   ├── README.md
│   └── 公司模型库与Electron客户端模型管理统一技术方案.md
│
├── modular/                     # 模块化功能文档
│   ├── README.md
│   ├── LINGUA_完整技术说明书_v2.md
│   └── MODULAR_FEATURES.md
│
├── IOS/                         # iOS/移动端文档（参考）
│   └── ...
│
├── project_management/          # 项目管理文档
│   ├── README.md
│   ├── PROJECT_STATUS.md
│   └── DEVELOPMENT_PLAN.md
│
└── reference/                   # 参考文档
    ├── README.md
    └── v0.1版本项目架构与技术报告.md
```

---

## 📚 核心文档

### 架构与设计

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 系统架构详细说明
- [PROTOCOLS.md](./PROTOCOLS.md) - WebSocket 消息协议规范（包含实现状态）
- [GETTING_STARTED.md](./GETTING_STARTED.md) - 快速开始指南

---

## 🔧 模块文档

### 调度服务器 (Scheduler)

**目录**: [`scheduler/`](./scheduler/)  
**文档**: [调度服务器文档目录](./scheduler/README.md)

- [任务分发算法优化方案](./scheduler/DISPATCHER_OPTIMIZATION_PLAN.md) - 负载均衡和功能感知节点选择的详细优化方案

**测试报告**:
- [阶段 1.1 测试报告](../scheduler/tests/stage1.1/TEST_REPORT.md) - 核心功能测试（47个测试，全部通过）
- [阶段 1.2 测试报告](../scheduler/tests/stage1.2/TEST_REPORT.md) - 消息格式对齐测试（7个测试，全部通过）
- [阶段 2.1.2 测试报告](../scheduler/tests/stage2.1.2/TEST_REPORT.md) - ASR 字幕功能测试（12个测试，全部通过）
- [阶段 3.2 测试报告](../scheduler/tests/stage3.2/TEST_REPORT.md) - 节点选择测试（6个测试，全部通过）

---

### 节点推理服务 (Node Inference Service)

**目录**: [`node_inference/`](./node_inference/)  
**文档**: [节点推理服务文档目录](./node_inference/README.md)

- [自动语种识别与双向模式设计](./node_inference/AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md) - 自动语种识别功能的设计文档（框架已完成 ✅）
- [两级 VAD 设计](./node_inference/TWO_LEVEL_VAD_DESIGN.md) - 两级 VAD 设计说明

**测试报告**:
- [阶段 1.3 测试报告](../node-inference/tests/stage1.3/TEST_REPORT.md) - 核心功能测试（20+个测试，10个本地模型测试全部通过）
- [阶段 1.4 测试报告](../node-inference/tests/stage1.4/TEST_REPORT.md) - 自动语种识别测试（7个测试，全部通过）
- [阶段 2.1.2 测试报告](../node-inference/tests/stage2.1.2/TEST_REPORT.md) - ASR 字幕功能测试

---

### API Gateway

**目录**: [`api_gateway/`](./api_gateway/)  
**文档**: [API Gateway 文档目录](./api_gateway/README.md)

- [对外开放 API 设计与实现](./api_gateway/PUBLIC_API.md) - 完整的 API 设计文档，包含 REST API 和 WebSocket API

---

### Electron Node 客户端

**目录**: [`electron_node/`](./electron_node/)  
**文档**: [Electron Node 客户端文档目录](./electron_node/STAGE2.2_IMPLEMENTATION.md)

- [阶段 2.2 实现文档](./electron_node/STAGE2.2_IMPLEMENTATION.md) - Electron Node 客户端实现说明

**测试报告**:
- [阶段 2.2 测试报告](../electron-node/tests/stage2.2/TEST_REPORT.md) - 编译测试全部通过
- [阶段 3.1 测试报告](../electron-node/tests/stage3.1/TEST_REPORT.md) - 模型管理功能测试（48个测试，全部通过）
- [阶段 3.2 测试报告](../electron-node/tests/stage3.2/TEST_REPORT.md) - 模块化功能测试（22个测试，全部通过）

---

### Web 客户端

**目录**: [`webClient/`](./webClient/)  
**文档**: [Web 客户端文档目录](./webClient/README.md)

由于没有 iOS 开发设备，我们开发了 **Web 客户端作为替代方案**，采用半双工实时语音翻译设计。

**主要文档**:
- [Web 端实时语音翻译统一设计方案 v3](./webClient/Web_端实时语音翻译_统一设计方案_v3.md) - **主文档**，包含完整的设计方案、技术方案和功能需求
- [Web 客户端方案可行性分析](./webClient/WEB_CLIENT_SCHEME_FEASIBILITY_ANALYSIS.md) - 可行性分析
- [Web 客户端 v3 可行性评估](./webClient/WEB_CLIENT_V3_FEASIBILITY_ASSESSMENT.md) - v3 方案可行性评估

**Web 客户端特点**:
- ✅ 半双工模式（输入模式和输出模式自动切换）
- ✅ Send 按钮主导节奏
- ✅ 静音自动结束（固定参数）
- ✅ ASR 实时字幕（需要后端支持）
- ✅ Utterance Group 上下文拼接（已完成 ✅）
- ✅ 播放期间完全关麦，避免回声问题

**测试报告**:
- [阶段 2.1 测试报告](../web-client/tests/stage2.1/TEST_REPORT.md) - 核心功能测试（22个测试，全部通过）
- [阶段 3.2 测试报告](../web-client/tests/stage3.2/TEST_REPORT.md) - 功能选择测试（17个测试，全部通过）

---

### 模型管理

**目录**: [`modelManager/`](./modelManager/)  
**文档**: [模型管理文档目录](./modelManager/README.md)

- [公司模型库与Electron客户端模型管理统一技术方案](./modelManager/公司模型库与Electron客户端模型管理统一技术方案.md) - 模型管理技术方案

---

### 模块化功能

**目录**: [`modular/`](./modular/)  
**文档**: [模块化功能文档目录](./modular/README.md)

- [LINGUA 完整技术说明书 v2](./modular/LINGUA_完整技术说明书_v2.md) - 模块化功能完整技术说明书
- [MODULAR_FEATURES.md](./modular/MODULAR_FEATURES.md) - 模块化功能设计（包含快速参考）

**测试报告**:
- [模块化功能测试报告](../electron-node/tests/stage3.2/TEST_REPORT.md) - 模块化功能测试（45个测试，全部通过）

---

### iOS/移动端（参考文档）

**目录**: [`IOS/`](./IOS/)  
**说明**: 这些文档主要针对原生 iOS (Swift) 开发，但架构设计和实现思路对 React Native 开发同样有很高的参考价值。

**注意**: 当前由于没有 iOS 开发设备，已开发 Web 客户端作为替代方案。

---

## 📊 项目管理文档

**目录**: [`project_management/`](./project_management/)  
**文档**: [项目管理文档目录](./project_management/README.md)

- [项目状态](./project_management/PROJECT_STATUS.md) - 项目状态（已完成功能和待完成任务，包含联合调试就绪度评估）
- [开发计划](./project_management/DEVELOPMENT_PLAN.md) - 开发计划（详细的开发阶段和任务列表）

---

## 📖 参考文档

**目录**: [`reference/`](./reference/)  
**文档**: [参考文档目录](./reference/README.md)

- [v0.1版本项目架构与技术报告](./reference/v0.1版本项目架构与技术报告.md) - 原项目技术架构参考

---

## 📝 文档维护原则

1. **按模块分类**: 文档按功能模块组织在对应的子目录中
2. **核心文档**: 系统架构、协议规范、快速开始等核心文档放在根目录
3. **及时更新**: 文档应与代码保持同步，及时更新
4. **清晰结构**: 每个模块目录都有 README.md 说明该模块的文档

---

## 🔗 快速链接

### 核心文档
- [系统架构](./ARCHITECTURE.md)
- [协议规范](./PROTOCOLS.md)
- [快速开始](./GETTING_STARTED.md)

### 项目状态
- [项目状态](./project_management/PROJECT_STATUS.md)
- [开发计划](./project_management/DEVELOPMENT_PLAN.md)

### 模块文档
- [调度服务器](./scheduler/README.md)
- [节点推理服务](./node_inference/README.md)
- [API Gateway](./api_gateway/README.md)
- [Electron Node 客户端](./electron_node/STAGE2.2_IMPLEMENTATION.md)
- [Web 客户端](./webClient/README.md)
- [模型管理](./modelManager/README.md)
- [模块化功能](./modular/README.md)
