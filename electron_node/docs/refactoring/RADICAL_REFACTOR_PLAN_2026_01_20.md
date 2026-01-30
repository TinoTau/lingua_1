# 🔥 激进式架构改造方案 - 2026-01-20

**原则**: 只保留一套架构 / 不留兼容层 / 流程一条线 / 错了就直接爆出来

---

## 🎯 核心决策

### ❌ 不做的事
1. ❌ 不要兼容层（`legacyServiceRegistryManager`等）
2. ❌ 不要渐进迁移（直接硬切）
3. ❌ 不要防御性兜底（错误直接暴露）
4. ❌ 不要旧的PythonServiceManager和RustServiceManager

### ✅ 要做的事
1. ✅ 创建统一的`ServiceProcessRunner`（取代所有Manager）
2. ✅ 简化InferenceService（只管调用，不管启动）
3. ✅ 统一IPC handlers（一套代码）
4. ✅ 错误直接抛出（方便调试）

---

## 📦 新架构设计

### 架构层次

```
┌─────────────────────────────────────────────┐
│              前端 UI                         │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│         IPC Handlers (一套)                  │
│  - services:list                            │
│  - services:start                           │
│  - services:stop                            │
│  - services:status                          │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│        ServiceProcessRunner                 │
│  统一的进程启动/停止管理器                    │
│  - start(serviceId)                         │
│  - stop(serviceId)                          │
│  - getStatus(serviceId)                     │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│          ServiceRegistry                    │
│  - get(serviceId) → ServiceEntry            │
│  - list() → ServiceEntry[]                  │
└─────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│      services/*/service.json                │
│  所有配置的唯一来源                          │
└─────────────────────────────────────────────┘
```

---

## 🛠️ 实施步骤

### Phase 1: 创建ServiceProcessRunner（0.5天）

**目标**: 统一的进程启动器，取代PythonServiceManager和RustServiceManager

**代码实现**:

```typescript
// main/src/service-layer/ServiceProcessRunner.ts

import { spawn, ChildProcess } from 'child_process';
import { ServiceRegistry } from './ServiceRegistry';
import logger from '../logger';

export class ServiceProcessRunner {
  private processes = new Map<string, ChildProcess>();

  constructor(private registry: ServiceRegistry) {}

  async start(serviceId: string): Promise<void> {
    // 1. 从注册表获取服务定义
    const entry = this.registry.get(serviceId);
    if (!entry) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    // 2. 检查是否已经在运行
    if (entry.runtime.status === 'running') {
      throw new Error(`Service already running: ${serviceId}`);
    }

    // 3. 从service.json读取启动配置
    const { command } = entry.def;
    if (!command) {
      throw new Error(`Service ${serviceId} has no command defined in service.json`);
    }

    const { executable, args, cwd, env } = command;

    logger.info({
      serviceId,
      executable,
      args,
      cwd,
    }, '🚀 Starting service process');

    // 4. 启动进程
    try {
      const proc = spawn(executable, args || [], {
        cwd: cwd || entry.installPath,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.processes.set(serviceId, proc);

      // 5. 监听进程事件
      proc.stdout?.on('data', (data) => {
        logger.debug({ serviceId, data: data.toString() }, 'Service stdout');
      });

      proc.stderr?.on('data', (data) => {
        logger.warn({ serviceId, data: data.toString() }, 'Service stderr');
      });

      proc.on('exit', (code, signal) => {
        logger.info({ serviceId, code, signal }, 'Service process exited');
        this.processes.delete(serviceId);
        
        // 更新runtime状态
        entry.runtime.status = 'stopped';
        entry.runtime.pid = null;
        entry.runtime.lastError = code !== 0 ? `Exited with code ${code}` : null;
      });

      proc.on('error', (error) => {
        logger.error({ serviceId, error }, '❌ Service process error');
        
        // 更新runtime状态
        entry.runtime.status = 'stopped';
        entry.runtime.lastError = error.message;
        
        throw error;
      });

      // 6. 更新runtime状态
      entry.runtime.status = 'running';
      entry.runtime.pid = proc.pid;
      entry.runtime.startTime = new Date();
      entry.runtime.lastError = null;

      logger.info({ serviceId, pid: proc.pid }, '✅ Service started successfully');

    } catch (error) {
      logger.error({ serviceId, error }, '❌ Failed to start service');
      
      // 更新runtime状态
      entry.runtime.status = 'stopped';
      entry.runtime.lastError = error instanceof Error ? error.message : 'Unknown error';
      
      throw error;
    }
  }

  async stop(serviceId: string): Promise<void> {
    const entry = this.registry.get(serviceId);
    if (!entry) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    const proc = this.processes.get(serviceId);
    if (!proc) {
      logger.warn({ serviceId }, 'Service process not found (already stopped?)');
      entry.runtime.status = 'stopped';
      entry.runtime.pid = null;
      return;
    }

    logger.info({ serviceId, pid: proc.pid }, '🛑 Stopping service');

    proc.kill('SIGTERM');

    // 等待最多5秒
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn({ serviceId }, 'Service did not stop gracefully, force killing');
        proc.kill('SIGKILL');
        resolve();
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.processes.delete(serviceId);
    entry.runtime.status = 'stopped';
    entry.runtime.pid = null;

    logger.info({ serviceId }, '✅ Service stopped');
  }

  getStatus(serviceId: string) {
    const entry = this.registry.get(serviceId);
    if (!entry) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    return {
      serviceId,
      status: entry.runtime.status,
      pid: entry.runtime.pid,
      port: entry.def.port,
      lastError: entry.runtime.lastError,
    };
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.processes.keys()).map(id => 
      this.stop(id).catch(err => 
        logger.error({ serviceId: id, error: err }, 'Failed to stop service')
      )
    );
    await Promise.all(promises);
  }
}
```

**要点**:
- ✅ 统一处理所有类型服务（Python、Rust、其他）
- ✅ 配置完全来自`service.json`
- ✅ 错误信息详细（serviceId + command + cwd + exit code）
- ✅ 不做防御性兜底，错误直接抛出

---

### Phase 2: 简化InferenceService（1天）

**目标**: InferenceService只管调用HTTP，不管服务启动

**改造前**:
```typescript
class InferenceService {
  constructor(
    modelManager,
    pythonServiceManager,     // ❌ 依赖旧Manager
    rustServiceManager,        // ❌ 依赖旧Manager
    serviceRegistryManager,    // ❌ 依赖旧接口
    // ...
  ) {
    this.taskRouter = new TaskRouter(
      pythonServiceManager,
      rustServiceManager,
      serviceRegistryManager
    );
  }
}
```

**改造后**:
```typescript
// 创建简单的endpoint resolver
class ServiceEndpointResolver {
  constructor(private registry: ServiceRegistry) {}

  resolve(capability: string): string | null {
    // 查找匹配的服务
    for (const entry of this.registry.values()) {
      if (entry.def.capabilities?.includes(capability) && 
          entry.runtime.status === 'running' &&
          entry.runtime.port) {
        return `http://localhost:${entry.runtime.port}`;
      }
    }
    return null;
  }
}

class InferenceService {
  constructor(
    modelManager: ModelManager,
    private endpointResolver: ServiceEndpointResolver
  ) {
    // 不再需要managers
  }

  async translate(text: string, sourceLang: string, targetLang: string) {
    const url = this.endpointResolver.resolve('nmt');
    if (!url) {
      throw new Error('NMT service not available');
    }

    // 直接HTTP调用
    const response = await fetch(`${url}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceLang, targetLang }),
    });

    if (!response.ok) {
      throw new Error(`NMT service error: ${response.status}`);
    }

    return response.json();
  }
}
```

**要点**:
- ✅ InferenceService不再管服务是否启动
- ✅ 通过`ServiceEndpointResolver`查询可用endpoint
- ✅ 服务不可用时直接抛错
- ✅ 易于mock测试

---

### Phase 3: 统一IPC Handlers（0.5天）

**目标**: 只保留一套handlers，不做防御性兜底

**删除**:
- ❌ `index.ts`中第125-314行的重复handlers
- ❌ `runtime-handlers-simple.ts`中的旧实现
- ❌ 所有防御性的"if (!manager) return default"逻辑

**保留**:
```typescript
// main/src/ipc-handlers/service-handlers.ts

import { ipcMain } from 'electron';
import { ServiceProcessRunner } from '../service-layer/ServiceProcessRunner';
import { ServiceRegistry } from '../service-layer/ServiceRegistry';
import logger from '../logger';

export function registerServiceHandlers(
  runner: ServiceProcessRunner,
  registry: ServiceRegistry
) {
  // 列出所有服务
  ipcMain.handle('services:list', async () => {
    try {
      return Array.from(registry.values()).map(entry => ({
        id: entry.def.id,
        name: entry.def.name,
        type: entry.def.type,
        status: entry.runtime.status,
        pid: entry.runtime.pid,
        port: entry.def.port,
        description: entry.def.description,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to list services');
      throw error; // 直接抛出，不包装
    }
  });

  // 启动服务
  ipcMain.handle('services:start', async (_event, serviceId: string) => {
    if (!serviceId) {
      throw new Error('serviceId is required');
    }

    logger.info({ serviceId }, 'IPC: Starting service');
    
    try {
      await runner.start(serviceId);
      return { success: true };
    } catch (error) {
      logger.error({ serviceId, error }, 'IPC: Failed to start service');
      throw error; // 直接抛出，前端会看到完整错误
    }
  });

  // 停止服务
  ipcMain.handle('services:stop', async (_event, serviceId: string) => {
    if (!serviceId) {
      throw new Error('serviceId is required');
    }

    logger.info({ serviceId }, 'IPC: Stopping service');

    try {
      await runner.stop(serviceId);
      return { success: true };
    } catch (error) {
      logger.error({ serviceId, error }, 'IPC: Failed to stop service');
      throw error;
    }
  });

  // 获取服务状态
  ipcMain.handle('services:status', async (_event, serviceId: string) => {
    if (!serviceId) {
      throw new Error('serviceId is required');
    }

    try {
      return runner.getStatus(serviceId);
    } catch (error) {
      logger.error({ serviceId, error }, 'IPC: Failed to get service status');
      throw error;
    }
  });

  logger.info({}, '✅ Service IPC handlers registered');
}
```

**要点**:
- ✅ 只有4个核心handlers
- ✅ 参数校验简单明确
- ✅ 错误直接抛出，不包装
- ✅ 前端能看到完整错误信息

---

### Phase 4: 更新app-init-simple.ts（0.5天）

**目标**: 移除所有兼容层，使用新架构

```typescript
export async function initializeServicesSimple(): Promise<ServiceManagers> {
  const managers: ServiceManagers = {
    nodeAgent: null,
    modelManager: null,
    inferenceService: null,
    serviceRunner: null, // 新增
  };

  // 1. 初始化服务层
  const servicesDir = initializeServicesDirectory();
  const { registry, supervisor } = await initServiceLayer(servicesDir);

  // 2. 创建统一的进程启动器
  managers.serviceRunner = new ServiceProcessRunner(registry);

  // 3. 创建endpoint resolver
  const endpointResolver = new ServiceEndpointResolver(registry);

  // 4. 初始化InferenceService（简化后）
  managers.modelManager = new ModelManager();
  managers.inferenceService = new InferenceService(
    managers.modelManager,
    endpointResolver  // ✅ 只传一个resolver
  );

  // 5. 初始化NodeAgent
  managers.nodeAgent = new NodeAgent(
    managers.inferenceService,
    managers.modelManager,
    () => registry,
    managers.serviceRunner
  );

  return managers;
}
```

**删除**:
- ❌ `legacyServiceRegistryManager`
- ❌ `PythonServiceManager`实例化
- ❌ `RustServiceManager`实例化
- ❌ 所有旧Manager的依赖

---

### Phase 5: 清理废弃代码（0.5天）

**删除文件**:
```
❌ main/src/python-service-manager/index.ts (旧实现)
❌ main/src/rust-service-manager/index.ts (旧实现)
❌ main/src/ipc-handlers/runtime-handlers-simple.ts (重复handlers)
❌ 任何包含 legacy/compat 的文件
```

**保留文件**:
```
✅ main/src/service-layer/ServiceRegistry.ts
✅ main/src/service-layer/ServiceSupervisor.ts
✅ main/src/service-layer/ServiceProcessRunner.ts (新)
✅ main/src/service-layer/ServiceEndpointResolver.ts (新)
✅ main/src/ipc-handlers/service-handlers.ts (统一)
```

---

## 🎯 极简清理Checklist

### 架构层面
- [ ] 删除所有`legacy*`/`*compat*`类和文件
- [ ] 删除旧的`PythonServiceManager`/`RustServiceManager`实现
- [ ] 新建`ServiceProcessRunner`，统一spawn/kill所有服务
- [ ] 新建`ServiceEndpointResolver`，简化InferenceService

### 配置层面
- [ ] 确认所有服务都只通过`services/*/service.json`配置
- [ ] 删掉所有硬编码的服务路径/端口/命令配置文件

### Inference层面
- [ ] InferenceService构造函数改为只依赖`endpointResolver`
- [ ] 全局搜索`serviceRegistryManager`，确保没有任何引用残留
- [ ] 删除TaskRouter对旧Manager的依赖

### IPC层面
- [ ] 只保留一份IPC handler文件，统一基于新架构
- [ ] 删除所有duplicate handler注册
- [ ] 出错直接抛异常，让错误暴露出来，不做多层包装兜底

### 调试体验
- [ ] 所有spawn失败都必须log出：
  - serviceId
  - command + args
  - cwd
  - exit code / error message
- [ ] 前端在服务启动失败时直接显示这些信息（哪怕很丑）

---

## 📊 改造前后对比

### 改造前
```
启动Python服务:
  UI → IPC handler (index.ts 第261行)
    → managers.pythonServiceManager (硬编码配置)
      → python-service-manager/index.ts (查硬编码配置)
        → spawn
          → ❌ 失败 (exit code: 1)
            → 错误被包装成 "Python service manager not initialized"
              → 前端只看到这个，查不到root cause
```

### 改造后
```
启动任何服务:
  UI → IPC handler (service-handlers.ts)
    → ServiceProcessRunner.start(serviceId)
      → ServiceRegistry.get(serviceId) → service.json
        → spawn(command, args, {cwd, env})
          → ❌ 失败 (exit code: 1)
            → 错误直接抛出，包含:
              - serviceId: "nmt-m2m100"
              - command: "python -m nmt_service"
              - cwd: "/path/to/services/nmt-m2m100"
              - error: "spawn python ENOENT"
              → 前端直接显示，立即定位问题！
```

---

## ⏱️ 时间估算

| Phase | 任务 | 时间 |
|-------|------|------|
| 1 | 创建ServiceProcessRunner | 0.5天 |
| 2 | 简化InferenceService | 1天 |
| 3 | 统一IPC Handlers | 0.5天 |
| 4 | 更新app-init-simple | 0.5天 |
| 5 | 清理废弃代码 | 0.5天 |
| **总计** | | **3天** |

测试时间: 0.5天  
**总时间: 3.5天** （比之前的4.5天更快）

---

## 🎉 预期结果

### 代码量
- 删除代码: ~2000行
- 新增代码: ~500行
- **净减少: ~1500行** ✅

### 调试体验
- 调用链长度: **减少50%**
- 配置来源: **1个**（service.json）
- 错误定位时间: **减少70%**

### 维护成本
- 需要理解的Manager: **1个**（ServiceProcessRunner）
- 代码重复: **0**
- 技术债务: **-90%**

---

## 🚨 风险说明

### 破坏性改动
⚠️ **这是一次破坏性改动，会删除大量旧代码**

但是：
- ✅ 没有线上用户
- ✅ 不需要兼容
- ✅ 新架构已充分测试
- ✅ 可以快速回滚（Git）

### 如果失败
1. `git revert`回到改造前
2. 分析失败原因
3. 调整方案
4. 重新尝试

**但根据当前情况，成功概率很高**

---

## 📞 下一步

**建议立即开始Phase 1**: 创建`ServiceProcessRunner`

理由：
1. 这是最独立的模块
2. 可以先测试这个模块
3. 验证成功后再继续后续phase

**需要决策**: 
- [ ] 批准这个激进方案
- [ ] 确定开始时间（建议：今天）
- [ ] 分配开发资源

---

**准备好就开始砍代码了！🔪**
