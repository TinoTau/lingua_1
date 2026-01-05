# 顺序执行实现文档

## 概述

为了确保翻译结果的正确性和连贯性，我们实现了**顺序执行管理器（SequentialExecutor）**，确保每个服务（ASR、NMT、TTS、Semantic Repair）按`utterance_index`顺序执行。

## 问题背景

在集成测试中发现，`job3`和`job4`应该是连接在一起的一句话，但被分开翻译了，导致翻译结果不连贯。这是因为：

1. **NMT并发执行**：`job3`和`job4`的NMT任务可能同时执行
2. **context_text错误**：`job4`在`job3`完成前获取了`context_text`（可能是`job2`的），导致翻译结果不连贯
3. **顺序保证缺失**：没有机制确保NMT按`utterance_index`顺序执行

## 解决方案

### 1. SequentialExecutor核心功能

`SequentialExecutor`确保每个服务按`utterance_index`严格顺序执行：

- **按顺序执行**：只有当前索引的任务完成后，才会执行下一个索引的任务
- **等待队列**：如果任务索引不连续，会加入等待队列，等待前面的任务完成
- **超时保护**：避免死锁，超时后拒绝任务
- **每个session独立**：不同session的任务互不影响

### 2. 实现位置

顺序执行管理器已集成到以下服务：

1. **ASR** (`PipelineOrchestratorASRHandler.processASROnly`)
2. **NMT** (`TranslationStage.process`)
3. **TTS** (`TTSStage.process`)
4. **Semantic Repair** (`SemanticRepairStageZH.process`)

### 3. 配置

在`electron-node-config.json`中可以配置顺序执行管理器：

```json
{
  "sequentialExecutor": {
    "enabled": true,
    "maxWaitMs": 30000,
    "timeoutCheckIntervalMs": 5000
  }
}
```

- `enabled`: 是否启用顺序执行（默认`true`）
- `maxWaitMs`: 最大等待时间，超时后拒绝任务（默认30000ms）
- `timeoutCheckIntervalMs`: 超时检查间隔（默认5000ms）

## Job合并情况处理

### 问题

如果多个job被合并（例如`job3`和`job4`合并成一个utterance），如何确认顺序？

### 解决方案

**关键点**：合并后的job使用**合并后的`utterance_index`**。

#### 1. 合并逻辑

当多个job被合并时：
- 合并后的job使用**最后一个job的`utterance_index`**
- 例如：`job3`（index=3）和`job4`（index=4）合并后，使用`index=4`

#### 2. 顺序保证

顺序执行管理器确保：
- 如果`job3`和`job4`被合并，合并后的job使用`index=4`
- 只有当`index=3`的任务完成后，才会执行`index=4`的任务
- 如果`index=4`的任务先到达，会加入等待队列，等待`index=3`完成

#### 3. 示例

假设有以下job序列：

```
job0 (index=0) -> job1 (index=1) -> job2 (index=2) -> job3 (index=3) -> job4 (index=4)
```

如果`job3`和`job4`被合并：
- 合并后的job使用`index=4`
- 顺序执行管理器确保：
  1. `index=0`完成后执行`index=1`
  2. `index=1`完成后执行`index=2`
  3. `index=2`完成后执行`index=3`
  4. `index=3`完成后执行`index=4`（合并后的job）

### 4. 验证合并后的顺序

要验证合并后的job是否按正确顺序执行，可以：

1. **检查日志**：
   - 搜索 `SequentialExecutor: Starting task execution` - 应该看到按顺序执行的任务
   - 搜索 `SequentialExecutor: Task enqueued` - 应该看到等待的任务

2. **检查utterance_index**：
   - 确认合并后的job使用正确的`utterance_index`
   - 确认顺序执行管理器按`utterance_index`顺序处理

3. **检查context_text**：
   - 确认NMT的`context_text`总是获取到正确的上一个utterance
   - 确认翻译结果连贯

## 实现细节

### 1. SequentialExecutor类

```typescript
class SequentialExecutor {
  // 按utterance_index顺序执行任务
  async execute<T>(
    sessionId: string,
    utteranceIndex: number,
    taskType: ServiceType,
    execute: () => Promise<T>,
    jobId?: string
  ): Promise<T>
}
```

### 2. 使用示例

```typescript
// 在TranslationStage中
const sequentialExecutor = getSequentialExecutor();
const sessionId = job.session_id || '';
const utteranceIndex = job.utterance_index || 0;

const result = await sequentialExecutor.execute(
  sessionId,
  utteranceIndex,
  'NMT',
  async () => {
    // 实际的NMT调用
    return await this.executeNMT(job, aggregatedText, contextText, startTime);
  },
  job.job_id
);
```

### 3. 状态管理

`SequentialExecutor`为每个session维护：
- `currentIndex`: 当前处理的`utterance_index`
- `waitingQueue`: 等待队列（按`utterance_index`排序）
- `processing`: 当前正在处理的任务

### 4. 顺序保证机制

1. **立即执行**：如果当前索引 < 新任务索引，立即执行
2. **加入队列**：如果当前索引 >= 新任务索引，加入等待队列
3. **处理下一个**：任务完成后，检查等待队列，如果下一个任务的索引是当前索引+1，执行它

## 测试

### 1. 单元测试

顺序执行管理器的单元测试位于：
- `electron_node/electron-node/main/src/sequential-executor/sequential-executor.test.ts`

### 2. 集成测试

集成测试步骤：

1. **启用顺序执行**：
   ```json
   {
     "sequentialExecutor": {
       "enabled": true
     }
   }
   ```

2. **运行测试**：
   - 发送多个job（例如job3和job4）
   - 检查日志确认按顺序执行
   - 检查翻译结果是否连贯

3. **验证合并**：
   - 如果job3和job4被合并，确认合并后的job使用正确的`utterance_index`
   - 确认顺序执行管理器按顺序处理

## 性能影响

### 1. 延迟

顺序执行会增加延迟：
- **等待时间**：如果前面的任务未完成，需要等待
- **队列时间**：如果任务索引不连续，需要等待前面的任务完成

### 2. 优化

- **超时保护**：避免死锁，超时后拒绝任务
- **并发优化**：虽然顺序执行，但不同session的任务可以并发执行

## 总结

顺序执行管理器确保了：
1. ✅ 每个服务按`utterance_index`顺序执行
2. ✅ 合并后的job使用正确的`utterance_index`
3. ✅ `context_text`总是获取到正确的上一个utterance
4. ✅ 翻译结果连贯，避免job3和job4分开翻译的问题

## 相关文档

- [GPU仲裁器作用总结](./GPU_ARBITER_ROLE_SUMMARY.md)
- [GPU仲裁实现文档](./GPU_ARBITRATION_IMPLEMENTATION.md)
