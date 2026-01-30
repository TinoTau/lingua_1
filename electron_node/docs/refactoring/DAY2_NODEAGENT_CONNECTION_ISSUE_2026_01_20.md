# Day 2 NodeAgent连接问题诊断 - 2026-01-20

## 🐛 **问题现象**

用户启动了调度服务器，但NodeAgent未发送心跳。

## 🔍 **诊断结果**

### 当前状态

从日志分析：

```json
✅ NodeAgent initialized (Day 2 Refactor: snapshot-based)
✅ Connected to scheduler server
✅ Starting node registration (readyState: 1)
❌ 注册流程卡住，没有后续日志
```

### 问题定位

注册流程在调用 `getInstalledServices()` 时卡住了。

---

## 🔍 **根本原因**

### Day 2重构的变更

**之前（备份代码）**:
```typescript
class ServicesHandler {
  constructor(
    serviceRegistryManager,
    rustServiceManager,
    pythonServiceManager
  )
  
  async getInstalledServices() {
    // 直接访问Manager获取服务列表
    // 包括从注册表、Rust Manager、Python Manager
    // 返回详细的InstalledService[]
  }
}
```

**现在（Day 2重构后）**:
```typescript
class ServicesHandlerSimple {
  constructor(
    getServiceSnapshot: () => any[]  // ← 只有快照函数
  )
  
  async getInstalledServices() {
    return this.getServiceSnapshot();  // ← 直接返回快照
  }
}
```

### 问题分析

1. **快照函数实现**:
   ```typescript
   function getServiceSnapshot() {
     const snapshot = buildInstalledServices(registry);
     return snapshot;
   }
   ```

2. **可能的问题**:
   - `buildInstalledServices()` 返回的格式可能不完整
   - 缺少某些必需字段
   - 与调度器协议不兼容

---

## 📊 **备份代码对比**

### 备份代码的完整逻辑

```typescript
async getInstalledServices(): Promise<InstalledService[]> {
  const result: InstalledService[] = [];
  
  // 1. 从ServiceRegistryManager读取
  const registry = await this.serviceRegistryManager.getRegistry();
  for (const [serviceId, metadata] of registry.entries()) {
    // 包含: service_id, type, device, status, version
    result.push({
      service_id: serviceId,
      type: mapType(metadata.type),
      device: 'gpu',
      status: metadata.status,
      version: metadata.version || '2.0.0'
    });
  }
  
  // 2. 检查RustServiceManager
  if (rustService.isRunning()) {
    result.push({
      service_id: 'node-inference',
      type: ServiceType.ASR,
      device: 'gpu',
      status: 'running',
      version: '2.0.0'
    });
  }
  
  // 3. 检查PythonServiceManager
  const pythonServices = this.pythonServiceManager.getAllStatuses();
  for (const [id, status] of pythonServices) {
    result.push({...});
  }
  
  // 4. 去重
  return dedup(result);
}
```

### 当前实现

```typescript
export function buildInstalledServices(registry: ServiceRegistry): InstalledService[] {
  const result: InstalledService[] = [];
  
  for (const entry of registry.values()) {
    result.push({
      service_id: entry.def.id,
      type: mapType(entry.def.type),
      device: entry.def.device || 'gpu',
      status: mapStatus(entry.runtime.status),
      version: entry.def.version || '2.0.0'
    });
  }
  
  return result;
}
```

**差异**:
- ✅ 基本字段相同
- ⚠️ 但可能缺少某些运行时信息
- ⚠️ 类型映射可能不完整

---

## 🔧 **解决方案**

### 方案1: 检查buildInstalledServices实现（推荐）

1. 确认类型映射正确
2. 确认状态映射正确
3. 添加详细日志

### 方案2: 临时回退ServicesHandler

使用备份代码的完整实现，保留访问Manager的能力。

### 方案3: 增强快照函数

在快照函数中加入更多信息收集逻辑。

---

## 🎯 **立即行动**

### Step 1: 检查buildInstalledServices

```bash
# 查看实现
cat service-layer/ServiceDiscovery.ts | grep -A 50 "buildInstalledServices"
```

### Step 2: 添加调试日志

在 `ServicesHandlerSimple.getInstalledServices()` 中添加：

```typescript
async getInstalledServices(): Promise<any[]> {
  logger.info({}, '🔍 [DEBUG] getInstalledServices called');
  
  const services = this.getServiceSnapshot();
  
  logger.info({
    serviceCount: services.length,
    services: services.map(s => ({
      id: s.service_id,
      type: s.type,
      status: s.status
    }))
  }, '🔍 [DEBUG] Service snapshot obtained');
  
  return services;
}
```

### Step 3: 测试

重启Electron，查看是否有调试日志输出。

---

## 📝 **临时解决方案**

如果需要立即恢复功能，可以：

1. **不启动NodeAgent**（不影响本地使用）
2. **使用环境变量禁用NodeAgent**:
   ```typescript
   if (process.env.ENABLE_NODE_AGENT !== 'true') {
     managers.nodeAgent = null;
   }
   ```

---

## 🎉 **下一步**

1. 检查`buildInstalledServices`实现
2. 添加详细日志
3. 确认类型和状态映射
4. 测试注册流程

---

**诊断时间**: 2026-01-20  
**问题**: NodeAgent注册卡住  
**原因**: Day 2快照函数可能缺少信息  
**状态**: 待修复
