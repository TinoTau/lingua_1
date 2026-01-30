# Day 2 连接问题诊断 - 2026-01-20

## 🐛 **问题现象**

节点端已连接到调度器（WebSocket连接成功），但注册流程卡住，没有发送注册消息和心跳。

---

## 🔍 **日志分析**

### Electron节点端日志

```json
✅ Connected to scheduler server (ws://127.0.0.1:5010/ws/node)
✅ Starting node registration (readyState: 1)
❌ 之后没有任何日志！
```

### 预期应该有的日志（但缺失）

```json
// 应该看到：
Hardware info retrieved
Installed models retrieved
Installed services retrieved: { serviceCount: 9, ... }
Capability by type retrieved
Language capabilities detected
Features supported retrieved
Sending node registration message
Registration message sent
```

### 实际情况

**所有这些日志都没有出现**，说明注册流程在第一步就卡住了。

---

## 🎯 **问题定位**

### 可能的原因

#### 1. ❌ `getHardwareInfo()` 卡住

如果硬件信息获取卡住（等待GPU查询），会阻塞整个流程。

#### 2. ❌ 异步函数未正确等待

可能有Promise没有正确await，导致silent failure。

#### 3. ❌ 异常被吞掉

注册流程中可能有try-catch吞掉了异常但没有记录。

---

## 🔧 **诊断步骤**

### Step 1: 检查是否有未捕获的Promise rejection

在 `node-agent-simple.ts` 的 `start()` 方法中：

```typescript
this.ws.on('open', () => {
  logger.info({ schedulerUrl: this.schedulerUrl, nodeId: this.nodeId }, 'Connected to scheduler server');
  
  // 更新handler的连接信息
  this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
  this.registrationHandler.updateConnection(this.ws, this.nodeId);
  
  logger.info({ readyState: this.ws.readyState }, 'Starting node registration');
  
  // ⚠️ 这里调用registerNode()，如果异常没有被捕获会silent fail
  this.registrationHandler.registerNode();  // 注意：没有await！
  
  // 启动心跳
  this.heartbeatHandler.startHeartbeat();
});
```

**问题**：`registerNode()` 是async函数，但这里没有await，如果它抛出异常，会是未处理的Promise rejection。

### Step 2: 检查registerNode实现

在 `node-agent-registration.ts`:

```typescript
async registerNode(): Promise<void> {
  if (!this.ws) {
    logger.warn({}, 'Cannot register node: WebSocket is null');
    return;
  }

  if (this.ws.readyState !== WebSocket.OPEN) {
    logger.warn({ readyState: this.ws.readyState }, 'Cannot register node: WebSocket is not OPEN');
    return;
  }

  logger.info({ readyState: this.ws.readyState }, 'Starting node registration');

  try {
    // 获取硬件信息
    const hardware = await this.hardwareHandler.getHardwareInfo();
    // ⬆️ 如果这里卡住或抛出异常...
    
    logger.debug({ gpus: hardware.gpus?.length || 0 }, 'Hardware info retrieved');
    // ... 这行日志就不会输出
```

**发现**：日志显示执行到 "Starting node registration"，但之后立即停止，说明`getHardwareInfo()`调用失败了。

---

## 💡 **根本原因**

### 问题1: 未捕获的Promise rejection

在 `node-agent-simple.ts` 的 `start()` 方法中：

```typescript
this.registrationHandler.registerNode();  // ❌ 没有await，没有.catch()
```

如果`registerNode()`抛出异常，会是unhandled promise rejection，不会显示在日志中。

### 问题2: `getHardwareInfo()` 可能卡住

`HardwareInfoHandler.getHardwareInfo()` 可能在等待GPU信息时卡住。

---

## 🔧 **修复方案**

### 修复1: 正确处理Promise

在 `node-agent-simple.ts` 中：

```typescript
this.ws.on('open', () => {
  logger.info(..., 'Connected to scheduler server');
  
  // 更新连接
  this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
  this.registrationHandler.updateConnection(this.ws, this.nodeId);
  
  logger.info({ readyState: this.ws.readyState }, 'Starting node registration');
  
  // ✅ 正确处理异步调用
  this.registrationHandler.registerNode().catch((error) => {
    logger.error({ error }, 'Failed to register node');
  });
  
  // 启动心跳
  this.heartbeatHandler.startHeartbeat();
});
```

### 修复2: 添加超时保护

在 `node-agent-registration.ts` 中为每个步骤添加超时：

```typescript
async registerNode(): Promise<void> {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    logger.warn({}, 'Cannot register: WebSocket not ready');
    return;
  }

  logger.info({}, 'Starting node registration');

  try {
    // 获取硬件信息（5秒超时）
    logger.debug({}, 'Getting hardware info...');
    const hardware = await Promise.race([
      this.hardwareHandler.getHardwareInfo(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Hardware info timeout')), 5000)
      )
    ]);
    logger.debug({ gpus: hardware.gpus?.length }, 'Hardware info retrieved');
    
    // ... 其他步骤
    
  } catch (error) {
    logger.error({ error }, 'Registration failed');
    throw error;  // 重新抛出，让caller处理
  }
}
```

---

## 🎯 **立即修复**

### 最小改动方案

只需修改1个地方：

**文件**: `node-agent-simple.ts`

**位置**: `start()` 方法的 `ws.on('open')` 回调

**改动**:
```typescript
// ❌ 之前
this.registrationHandler.registerNode();

// ✅ 现在  
this.registrationHandler.registerNode().catch((error) => {
  logger.error({ error }, 'Failed to register node');
});
```

这样至少能看到错误信息。

---

## 🔍 **验证步骤**

1. 修改代码
2. 重新编译：`npm run build:main`
3. 重启Electron
4. 查看日志，应该能看到：   - 如果成功：完整的注册流程日志
   - 如果失败："Failed to register node" + 详细错误信息

---

**诊断时间**: 2026-01-20  
**问题**: Promise rejection未处理  
**影响**: 注册流程silent fail  
**修复**: 添加.catch()处理
