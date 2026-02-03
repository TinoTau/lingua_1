# 服务热插拔机制说明

## 1. 当前实现机制

### 1.1 服务热插拔的实现位置

**重要澄清**：服务热插拔**不是**由 `node-inference` 实现的，而是由 **NodeAgent** 实现的。

**实现层次**：
```
NodeAgent (Electron)
    ├─ PythonServiceManager → 管理 Python 服务的启动/停止
    ├─ RustServiceManager → 管理 Rust 服务的启动/停止
    └─ 服务状态变化监听 → 触发心跳更新
```

### 1.2 热插拔流程

#### 服务启动流程

1. **NodeAgent 接收任务**：
   ```typescript
   // node-agent.ts:698
   private async handleJob(job: JobAssignMessage): Promise<void> {
     // 根据 features 启动所需的服务
     if (job.features?.speaker_identification && this.pythonServiceManager) {
       await this.pythonServiceManager.startService('speaker_embedding');
     }
   }
   ```

2. **PythonServiceManager 启动服务**：
   ```typescript
   // python-service-manager/index.ts:109
   async startService(serviceName: PythonServiceName): Promise<void> {
     // 1. 获取服务配置
     const config = await this.getServiceConfig(serviceName);
     
     // 2. 启动服务进程
     const process = await startServiceProcess(serviceName, config, {...});
     
     // 3. 等待服务就绪
     await waitForServiceReadyWithProcessCheck(config.port, process, serviceName);
     
     // 4. 更新状态
     this.updateStatus(serviceName, {
       running: true,
       starting: false,
       pid: process.pid,
       port: config.port,
       startedAt: new Date(),
     });
   }
   ```

3. **状态变化触发心跳更新**：
   ```typescript
   // python-service-manager/index.ts:404
   private updateStatus(serviceName: string, status: Partial<PythonServiceStatus>): void {
     // 检查 running 状态是否发生变化
     const previousRunning = current?.running ?? false;
     const newRunning = status.running ?? false;
     
     // 如果状态变化，触发回调
     if (previousRunning !== newRunning && this.onStatusChangeCallback) {
       this.onStatusChangeCallback(serviceName, mergedStatus);
     }
   }
   ```

4. **NodeAgent 接收回调并触发心跳**：
   ```typescript
   // node-agent.ts:120
   if (this.pythonServiceManager && typeof this.pythonServiceManager.setOnStatusChangeCallback === 'function') {
     this.pythonServiceManager.setOnStatusChangeCallback((serviceName: string, status: any) => {
       // 服务状态变化时，立即触发心跳（带防抖）
       logger.debug({ serviceName, running: status.running }, 'Python service status changed, triggering immediate heartbeat');
       this.triggerImmediateHeartbeat();
     });
   }
   ```

5. **心跳更新调度服务器**：
   ```typescript
   // node-agent.ts:triggerImmediateHeartbeat()
   private triggerImmediateHeartbeat(): void {
     // 防抖处理
     if (this.heartbeatDebounceTimer) {
       clearTimeout(this.heartbeatDebounceTimer);
     }
     
     this.heartbeatDebounceTimer = setTimeout(() => {
       this.sendHeartbeatOnce().catch(error => {
         logger.error({ error }, 'Failed to send immediate heartbeat');
       });
     }, this.HEARTBEAT_DEBOUNCE_MS);
   }
   ```

### 1.3 node-inference 的作用

**重要澄清**：`node-inference` **不负责**服务热插拔，它只是一个**聚合服务**，用于：

1. **接收任务请求**：从 NodeAgent 接收完整的翻译任务
2. **协调各个 Python 服务**：按顺序调用 ASR → NMT → TTS
3. **处理中间逻辑**：VAD、音频编解码、语言检测、上下文管理等
4. **返回最终结果**：将各个服务的结果组合成最终输出

**关键点**：
- `node-inference` 本身不管理服务的启动/停止
- 它只是**使用**已经运行的服务
- 如果 `node-inference` 不运行，即使所有 Python 服务都运行，也无法处理任务

## 2. 当前架构的问题

### 2.1 单点依赖问题

虽然服务热插拔是在 NodeAgent 中实现的，但**任务处理**仍然依赖 `node-inference`：

```
任务处理流程：
NodeAgent → node-inference (必须运行) → Python 服务

服务热插拔流程：
NodeAgent → PythonServiceManager → Python 服务（独立管理）
```

**问题**：
- 服务可以独立启动/停止（热插拔能力存在）
- 但任务必须通过 `node-inference` 处理（单点依赖）
- 如果 `node-inference` 不运行，即使服务都运行，也无法处理任务

### 2.2 热插拔能力受限

**当前限制**：
- Python 服务可以热插拔（启动/停止）
- 但任务处理仍然依赖 `node-inference`
- 无法实现真正的"服务独立运行，通过接口传递具体任务"

## 3. 改造后的热插拔机制

### 3.1 方案 A/B/C 对热插拔的影响

**重要结论**：**拆分或移除 `node-inference` 不会影响服务热插拔，反而会增强热插拔能力**。

#### 原因分析

1. **服务热插拔机制保持不变**：
   - `PythonServiceManager` 和 `RustServiceManager` 仍然在 NodeAgent 中
   - 服务启动/停止逻辑不变
   - 状态变化监听机制不变
   - 心跳更新机制不变

2. **任务处理流程改变**：
   ```
   改造前：
   NodeAgent → node-inference → Python 服务
   
   改造后（方案 A/B/C）：
   NodeAgent → Python 服务（直接调用）
   ```

3. **热插拔能力增强**：
   - 不再依赖 `node-inference` 这个单点
   - 服务可以真正独立运行
   - 任务可以直接路由到对应服务
   - 支持服务级别的负载均衡和故障转移

### 3.2 改造后的热插拔流程

#### 服务启动流程（不变）

1. NodeAgent 接收任务或用户操作
2. PythonServiceManager 启动服务
3. 服务状态变化触发回调
4. NodeAgent 触发心跳更新
5. 调度服务器收到服务状态更新

#### 任务处理流程（改变）

**改造前**：
```typescript
// NodeAgent
const result = await this.inferenceService.processJob(job);
  ↓
// InferenceService
const response = await this.httpClient.post('http://localhost:5009/v1/inference', request);
  ↓
// node-inference
调用 faster-whisper-vad → 调用 nmt-m2m100 → 调用 piper-tts
```

**改造后（方案 A/B/C）**：
```typescript
// NodeAgent
const result = await this.pipelineOrchestrator.processJob(job);
  ↓
// PipelineOrchestrator
const asrResult = await this.asrService.transcribe(...);  // 直接调用 faster-whisper-vad
const nmtResult = await this.nmtService.translate(...);  // 直接调用 nmt-m2m100
const ttsResult = await this.ttsService.synthesize(...); // 直接调用 piper-tts
```

### 3.3 热插拔能力对比

| 能力 | 改造前 | 改造后（方案 A/B/C） |
|------|--------|---------------------|
| **服务启动/停止** | ✅ 支持 | ✅ 支持（不变） |
| **状态变化通知** | ✅ 支持 | ✅ 支持（不变） |
| **心跳更新** | ✅ 支持 | ✅ 支持（不变） |
| **任务路由到服务** | ❌ 必须通过 node-inference | ✅ 直接路由 |
| **服务独立运行** | ⚠️ 部分支持（服务可独立，但任务处理依赖 node-inference） | ✅ 完全支持 |
| **服务级别负载均衡** | ❌ 不支持 | ✅ 支持 |
| **服务级别故障转移** | ❌ 不支持 | ✅ 支持 |

## 4. 具体实现示例

### 4.1 改造后的服务热插拔

```typescript
// NodeAgent 中的服务管理（改造后）
class NodeAgent {
  private serviceManager: ServiceManager;
  private pipelineOrchestrator: PipelineOrchestrator;
  
  async handleJob(job: JobAssignMessage): Promise<void> {
    // 1. 根据任务需求启动服务（热插拔能力保持不变）
    if (job.features?.speaker_identification) {
      await this.pythonServiceManager.startService('speaker_embedding');
    }
    
    // 2. 直接调用服务处理任务（不再通过 node-inference）
    const result = await this.pipelineOrchestrator.processJob(job);
    
    // 3. 发送结果
    this.sendJobResult(result);
  }
}
```

### 4.2 服务选择与故障转移

```typescript
// PipelineOrchestrator 中的服务选择
class PipelineOrchestrator {
  async processJob(job: JobAssignMessage): Promise<JobResult> {
    // ASR 服务选择（支持热插拔和故障转移）
    let asrResult: ASRResult;
    const asrServices = this.serviceManager.getAvailableServices(ServiceType.ASR);
    
    for (const service of asrServices) {
      try {
        asrResult = await this.callASRService(service, job);
        break; // 成功则跳出循环
      } catch (error) {
        logger.warn({ service: service.id, error }, 'ASR service failed, trying next');
        continue; // 失败则尝试下一个服务
      }
    }
    
    if (!asrResult) {
      throw new Error('No available ASR service');
    }
    
    // NMT 和 TTS 类似...
  }
}
```

## 5. 总结

### 5.1 关键结论

1. **服务热插拔不是由 `node-inference` 实现的**：
   - 热插拔是在 `NodeAgent` 中实现的
   - 通过 `PythonServiceManager` 和 `RustServiceManager` 管理
   - `node-inference` 只是使用这些服务，不管理它们

2. **拆分或移除 `node-inference` 不会影响热插拔**：
   - 服务管理机制保持不变
   - 状态变化监听机制保持不变
   - 心跳更新机制保持不变

3. **反而会增强热插拔能力**：
   - 不再依赖 `node-inference` 这个单点
   - 任务可以直接路由到服务
   - 支持服务级别的负载均衡和故障转移
   - 实现真正的服务独立性

### 5.2 改造建议

**推荐采用方案 A 或 B**：
- 保持服务热插拔能力（不变）
- 增强任务处理能力（直接路由）
- 实现真正的服务独立性
- 工作量适中，风险可控

**方案 C 也可以考虑**：
- 完全移除 `node-inference`
- 所有功能迁移到 NodeAgent
- 工作量较大，但架构最简洁

**无论采用哪个方案，服务热插拔能力都不会受到影响，反而会得到增强。**

