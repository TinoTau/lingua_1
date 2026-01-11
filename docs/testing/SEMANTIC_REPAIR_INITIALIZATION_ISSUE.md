# 语义修复初始化问题分析

## 问题描述

在集成测试中，虽然 electron 窗口中看到语义修复服务已经运行，但实际测试时没有进行语义修复。

## 关键发现

### 初始化逻辑分析

语义修复 Stage 的初始化需要满足以下条件（`semantic-repair-stage.ts` 第53行）：

```typescript
if (installedServices.zh && config.zh?.enabled && taskRouter) {
  this.zhStage = new SemanticRepairStageZH(taskRouter, config.zh || {});
}
```

**三个条件必须同时满足**：
1. `installedServices.zh` 为 `true`
2. `config.zh?.enabled` 为 `true`
3. `taskRouter` 不为 `null`

### 问题根源

在 `postprocess-semantic-repair-initializer.ts` 中（第64行），`config.zh.enabled` 的值来自 `installedServices.zh`：

```typescript
zh: {
  enabled: installedServices.zh,  // 这里直接使用 installedServices.zh
  qualityThreshold: semanticRepairConfig.zh?.qualityThreshold || 0.70,
  forceForShortSentence: semanticRepairConfig.zh?.forceForShortSentence || false,
},
```

而 `installedServices.zh` 的值由 `getInstalledSemanticRepairServices()` 决定，它检查：
1. 服务是否在服务注册表中（`serviceRegistryManager.listInstalled()`）
2. 服务是否运行（`isServiceRunning('semantic-repair-zh')`）

**关键问题**：`isServiceRunning` 只检查服务是否在注册表中（`getCurrent(serviceId)`），而不是检查实际运行状态（`node-agent-services.ts` 第186行）。

### 可能的原因

1. **服务注册表未更新**：
   - 服务虽然运行了，但在初始化检查时，服务还没有在注册表中注册
   - 或者服务注册表没有正确加载

2. **时序问题**：
   - 服务在 electron 窗口中显示为运行，但 `SemanticRepairInitializer.initialize()` 检查时服务还没有完全注册到注册表
   - 初始化发生在服务启动之前

3. **注册表数据丢失**：
   - 服务启动后没有正确更新注册表的 `current` 字段
   - 或者注册表文件损坏

## 验证方法

检查节点端日志，查找以下信息：

1. **初始化日志**：
   ```
   SemanticRepairInitializer: SemanticRepairStage initialized successfully
   ```
   或
   ```
   SemanticRepairInitializer: No semantic repair services installed, skipping initialization
   ```

2. **服务注册表日志**：
   ```
   Retrieved installed services from registry
   ```

3. **语义修复跳过日志**：
   ```
   PostProcessCoordinator: Semantic repair stage skipped (not available)
   ```

## 验证方法

### 1. 检查节点端日志

查看节点端日志中是否有以下信息：

**初始化成功日志**：
```
SemanticRepairInitializer: SemanticRepairStage initialized successfully
SemanticRepairStage: ZH stage initialized
```

**初始化失败日志**：
```
SemanticRepairInitializer: No semantic repair services installed, skipping initialization
PostProcessCoordinator: Semantic repair stage skipped (not available)
```

### 2. 检查服务注册表

查看服务注册表文件（通常在 `electron_node/electron-node/services/registry.json`），确认 `semantic-repair-zh` 是否在 `current` 字段中：

```json
{
  "current": {
    "semantic-repair-zh": {
      "version": "...",
      "platform": "...",
      "install_path": "..."
    }
  }
}
```

### 3. 检查初始化时序

确认服务启动后，`SemanticRepairInitializer.initialize()` 是否在服务完全注册到注册表之后执行。

## 问题根源

### 当前检查逻辑的缺陷

`ServicesHandler.isServiceRunning()` 对于语义修复服务（`node-agent-services.ts` 第200行）：

```typescript
const current = this.serviceRegistryManager.getCurrent(serviceId);
return current !== null && current !== undefined;
```

**只检查服务注册表的 `current` 字段**，不检查实际运行状态。

这意味着：
- 如果服务在 electron 窗口中显示为运行，但注册表中没有记录 → `isServiceRunning` 返回 `false`
- 如果服务没有启动，但注册表中有记录 → `isServiceRunning` 返回 `true`（错误）

### 可能的原因

1. **服务启动后注册表未更新**：
   - 服务进程启动了，但 `SemanticRepairServiceManager.startService()` 没有正确调用 `serviceRegistryManager.setCurrent()`
   - 或者注册表文件写入失败

2. **初始化时序问题**：
   - `SemanticRepairInitializer.initialize()` 在服务启动前执行
   - 或者服务启动后，注册表更新前，初始化就完成了

3. **注册表加载失败**：
   - `serviceRegistryManager.loadRegistry()` 失败
   - 或者注册表文件损坏

## 解决方案

### 临时解决方案

1. **检查服务注册表文件**：确保 `semantic-repair-zh` 在注册表的 `current` 字段中
2. **重启节点端**：确保服务启动后注册表正确更新，然后重新初始化 `SemanticRepairStage`

### 长期解决方案

**改进 `isServiceRunning` 逻辑**：

当前 `ServicesHandler.isServiceRunning()` 只检查注册表，应该改为：
1. 首先检查 `SemanticRepairServiceManager.getServiceStatus()` 的实际运行状态
2. 如果 `SemanticRepairServiceManager` 不可用，再降级到注册表检查

这需要：
1. 在 `ServicesHandler` 构造函数中添加 `SemanticRepairServiceManager` 参数
2. 修改 `isServiceRunning` 方法，优先使用 `SemanticRepairServiceManager.getServiceStatus()`

## 建议

1. **立即检查**：查看节点端日志，确认是否有 "Semantic repair stage skipped" 或 "No semantic repair services installed" 的日志
2. **检查注册表**：确认服务注册表文件中是否有 `semantic-repair-zh` 的记录
3. **重启测试**：重启节点端，确保服务启动后等待注册表更新，然后再进行测试
4. **长期修复**：改进 `isServiceRunning` 逻辑，使用 `SemanticRepairServiceManager.getServiceStatus()` 检查实际运行状态
