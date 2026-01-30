# 服务ID映射修复 - 2026-01-20

## 🐛 问题描述

用户报告nmt和tts服务启动时提示"service not found"。

## 🔍 根本原因

**前端传的服务ID与service.json中的ID不匹配！**

### 前端代码（ServiceManagement.tsx）

```typescript
const handleStartPython = async (serviceName: 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding') => {
  const result = await window.electronAPI.startPythonService(serviceName);
  // 前端传的是: 'nmt' 或 'tts'
}
```

### 实际的service.json

```json
// nmt_m2m100/service.json
{
  "id": "nmt-m2m100",  // 实际ID
  ...
}

// piper_tts/service.json
{
  "id": "piper-tts",  // 实际ID
  ...
}
```

### 问题

```
前端传: 'nmt' 或 'tts'
实际ID: 'nmt-m2m100' 或 'piper-tts'
```

IPC handler只做了下划线转连字符的转换（`faster_whisper_vad` → `faster-whisper-vad`），但无法处理 `nmt` → `nmt-m2m100` 这种映射。

---

## ✅ 解决方案

### 在IPC handler中添加完整的ID映射表

**位置**: `electron-node/main/src/index.ts`

**修改**: `start-python-service` 和 `stop-python-service` handlers

```typescript
ipcMain.handle('start-python-service', async (_event, serviceName: string) => {
  if (!managers.serviceRunner) {
    throw new Error('Service runner not initialized');
  }
  
  // 添加完整的ID映射表
  const serviceIdMap: Record<string, string> = {
    // 旧命名 -> 新ID
    'nmt': 'nmt-m2m100',
    'tts': 'piper-tts',
    'yourtts': 'your-tts',
    'faster_whisper_vad': 'faster-whisper-vad',
    'speaker_embedding': 'speaker-embedding',
    // 也支持已经转换好的ID（幂等性）
    'nmt-m2m100': 'nmt-m2m100',
    'piper-tts': 'piper-tts',
    'your-tts': 'your-tts',
    'faster-whisper-vad': 'faster-whisper-vad',
    'speaker-embedding': 'speaker-embedding',
  };
  
  let serviceId = serviceIdMap[serviceName] || serviceName;
  
  // 如果映射表没有，尝试下划线转连字符（向后兼容）
  const registry = getServiceRegistry();
  if (registry && !registry.has(serviceId)) {
    const convertedId = serviceName.replace(/_/g, '-');
    if (registry.has(convertedId)) {
      serviceId = convertedId;
    }
  }
  
  // 最后检查服务是否存在
  if (registry && !registry.has(serviceId)) {
    throw new Error(`Service not found: ${serviceName} (tried: ${serviceId})`);
  }
  
  logger.info({ serviceId, originalName: serviceName }, 'IPC: Starting Python service');
  await managers.serviceRunner.start(serviceId);
  return { success: true };
});
```

---

## 📊 修复前后对比

### 修复前 ❌

```
前端调用: startPythonService('nmt')
    ↓
IPC handler: serviceName = 'nmt'
    ↓
ID转换: 'nmt' (无变化，因为没有下划线)
    ↓
ServiceRegistry.get('nmt'): undefined
    ↓
错误: Service not found ❌
```

### 修复后 ✅

```
前端调用: startPythonService('nmt')
    ↓
IPC handler: serviceName = 'nmt'
    ↓
ID映射: serviceIdMap['nmt'] = 'nmt-m2m100'
    ↓
ServiceRegistry.get('nmt-m2m100'): 找到服务 ✅
    ↓
启动成功！
```

---

## 🎯 为什么需要这个映射？

### 历史原因

**旧架构**（备份文件中）：
- 使用 `PythonServiceManager`
- 服务名硬编码在代码中：`'nmt'`, `'tts'`, etc.
- 前端UI也硬编码这些名字

**新架构**（当前）：
- 使用 `ServiceRegistry` + `service.json`
- 服务ID来自 `service.json` 的 `"id"` 字段
- 更规范的命名：`'nmt-m2m100'`, `'piper-tts'`

### 为什么不修改前端？

1. **向后兼容**：前端UI代码量大，修改风险高
2. **渐进式迁移**：可以逐步更新前端，而不是一次性修改
3. **保护旧代码**：备份代码中的前端也能继续工作

---

## 🔄 兼容性策略

### 3层ID查找机制

```typescript
// 1. 首先尝试映射表（处理旧命名）
let serviceId = serviceIdMap[serviceName] || serviceName;

// 2. 如果没找到，尝试下划线转连字符（处理命名风格差异）
if (!registry.has(serviceId)) {
  const convertedId = serviceName.replace(/_/g, '-');
  if (registry.has(convertedId)) {
    serviceId = convertedId;
  }
}

// 3. 最后检查是否存在（明确报错）
if (!registry.has(serviceId)) {
  throw new Error(`Service not found: ${serviceName} (tried: ${serviceId})`);
}
```

**支持的输入格式**：
- ✅ 旧命名：`'nmt'`, `'tts'`
- ✅ 下划线格式：`'faster_whisper_vad'`
- ✅ 连字符格式：`'faster-whisper-vad'`
- ✅ 完整ID：`'nmt-m2m100'`, `'piper-tts'`

---

## 🎉 测试结果

### 预期结果

现在应该能成功启动：
- ✅ nmt服务（前端传`'nmt'` → 映射到 `'nmt-m2m100'`）
- ✅ tts服务（前端传`'tts'` → 映射到 `'piper-tts'`）
- ✅ faster-whisper-vad（前端传`'faster_whisper_vad'` → 映射到 `'faster-whisper-vad'`）

---

## 📝 后续优化建议

### 长期方案：统一前端命名

**建议**：让前端使用 `discoveredServices` 列表中的实际服务ID

```typescript
// ServiceManagement.tsx 改进
const handleStartDiscoveredService = async (serviceId: string) => {
  // 直接使用实际的service ID，不需要映射
  const result = await window.electronAPI.serviceDiscovery.start(serviceId);
}
```

**优点**：
- ✅ 无需维护映射表
- ✅ 支持动态添加服务（热插拔）
- ✅ 前端代码更简洁

**当前为什么不这么做？**：
- 旧前端UI大量使用硬编码的服务名
- 需要重构整个 `ServiceManagement.tsx`
- 可以作为Day 5重构的一部分

---

## ✅ 结论

**短期方案**：✅ 完成
- ID映射表修复（已实施）
- 支持旧前端命名
- 向后兼容

**长期方案**：待Day 5重构
- 统一使用kebab-case
- 前端直接使用discoveredServices
- 删除映射表

---

**修复用时**: 10分钟
**影响范围**: 2个IPC handlers
**兼容性**: 完全向后兼容
**测试**: 待用户验证
