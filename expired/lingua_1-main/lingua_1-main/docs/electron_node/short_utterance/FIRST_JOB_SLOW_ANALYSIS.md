# 第一次任务慢或被丢弃问题分析

## 问题描述

节点端启动后的第一次任务（第一句话）总是返回得非常慢，或者被直接丢弃。

## 可能的原因

### 1. 服务端点初始化是异步的，且错误被静默捕获

在 `inference-service.ts` 第81-83行：

```typescript
// 异步初始化服务端点
this.taskRouter.initialize().catch((error) => {
  logger.error({ error }, 'Failed to initialize TaskRouter');
});
```

**问题**：
- `initialize()` 是异步的，但错误被捕获了
- 如果初始化失败，第一次任务时可能没有可用的服务端点
- 第一次任务时，`refreshServiceEndpoints()` 可能找不到运行中的服务

### 2. 每次任务前都刷新服务端点，第一次可能服务还没启动

在 `inference-service.ts` 第181行：

```typescript
// 刷新服务端点列表（确保使用最新的服务状态）
await this.taskRouter.refreshServiceEndpoints();
```

**问题**：
- 第一次任务时，服务可能还在启动中
- `refreshServiceEndpoints()` 只选择 `status === 'running'` 的服务
- 如果服务还没完全启动，可能找不到可用的服务端点

### 3. 服务启动是异步的，第一次任务时可能服务还没就绪

**问题**：
- 服务启动需要时间（加载模型、初始化等）
- 第一次任务时，服务可能还在启动过程中
- 即使服务进程已启动，服务可能还没准备好处理请求

### 4. 没有等待服务就绪的机制

**问题**：
- `refreshServiceEndpoints()` 只检查服务状态，不检查服务是否真正就绪
- 没有健康检查或就绪检查机制
- 第一次任务可能发送到还没准备好的服务

## 修复方案

### 方案1：等待服务就绪后再处理第一次任务（推荐）

在 `InferenceService.processJob` 中，如果是第一次任务，等待服务就绪：

```typescript
async processJob(job: JobAssignMessage, partialCallback?: PartialResultCallback): Promise<JobResult> {
  const wasFirstJob = this.currentJobs.size === 0;
  this.currentJobs.add(job.job_id);
  
  // 如果是第一个任务，等待服务就绪
  if (wasFirstJob) {
    await this.waitForServicesReady();
  }
  
  // 刷新服务端点列表
  await this.taskRouter.refreshServiceEndpoints();
  
  // ... 处理任务
}

private async waitForServicesReady(maxWaitMs: number = 10000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await this.taskRouter.refreshServiceEndpoints();
    const asrEndpoints = this.taskRouter.getServiceEndpoints('asr');
    const nmtEndpoints = this.taskRouter.getServiceEndpoints('nmt');
    const ttsEndpoints = this.taskRouter.getServiceEndpoints('tts');
    
    if (asrEndpoints.length > 0 && nmtEndpoints.length > 0 && ttsEndpoints.length > 0) {
      // 检查服务是否真正就绪（健康检查）
      const allReady = await Promise.all([
        this.checkServiceHealth(asrEndpoints[0]),
        this.checkServiceHealth(nmtEndpoints[0]),
        this.checkServiceHealth(ttsEndpoints[0]),
      ]);
      
      if (allReady.every(ready => ready)) {
        logger.info({}, 'All services are ready');
        return;
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 500)); // 等待500ms后重试
  }
  
  logger.warn({}, 'Services not ready after timeout, proceeding anyway');
}
```

### 方案2：确保初始化完成后再接受任务

在 `InferenceService` 构造函数中，等待初始化完成：

```typescript
constructor(...) {
  // ...
  this.taskRouter = new TaskRouter(...);
  
  // 同步等待初始化完成（在构造函数中）
  this.initializationPromise = this.taskRouter.initialize();
}

async processJob(...): Promise<JobResult> {
  // 等待初始化完成
  await this.initializationPromise;
  
  // 刷新服务端点列表
  await this.taskRouter.refreshServiceEndpoints();
  
  // ... 处理任务
}
```

### 方案3：在服务端点刷新时添加重试机制

在 `refreshServiceEndpoints()` 中添加重试逻辑：

```typescript
async refreshServiceEndpoints(maxRetries: number = 3): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // ... 刷新逻辑
      const runningServices = installedServices.filter(s => s.status === 'running');
      if (runningServices.length > 0) {
        // 至少有一个服务在运行，可以继续
        break;
      }
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒后重试
    }
  }
}
```

### 方案4：添加服务健康检查

在路由任务前，检查服务是否真正就绪：

```typescript
async routeASRTask(task: ASRTask): Promise<ASRResult> {
  const endpoint = this.selectServiceEndpoint(ServiceType.ASR);
  if (!endpoint) {
    throw new Error('No available ASR service');
  }
  
  // 检查服务是否真正就绪
  const isReady = await this.checkServiceHealth(endpoint);
  if (!isReady) {
    // 刷新服务端点，重试
    await this.refreshServiceEndpoints();
    const newEndpoint = this.selectServiceEndpoint(ServiceType.ASR);
    if (!newEndpoint) {
      throw new Error('No available ASR service after refresh');
    }
    return this.routeASRTaskToEndpoint(task, newEndpoint);
  }
  
  // ... 处理任务
}

private async checkServiceHealth(endpoint: ServiceEndpoint): Promise<boolean> {
  try {
    const response = await axios.get(`${endpoint.baseUrl}/health`, { timeout: 2000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}
```

## 推荐修复

**立即修复**：方案1 + 方案4

1. 在第一次任务时，等待服务就绪
2. 添加服务健康检查，确保服务真正可用
3. 如果服务未就绪，等待并重试（最多10秒）

这样可以：
- 确保第一次任务时服务已就绪
- 避免任务被发送到未准备好的服务
- 提高第一次任务的成功率

## 验证方法

1. **检查日志**：
   - 查看是否有"Failed to initialize TaskRouter"的错误
   - 查看是否有"No available ASR service"的错误
   - 查看第一次任务的处理时间

2. **监控服务状态**：
   - 查看服务启动时间
   - 查看服务就绪时间
   - 查看第一次任务的处理时间

3. **测试**：
   - 启动节点后立即发送第一个任务
   - 确认任务是否被处理
   - 确认任务处理时间是否正常

