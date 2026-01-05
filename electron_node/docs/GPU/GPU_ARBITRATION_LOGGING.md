# GPU仲裁器日志记录说明

## 概述

GPU仲裁器已经添加了完整的日志记录功能，可以追踪job分配到每个服务（ASR、NMT、TTS、Semantic Repair）的完整过程。

## 日志记录点

### 1. 初始化日志

**触发时机**: GPU仲裁器初始化时

**日志内容**:
```
GpuArbiter initialized: enabled=true, gpuKeys=["gpu:0"], defaultQueueLimit=8, defaultHoldMaxMs=8000
```

**日志级别**: `info`

### 2. 租约获取日志

#### 2.1 立即获取（GPU空闲）

**触发时机**: GPU空闲时，任务立即获取租约

**日志内容**:
```json
{
  "gpuKey": "gpu:0",
  "taskType": "ASR",
  "leaseId": "lease_xxx",
  "jobId": "job_123",
  "sessionId": "session_456",
  "utteranceIndex": 0,
  "stage": "ASR"
}
```

**日志消息**: `GpuArbiter: Lease acquired immediately`

**日志级别**: `info`

#### 2.2 队列等待后获取

**触发时机**: GPU忙碌时，任务在队列中等待后获取租约

**日志内容**:
```json
{
  "gpuKey": "gpu:0",
  "taskType": "NMT",
  "leaseId": "lease_xxx",
  "queueWaitMs": 1234,
  "jobId": "job_123",
  "sessionId": "session_456",
  "utteranceIndex": 0,
  "stage": "NMT"
}
```

**日志消息**: `GpuArbiter: Request dequeued and acquired`

**日志级别**: `info`

### 3. 租约释放日志

**触发时机**: 任务完成，释放GPU租约

**日志内容**:
```json
{
  "gpuKey": "gpu:0",
  "taskType": "ASR",
  "leaseId": "lease_xxx",
  "holdMs": 2345,
  "jobId": "job_123",
  "sessionId": "session_456",
  "utteranceIndex": 0,
  "stage": "ASR"
}
```

**日志消息**: `GpuArbiter: Lease released`

**日志级别**: `debug`

### 4. 忙时降级日志

#### 4.1 SKIP策略

**触发时机**: GPU忙碌时，低优先级任务被跳过

**日志内容**:
```json
{
  "gpuKey": "gpu:0",
  "taskType": "SEMANTIC_REPAIR",
  "jobId": "job_123",
  "sessionId": "session_456",
  "utteranceIndex": 0,
  "stage": "SemanticRepair"
}
```

**日志消息**: `GpuArbiter: GPU busy, skipping (SKIP policy)`

**日志级别**: `debug`

#### 4.2 FALLBACK_CPU策略

**触发时机**: GPU忙碌时，任务回退到CPU

**日志内容**:
```json
{
  "gpuKey": "gpu:0",
  "taskType": "SEMANTIC_REPAIR",
  "jobId": "job_123",
  "sessionId": "session_456",
  "utteranceIndex": 0,
  "stage": "SemanticRepair"
}
```

**日志消息**: `GpuArbiter: GPU busy, falling back to CPU (FALLBACK_CPU policy)`

**日志级别**: `debug`

### 5. 队列管理日志

#### 5.1 队列满

**触发时机**: 队列达到上限

**日志内容**:
```json
{
  "gpuKey": "gpu:0",
  "taskType": "NMT",
  "queueLength": 8,
  "queueLimit": 8,
  "jobId": "job_123",
  "sessionId": "session_456",
  "utteranceIndex": 0,
  "stage": "NMT"
}
```

**日志消息**: `GpuArbiter: Queue full`

**日志级别**: `warn`

#### 5.2 请求超时

**触发时机**: 请求在队列中等待超时

**日志内容**:
```json
{
  "gpuKey": "gpu:0",
  "taskType": "NMT",
  "leaseId": "lease_xxx",
  "waitTimeMs": 3000,
  "maxWaitMs": 3000,
  "jobId": "job_123",
  "sessionId": "session_456",
  "utteranceIndex": 0,
  "stage": "NMT"
}
```

**日志消息**: `GpuArbiter: Request timeout in queue`

**日志级别**: `warn`

### 6. Watchdog日志

**触发时机**: 租约持有时间超过holdMaxMs

**日志内容**:
```json
{
  "gpuKey": "gpu:0",
  "taskType": "ASR",
  "leaseId": "lease_xxx",
  "holdTimeMs": 9000,
  "holdMaxMs": 8000,
  "jobId": "job_123",
  "sessionId": "session_456",
  "utteranceIndex": 0,
  "stage": "ASR"
}
```

**日志消息**: `GpuArbiter: Lease hold time exceeded holdMaxMs (watchdog)`

**日志级别**: `warn`

## Trace信息

所有日志都包含完整的trace信息，用于追踪job到服务的分配过程：

- `jobId`: 任务ID
- `sessionId`: 会话ID
- `utteranceIndex`: 话语索引
- `stage`: 处理阶段（ASR/NMT/TTS/SemanticRepair）

## 日志查询示例

### 查询特定job的所有GPU操作

```bash
# 在日志中搜索特定jobId
grep "job_123" logfile.log | grep "GpuArbiter"
```

### 查询特定服务的GPU使用情况

```bash
# 查询ASR服务的GPU使用
grep "taskType.*ASR" logfile.log | grep "GpuArbiter"
```

### 查询租约获取和释放

```bash
# 查询所有租约获取
grep "Lease acquired" logfile.log

# 查询所有租约释放
grep "Lease released" logfile.log
```

### 查询忙时降级

```bash
# 查询被跳过的任务
grep "GPU busy, skipping" logfile.log
```

## 日志级别说明

- **info**: 关键操作（租约获取、队列出队）
- **debug**: 详细信息（租约释放、忙时降级）
- **warn**: 警告信息（队列满、超时、watchdog）
- **error**: 错误信息（无效GPU key）

## 完整追踪示例

一个完整的job处理流程的日志示例：

```
[INFO] GpuArbiter: Lease acquired immediately {taskType: "ASR", jobId: "job_123", sessionId: "session_456", utteranceIndex: 0, stage: "ASR"}
[INFO] GpuArbiter: Request dequeued and acquired {taskType: "NMT", jobId: "job_123", sessionId: "session_456", utteranceIndex: 0, stage: "NMT", queueWaitMs: 500}
[DEBUG] GpuArbiter: GPU busy, skipping (SKIP policy) {taskType: "SEMANTIC_REPAIR", jobId: "job_123", sessionId: "session_456", utteranceIndex: 0, stage: "SemanticRepair"}
[DEBUG] GpuArbiter: Lease released {taskType: "ASR", jobId: "job_123", sessionId: "session_456", utteranceIndex: 0, stage: "ASR", holdMs: 2345}
[DEBUG] GpuArbiter: Lease released {taskType: "NMT", jobId: "job_123", sessionId: "session_456", utteranceIndex: 0, stage: "NMT", holdMs: 1890}
```

通过这些日志，可以完整追踪：
1. 哪个job在哪个阶段获取了GPU租约
2. 任务在队列中等待了多长时间
3. 哪些任务被跳过（忙时降级）
4. 每个任务占用GPU多长时间
5. 任务完成的顺序

## 注意事项

1. **日志级别**: 确保日志级别设置为`debug`或更低，才能看到所有详细信息
2. **性能影响**: 日志记录对性能影响很小，但大量日志可能影响磁盘I/O
3. **日志轮转**: 建议配置日志轮转，避免日志文件过大
