# GPU 仲裁器文档

## 概述

GPU 仲裁器（GpuArbiter）提供统一的 GPU 资源租约接口，避免多服务同时抢占 GPU，解决 P95 延迟长尾、OOM、偶发失败、抖动等问题。

## 核心功能

### 1. 资源管理
- **互斥锁机制**：确保同一 GPU 同时只有一个任务在使用
- **优先级队列**：按任务优先级排队等待
- **队列限制**：防止队列无限增长
- **超时处理**：避免任务长时间等待

### 2. 任务优先级
- **ASR** (priority=90)：最高优先级，优先获取 GPU
- **NMT** (priority=80)：高优先级，在 ASR 之后
- **TTS** (priority=70)：中等优先级
- **Semantic Repair** (priority=20)：低优先级，可跳过

### 3. 忙时降级策略
- **WAIT**：等待 GPU 空闲
- **SKIP**：跳过任务（适用于 Semantic Repair）
- **FALLBACK_CPU**：回退到 CPU 执行

### 4. GPU 使用率监控
- **后台采样**：周期采样 GPU 使用率（500-1000ms）
- **缓存机制**：acquire 只读取缓存，不阻塞
- **滞回线控制**：高水位/低水位控制 admission
- **动态调整**：根据任务规模（如长音频）动态调整阈值

### 5. 可观测性
- 记录 GPU 租约的获取和释放
- 记录等待时间和占用时间
- 记录队列状态和超时情况
- 提供指标统计（等待时间、占用时间、丢弃率、超时率）

## 模块化架构

GPU 仲裁器已拆分为以下模块：

1. **GpuArbiter**：主仲裁器，协调各模块
2. **GpuUsageMonitor**：GPU 使用率监控
3. **GpuArbiterQueueManager**：队列管理
4. **GpuArbiterMetricsManager**：指标统计

## 配置

在 `electron-node-config.json` 中配置：

```json
{
  "gpuArbiter": {
    "enabled": true,
    "gpuKeys": ["gpu:0"],
    "gpuUsageThreshold": 85.0,
    "gpuUsage": {
      "sampleIntervalMs": 800,
      "cacheTtlMs": 2000,
      "baseHighWater": 85,
      "baseLowWater": 78,
      "dynamicAdjustment": {
        "enabled": true,
        "longAudioThresholdMs": 8000,
        "highWaterBoost": 7,
        "lowWaterBoost": 7,
        "adjustmentTtlMs": 15000
      }
    },
    "defaultQueueLimit": 8,
    "defaultHoldMaxMs": 8000,
    "tasks": {
      "ASR": {
        "priority": 90,
        "maxWaitMs": 30000,
        "queueLimit": 8,
        "busyPolicy": "WAIT"
      },
      "NMT": {
        "priority": 80,
        "maxWaitMs": 30000,
        "queueLimit": 8,
        "busyPolicy": "WAIT"
      },
      "TTS": {
        "priority": 70,
        "maxWaitMs": 30000,
        "queueLimit": 8,
        "busyPolicy": "WAIT"
      },
      "SEMANTIC_REPAIR": {
        "priority": 20,
        "maxWaitMs": 5000,
        "queueLimit": 4,
        "busyPolicy": "SKIP"
      }
    }
  }
}
```

## 使用方式

### 基本用法

```typescript
import { withGpuLease } from '../gpu-arbiter';

// 使用 GPU 租约执行任务
const result = await withGpuLease(
  'ASR',
  async (lease) => {
    // 执行 GPU 任务
    return await taskRouter.routeASRTask(asrTask);
  },
  {
    jobId: job.job_id,
    sessionId: job.session_id,
    utteranceIndex: job.utterance_index,
    stage: 'ASR',
  }
);
```

### 顺序执行集成

GPU 仲裁器与顺序执行管理器（SequentialExecutor）配合使用，确保：
- GPU 资源按优先级分配
- 任务按 utterance_index 顺序执行
- 避免并发导致的 context_text 错误

## 日志记录

### 关键日志点

1. **租约获取**：`GpuArbiter: Lease acquired immediately` 或 `GpuArbiter: Request dequeued and acquired`
2. **租约释放**：`GpuArbiter: Lease released`
3. **忙时降级**：`GpuArbiter: GPU busy, skipping (SKIP policy)`
4. **队列满**：`GpuArbiter: Queue full`
5. **请求超时**：`GpuArbiter: Request timeout in queue`

### 日志查询

```bash
# 查询特定 job 的所有 GPU 操作
grep "job_123" logfile.log | grep "GpuArbiter"

# 查询特定服务的 GPU 使用
grep "taskType.*ASR" logfile.log | grep "GpuArbiter"

# 查询被跳过的任务
grep "GPU busy, skipping" logfile.log
```

## GPU 使用率控制

### 滞回线机制

- **高水位（High Water）**：默认 85%，超过时拒绝新任务
- **低水位（Low Water）**：默认 78%，低于时恢复正常
- **动态调整**：ASR 收到长音频时，自动提高阈值（+7%）

### 采样机制

- **采样周期**：800ms（可配置）
- **缓存 TTL**：2000ms（可配置）
- **后台线程**：不阻塞 acquire 热路径

## 限制与注意事项

1. **不保证任务顺序**：GPU 仲裁器只管理 GPU 资源，不关心 utterance_index 顺序
2. **顺序保证**：需要配合 SequentialExecutor 使用
3. **单机范围**：仅适用于单机多服务场景，不支持跨机器调度
4. **性能影响**：日志记录对性能影响很小，但大量日志可能影响磁盘 I/O

## 相关文档

- `SEQUENTIAL_EXECUTION_IMPLEMENTATION.md`：顺序执行管理器
- `GPU_USAGE_THRESHOLD_CONTROL_PROPOSAL_v1.1.md`：GPU 使用率控制详细方案
