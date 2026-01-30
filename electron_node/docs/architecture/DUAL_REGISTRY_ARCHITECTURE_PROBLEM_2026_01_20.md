# 双Registry架构问题分析与修复 - 2026-01-20

## 🚨 **严重架构问题**

### 问题1：两个独立的ServiceRegistry

系统中存在**两个并行运行的ServiceRegistry**，它们不同步！

#### Registry 1 - 新架构（app-init-simple.ts）

```typescript
// app-init-simple.ts Line 95-140
export async function initializeServicesSimple(): Promise<ServiceManagers> {
  // 1. 初始化服务层（创建registry和supervisor）
  const { registry, supervisor } = await initServiceLayer(servicesDir);
  
  // 2. 但只使用了registry，传给ServiceProcessRunner
  const serviceRunner = new ServiceProcessRunner(registry);
  
  // 3. supervisor被忽略了！没有使用！
  // supervisor不可访问，其他模块无法获取
}
```

#### Registry 2 - 旧架构（service-ipc-handlers.ts）

```typescript
// service-ipc-handlers.ts Line 13-14
let serviceRegistry: ServiceRegistry;  // ❌ 内部维护自己的registry！
let serviceSupervisor: NodeServiceSupervisor;

export async function initServiceLayer(servicesRootPath: string) {
  // 创建新的registry实例
  serviceRegistry = await scanServices(servicesRoot);
  serviceSupervisor = new NodeServiceSupervisor(serviceRegistry);
  
  return { registry: serviceRegistry, supervisor: serviceSupervisor };
}

// 但返回的registry在app-init-simple中被用于ServiceProcessRunner
// 而内部的serviceRegistry用于services:list等IPC handlers
// 两个registry是同一个对象吗？不！看下面的分析...
```

#### 关键问题

```typescript
// app-init-simple调用initServiceLayer
const { registry, supervisor } = await initServiceLayer(servicesDir);

// ❌ 返回的registry被传给ServiceProcessRunner
const serviceRunner = new ServiceProcessRunner(registry);

// ❌ 但service-ipc-handlers内部仍持有自己的serviceRegistry引用
// 当services:refresh被调用时：
ipcMain.handle('services:refresh', async () => {
  // Line 76: 重新扫描，创建新registry
  serviceRegistry = await scanServices(servicesRoot);  // ❌ 新对象！
  
  // Line 79: 创建新supervisor
  serviceSupervisor = new NodeServiceSupervisor(serviceRegistry);  // ❌ 新对象！
});
```

**结果**：
- ServiceProcessRunner使用的是**旧registry**（refresh之前的）
- NodeServiceSupervisor使用的是**新registry**（refresh之后的）
- **两个registry完全不同步！**

---

### 问题2：刷新服务停止所有运行中的服务

```typescript
// service-ipc-handlers.ts Line 72-73
// 先停止所有运行中的服务
await serviceSupervisor.stopAllServices();  // ❌ 严重错误！
```

**影响**：
- 用户点击"刷新服务"
- **所有正在运行的服务被强制停止**
- 用户体验极差
- 可能导致任务中断

**为什么这样设计？**：
- 因为要"重建 supervisor"（Line 78-79）
- 旧supervisor持有进程引用，如果不停止，进程会变成孤儿进程

**但这是错误的设计！**：
- 刷新服务应该只更新service.json的定义
- 不应该影响正在运行的服务
- 应该保留运行中服务的runtime状态

---

### 问题3：语义修复服务不显示

```typescript
// runtime-handlers-simple.ts Line 292-316
ipcMain.handle('get-all-semantic-repair-service-statuses', async () => {
  const supervisor = getServiceSupervisor();  // 获取supervisor
  const allServices = supervisor.listServices();  // 从supervisor的registry查询
  const semanticServices = allServices.filter(s => s.def.type === 'semantic');
  
  return semanticServices.map(service => ({
    serviceId: service.def.id,
    running: service.runtime.status === 'running',  // ❌ 但运行状态在另一个registry中！
    // ...
  }));
});
```

**流程分析**：

1. 用户通过UI启动semantic-repair服务
2. 调用`startPythonService('semantic-repair-en-zh')`
3. IPC handler调用`managers.serviceRunner.start('semantic-repair-en-zh')`
4. **ServiceProcessRunner在Registry1中更新runtime.status = 'running'**

但是：

5. 前端查询语义修复服务状态
6. 调用`getAllSemanticRepairServiceStatuses()`
7. IPC handler调用`getServiceSupervisor().listServices()`
8. **NodeServiceSupervisor返回Registry2中的服务列表**
9. **Registry2中的runtime.status = 'stopped'**（因为它没有被更新！）

**结果**：UI显示服务已停止，但实际进程在运行！

---

## ✅ **正确的架构设计**

### 原则

1. **单一数据源**：整个应用只有**一个ServiceRegistry**实例
2. **共享引用**：所有模块使用**同一个registry引用**
3. **非破坏性刷新**：刷新服务只更新定义，保留runtime状态
4. **状态一致性**：任何模块更新runtime状态，其他模块立即可见

### 架构图

```
┌─────────────────────────────────────────┐
│     全局共享 ServiceRegistry (单例)      │
│  Map<serviceId, { def, runtime, path }> │
└─────────────┬───────────────────────────┘
              │ 共享引用
      ┌───────┴───────┬────────────┬──────────────┐
      │               │            │              │
┌─────▼──────┐ ┌──────▼──────┐ ┌──▼───────┐ ┌───▼──────────┐
│ServiceProc │ │NodeService  │ │Services: │ │get-all-      │
│essRunner   │ │Supervisor   │ │list/     │ │semantic-     │
│            │ │             │ │refresh   │ │repair-status │
│启动/停止   │ │监督/管理    │ │IPC       │ │IPC           │
└────────────┘ └─────────────┘ └──────────┘ └──────────────┘
     │               │            │              │
     └───────────────┴────────────┴──────────────┘
                      │
            所有更新同步到同一个registry
```

---

## 🔧 **修复方案**

### 修复1：统一ServiceRegistry到全局单例

**新文件**: `service-layer/ServiceRegistrySingleton.ts`

```typescript
/**
 * ServiceRegistry 全局单例
 * 确保整个应用只有一个registry实例
 */
import { ServiceRegistry } from './ServiceTypes';

let globalRegistry: ServiceRegistry | null = null;

export function setServiceRegistry(registry: ServiceRegistry): void {
  globalRegistry = registry;
}

export function getServiceRegistry(): ServiceRegistry {
  if (!globalRegistry) {
    throw new Error('ServiceRegistry not initialized! Call setServiceRegistry first.');
  }
  return globalRegistry;
}
```

### 修复2：修改service-ipc-handlers.ts

**移除内部registry，使用全局单例**

```typescript
// 删除这些：
// let serviceRegistry: ServiceRegistry;  // ❌ 删除
// let serviceSupervisor: NodeServiceSupervisor;  // ❌ 删除

// 改为：
import { getServiceRegistry, setServiceRegistry } from './ServiceRegistrySingleton';

let serviceSupervisor: NodeServiceSupervisor;
let servicesRoot: string;

export async function initServiceLayer(servicesRootPath: string) {
  servicesRoot = servicesRootPath;
  
  // 扫描并创建registry
  const registry = await scanServices(servicesRoot);
  
  // ✅ 设置为全局单例
  setServiceRegistry(registry);
  
  // ✅ 使用全局registry创建supervisor
  serviceSupervisor = new NodeServiceSupervisor(getServiceRegistry());
  
  return {
    registry,
    supervisor: serviceSupervisor,
  };
}
```

### 修复3：修改services:refresh - 非破坏性刷新

```typescript
ipcMain.handle('services:refresh', async () => {
  try {
    logger.info({}, 'IPC: services:refresh - rescanning services directory');

    // ✅ 1. 重新扫描，获取最新的service.json定义
    const freshRegistry = await scanServices(servicesRoot);
    
    // ✅ 2. 合并到现有registry，保留运行中服务的runtime状态
    const currentRegistry = getServiceRegistry();
    
    for (const [serviceId, freshEntry] of freshRegistry.entries()) {
      const currentEntry = currentRegistry.get(serviceId);
      
      if (currentEntry) {
        // 服务已存在：更新定义，保留runtime状态
        currentEntry.def = freshEntry.def;
        currentEntry.installPath = freshEntry.installPath;
        // ✅ 保持 currentEntry.runtime 不变！
        logger.debug({ serviceId }, 'Updated service definition, preserved runtime state');
      } else {
        // 新发现的服务：直接添加
        currentRegistry.set(serviceId, freshEntry);
        logger.info({ serviceId }, 'Added new service');
      }
    }
    
    // ✅ 3. 检查已删除的服务（可选）
    for (const [serviceId, currentEntry] of currentRegistry.entries()) {
      if (!freshRegistry.has(serviceId)) {
        // 服务的service.json被删除了
        if (currentEntry.runtime.status === 'running') {
          logger.warn({ serviceId }, 'Service removed but still running, keeping it');
          // ✅ 保留运行中的服务，不删除
        } else {
          // 已停止的服务可以移除
          currentRegistry.delete(serviceId);
          logger.info({ serviceId }, 'Removed stopped service');
        }
      }
    }
    
    // ✅ 4. 不需要重建supervisor，因为它已经引用同一个registry
    // serviceSupervisor = new NodeServiceSupervisor(currentRegistry); // ❌ 删除这行
    
    const services = serviceSupervisor.listServices();
    logger.info({ count: services.length }, 'IPC: services:refresh completed');
    
    return services;
  } catch (error) {
    logger.error({ error }, 'IPC: services:refresh failed');
    throw error;
  }
});
```

### 修复4：修改app-init-simple.ts

**使用全局registry**

```typescript
import { getServiceRegistry } from '../service-layer/ServiceRegistrySingleton';

export async function initializeServicesSimple(): Promise<ServiceManagers> {
  // ... 初始化服务目录 ...
  
  // ✅ 初始化服务层（设置全局registry）
  const { registry, supervisor } = await initServiceLayer(servicesDir);
  
  // ✅ 从全局单例获取registry（确保使用同一个实例）
  const sharedRegistry = getServiceRegistry();
  
  // ✅ 所有组件使用同一个registry
  const serviceRunner = new ServiceProcessRunner(sharedRegistry);
  const endpointResolver = new ServiceEndpointResolver(sharedRegistry);
  
  // ...
}
```

---

## 📝 **修复后的效果**

### 刷新服务

1. ✅ 点击"刷新服务"
2. ✅ 重新扫描services目录
3. ✅ 更新service.json定义
4. ✅ **运行中的服务继续运行**
5. ✅ 发现新服务，添加到列表
6. ✅ 已删除的service.json对应的服务，如果在运行则保留

### 语义修复服务显示

1. ✅ 启动semantic-repair服务
2. ✅ ServiceProcessRunner更新registry.runtime.status = 'running'
3. ✅ get-all-semantic-repair-service-statuses查询**同一个registry**
4. ✅ **返回正确的运行状态**
5. ✅ UI正确显示"运行中"

### 数据一致性

- ✅ 所有模块使用**同一个registry引用**
- ✅ 任何模块更新runtime状态，其他模块立即可见
- ✅ 不存在状态不同步问题

---

## 🎯 **实施步骤**

### Step 1: 创建全局单例

1. 创建`ServiceRegistrySingleton.ts`
2. 导出`getServiceRegistry()`和`setServiceRegistry()`

### Step 2: 修改service-ipc-handlers.ts

1. 删除内部的`serviceRegistry`变量
2. 使用全局`getServiceRegistry()`
3. 修改`initServiceLayer`设置全局registry
4. 修改`services:refresh`为非破坏性合并

### Step 3: 修改app-init-simple.ts

1. 导入全局`getServiceRegistry()`
2. 确保ServiceProcessRunner使用全局registry

### Step 4: 验证

1. 启动应用，查看语义修复服务显示
2. 启动语义修复服务，确认状态正确
3. 点击"刷新服务"，确认运行中的服务不受影响

---

## 💡 **架构原则总结**

### 单一数据源（Single Source of Truth）

- ✅ 整个应用只有一个ServiceRegistry实例
- ✅ 所有模块共享同一个引用
- ✅ 避免数据不一致

### 最小影响原则（Minimal Impact）

- ✅ 刷新服务只更新配置定义
- ✅ 不影响运行中的服务
- ✅ 保留runtime状态

### 清晰的职责分离

- ServiceRegistry：数据存储
- ServiceProcessRunner：进程管理（启动/停止）
- NodeServiceSupervisor：服务监督（状态查询/管理）
- IPC Handlers：前后端通信

---

**问题根因**: 两个独立的ServiceRegistry实例不同步  
**修复方案**: 全局单例 + 非破坏性刷新  
**预期效果**: 
- ✅ 语义修复服务正确显示
- ✅ 刷新服务不影响运行中的服务  
- ✅ 所有状态同步一致
