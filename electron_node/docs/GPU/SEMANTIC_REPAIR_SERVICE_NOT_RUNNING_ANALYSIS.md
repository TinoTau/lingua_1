# 语义修复服务未运行问题分析

## 问题现象

从日志中可以看到，所有语义修复请求都返回了 `"reasonCodes":["SERVICE_NOT_RUNNING"]`：

```
{"level":40,"serviceId":"semantic-repair-zh","baseUrl":"http://127.0.0.1:5013","status":"RUNNING","reason":"fetch failed","msg":"Semantic repair service not available (not warmed), returning PASS"}
```

## 根本原因

### 1. 语义修复服务没有被自动启动

**代码位置**：`electron_node/electron-node/main/src/index.ts`

**问题**：
- 在应用启动时，只有Python服务（ASR, NMT, TTS等）会根据`prefs`自动启动（第262-286行）
- 语义修复服务（`semantic-repair-zh`, `semantic-repair-en`）**没有自动启动逻辑**
- 只创建了`SemanticRepairServiceManager`实例（第292-295行），但没有调用`startService`

**对比**：
- ✅ Python服务：有自动启动逻辑（根据`prefs`配置）
- ❌ 语义修复服务：没有自动启动逻辑

### 2. `isServiceRunning`逻辑问题

**代码位置**：
- `electron_node/electron-node/main/src/task-router/task-router-service-manager.ts` (第255-292行)
- `electron_node/electron-node/main/src/agent/node-agent-services.ts` (第151-218行)

**问题**：
- 对于语义修复服务，`isServiceRunning`只检查服务是否在注册表中
- 如果服务在注册表中，就返回`true`，但这**不代表服务进程真的在运行**
- 这导致健康检查认为服务在运行，尝试连接，但实际服务进程没有启动，返回`fetch failed`

**代码逻辑**：
```typescript
// 语义修复服务：通过检查服务注册表来判断
if (serviceId === 'semantic-repair-zh' || serviceId === 'semantic-repair-en' || serviceId === 'en-normalize') {
  // 检查服务是否在注册表中（如果服务已安装，认为可能运行，实际状态由健康检查机制判断）
  if (this.serviceRegistryManager) {
    const current = this.serviceRegistryManager.getCurrent(serviceId);
    // 如果服务在注册表中，认为可能运行（实际状态由健康检查决定）
    return current !== null && current !== undefined;  // ⚠️ 这里只检查注册表，不检查进程
  }
  return false;
}
```

### 3. 健康检查失败

**代码位置**：`electron_node/electron-node/main/src/task-router/task-router-semantic-repair-health.ts`

**流程**：
1. `isServiceRunningCallback`返回`true`（因为服务在注册表中）
2. 健康检查尝试连接`http://127.0.0.1:5013/health`
3. 连接失败（`fetch failed`），因为服务进程没有启动
4. 返回`status: RUNNING, reason: "fetch failed"`
5. 生成`reason_codes: ["SERVICE_NOT_RUNNING"]`

## 解决方案

### 方案1：添加语义修复服务自动启动（推荐）

**修改位置**：`electron_node/electron-node/main/src/index.ts`

**实现**：
在创建`SemanticRepairServiceManager`后，添加自动启动逻辑：

```typescript
// 初始化语义修复服务管理器
semanticRepairServiceManager = new SemanticRepairServiceManager(
  serviceRegistryManager,
  servicesDir
);

// 自动启动语义修复服务（如果需要）
(async () => {
  try {
    // 检查服务是否已安装
    const installedServices = await semanticRepairServiceManager.getInstalledServices();
    
    // 自动启动中文语义修复服务（如果已安装）
    if (installedServices.zh) {
      logger.info({}, 'Auto-starting semantic-repair-zh service...');
      await semanticRepairServiceManager.startService('semantic-repair-zh');
      logger.info({}, 'semantic-repair-zh service started successfully');
    }
    
    // 自动启动英文语义修复服务（如果已安装）
    if (installedServices.en) {
      logger.info({}, 'Auto-starting semantic-repair-en service...');
      await semanticRepairServiceManager.startService('semantic-repair-en');
      logger.info({}, 'semantic-repair-en service started successfully');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to auto-start semantic repair services');
  }
})();
```

### 方案2：改进`isServiceRunning`逻辑

**修改位置**：
- `electron_node/electron-node/main/src/task-router/task-router-service-manager.ts`
- `electron_node/electron-node/main/src/agent/node-agent-services.ts`

**实现**：
检查`SemanticRepairServiceManager`的实际运行状态，而不是只检查注册表：

```typescript
// 语义修复服务：通过SemanticRepairServiceManager检查实际运行状态
if (serviceId === 'semantic-repair-zh' || serviceId === 'semantic-repair-en' || serviceId === 'en-normalize') {
  // 需要访问SemanticRepairServiceManager来检查实际运行状态
  // 但这需要传递SemanticRepairServiceManager实例
  // 或者通过服务注册表+健康检查来判断
  // 当前实现：先检查注册表，然后由健康检查机制判断实际状态
  // 问题：如果服务没有启动，健康检查会失败，但isServiceRunning返回true
  // 建议：改进isServiceRunning，检查SemanticRepairServiceManager的实际状态
}
```

**注意**：这需要修改`TaskRouter`和`ServicesHandler`的构造函数，传递`SemanticRepairServiceManager`实例。

### 方案3：改进健康检查的错误处理

**修改位置**：`electron_node/electron-node/main/src/task-router/task-router-semantic-repair-health.ts`

**实现**：
当`fetch failed`时，更准确地判断服务状态：

```typescript
// 如果fetch失败，且isProcessRunning为true，可能是服务启动失败
// 应该返回INSTALLED状态，而不是RUNNING状态
if (!healthCheckResult.healthy && isProcessRunning) {
  // 检查是否是连接错误（服务未启动）
  if (healthCheckResult.reason?.includes('fetch failed') || 
      healthCheckResult.reason?.includes('ECONNREFUSED')) {
    return {
      status: SemanticRepairServiceStatus.INSTALLED,  // 改为INSTALLED，而不是RUNNING
      isAvailable: false,
      reason: 'Service process may not be running',
      lastCheckTime: now,
    };
  }
}
```

## 推荐方案

**推荐使用方案1**：添加语义修复服务自动启动逻辑。

**理由**：
1. 最简单直接，解决根本问题
2. 与Python服务的自动启动逻辑一致
3. 不需要修改多个文件
4. 用户体验更好（服务自动启动）

## 配置检查

**需要确认**：
1. 语义修复服务是否已安装（在服务注册表中）
2. 服务配置文件（`service.json`）是否正确
3. 服务启动命令和参数是否正确
4. 服务端口（5013）是否被占用

## 下一步

1. **实施方案1**：添加语义修复服务自动启动逻辑
2. **测试验证**：确认服务能够正常启动
3. **检查日志**：确认服务启动成功，健康检查通过
