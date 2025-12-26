# 节点注册失败修复

## 问题描述

节点选择失败，调度服务器日志显示 `total_nodes=0`，没有可用节点。

## 根本原因

从日志分析发现：

1. **节点端**：
   - 节点无法连接到 Model Hub (`http://127.0.0.1:5000`)
   - `getInstalledModels()` 调用 `getAvailableModels()` 时抛出异常
   - 导致 `registerNode()` 失败，注册消息没有发送

2. **调度服务器**：
   - 在 `13:57:51` 时收到了节点 `node-FAC4B7D7` 的心跳
   - 但在 `18:22:17` 之后 `total_nodes=0`
   - 说明节点已断开或心跳超时被清理

## 修复方案

修改 `getInstalledModels()` 方法，在 Model Hub 连接失败时返回空数组，而不是抛出异常。这样：

1. **节点注册不会因为 Model Hub 连接失败而失败**
2. **节点可以正常注册到调度服务器**
3. **即使没有 Model Hub，节点仍然可以提供服务**

## 修改内容

**文件**: `electron_node/electron-node/main/src/inference/inference-service.ts`

**修改**: 在 `getInstalledModels()` 方法中，将 `getAvailableModels()` 调用包装在 try-catch 中，连接失败时返回空数组并记录警告日志。

## 验证方法

1. **启动 Model Hub**（如果可用）
2. **启动调度服务器**
3. **启动节点服务**
4. **检查节点端日志**：应该看到 "Sending node registration message" 而不是 "Failed to register node"
5. **检查调度服务器日志**：应该看到 "Processing node registration" 和节点成功注册

## 注意事项

- 即使 Model Hub 连接失败，节点仍然可以注册，只是 `installed_models` 列表为空
- 这不会影响节点的服务能力（ASR/NMT/TTS），因为这些服务不依赖 Model Hub
- Model Hub 主要用于模型下载和管理，不是节点运行的必要条件

