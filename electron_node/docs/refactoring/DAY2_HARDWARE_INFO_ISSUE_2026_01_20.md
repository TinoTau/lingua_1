# Day 2 硬件信息获取卡住 - 2026-01-20

## 🐛 **问题确认**

注册流程卡在第一步：`getHardwareInfo()`

### 日志证据

```json
✅ [1/6] Getting hardware info...
❌ 之后没有任何日志
```

说明 `HardwareInfoHandler.getHardwareInfo()` 没有返回。

---

## 🔍 **可能的原因**

### 1. GPU信息查询卡住

`systeminformation` 库的 `si.graphics()` 调用可能在查询GPU信息时卡住。

### 2. 异步调用没有正确处理

可能有Promise没有resolve或reject。

### 3. 超时机制缺失

没有超时保护，导致无限等待。

---

## 🔧 **临时解决方案**

### 方案1: 添加超时保护

```typescript
async getHardwareInfo(): Promise<HardwareInfo> {
  const timeout = 5000; // 5秒超时
  
  return Promise.race([
    this.doGetHardwareInfo(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Hardware info timeout')), timeout)
    )
  ]);
}
```

### 方案2: 使用缓存或简化版本

```typescript
async getHardwareInfo(): Promise<HardwareInfo> {
  // 跳过复杂的GPU查询，使用简化版本
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    memory_mb: Math.floor(os.totalmem() / 1024 / 1024),
    gpus: [], // 暂时返回空数组
  };
}
```

### 方案3: 异步后台获取

```typescript
async getHardwareInfo(): Promise<HardwareInfo> {
  // 先返回基本信息
  const basic = {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    memory_mb: Math.floor(os.totalmem() / 1024 / 1024),
    gpus: [],
  };
  
  // GPU信息后台获取（不阻塞注册流程）
  this.fetchGpuInfoAsync().then(gpus => {
    logger.info({ gpus: gpus.length }, 'GPU info fetched asynchronously');
  }).catch(err => {
    logger.warn({ err }, 'Failed to fetch GPU info');
  });
  
  return basic;
}
```

---

## ✅ **推荐方案**

**使用方案2（简化版本） + 后续优化**

理由：
1. 注册流程不应该依赖复杂的GPU查询
2. 简单信息足以让调度器识别节点
3. GPU信息可以在心跳中补充

---

## 🎯 **立即修复**

我会实现方案2，让注册流程能够继续。
