# 节点注册文档

本目录包含节点注册相关的功能说明、流程文档和实现指南。

## 文档列表

### 核心文档

- **[节点注册功能说明](./NODE_REGISTRATION_GUIDE.md)** - ⭐ **完整的节点注册功能说明，包括 GPU 要求、注册流程、错误处理、流程完整性检查等**
- **[节点注册协议规范](./NODE_REGISTRATION_PROTOCOL.md)** - 节点注册的 WebSocket 消息协议详细说明
- **[节点注册规范 v1.1-aligned](./NODE_REGISTRATION_SPECIFICATION_v1.1-aligned.md)** - ⭐ **权威规范（开发参考）**
- **[节点状态和测试规范](./NODE_STATUS_AND_TESTS_v1.md)** - ⭐ **NodeStatus 状态机定义和完整测试清单**

### 实现文档

- **[实现状态](./IMPLEMENTATION_STATUS.md)** - ⭐ **详细的实现状态和完成情况**
- **[开发就绪性评估](./NODE_REGISTRATION_DEVELOPMENT_READINESS.md)** - ⭐ **开发就绪性评估和待实现功能**

### 设计文档

- **[UI 设计说明](./NODE_REGISTRATION_UI.md)** - 节点注册状态的 UI 显示和用户交互设计

## 快速开始

### 节点注册基本要求

1. **GPU 要求**：节点必须有 GPU 才能注册为算力提供方
2. **硬件信息**：需要上报 CPU 核心数、内存大小、GPU 信息
3. **模型信息**：需要上报已安装的模型列表
4. **功能支持**：需要上报支持的功能标志

### 注册流程

1. 节点连接到调度服务器的 WebSocket 端点
2. 自动发送 `node_register` 消息
3. 服务器验证 GPU 要求和其他信息
4. 服务器返回 `node_register_ack` 或 `node_error` 消息

详细说明请参考 [节点注册功能说明](./NODE_REGISTRATION_GUIDE.md)。

## 相关文档

- [WebSocket 协议规范](../PROTOCOLS.md) - 完整的 WebSocket 消息协议
- [Electron Node 实现文档](../electron_node/STAGE2.2_IMPLEMENTATION.md) - Electron Node 客户端实现
- [调度服务器架构](../ARCHITECTURE.md) - 调度服务器架构说明

