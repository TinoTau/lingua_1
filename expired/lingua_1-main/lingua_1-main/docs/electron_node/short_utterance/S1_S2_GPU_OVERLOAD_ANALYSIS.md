# S1/S2导致的GPU过载问题分析

## 问题描述

用户反馈：之前异步并发任务功能没有出问题，问题是在实现S1/S2之后才出现的。重启节点端后，还是没有找到可用节点。

## S1/S2新增的功能

### 1. SecondaryDecodeWorker（二次解码）

- **初始化**：在`AggregatorMiddleware`构造函数中初始化（不占用GPU）
- **使用时机**：在处理任务时，如果需要rescoring，会调用`secondaryDecodeWorker.decode()`
- **GPU占用**：调用`routeASRTask`，会占用ASR服务（GPU）

### 2. 批量翻译和NMT Repair

- **批量翻译**：已修复并发限制（最多2个并发）
- **NMT Repair**：已修复并发限制（最多2个并发）

### 3. 音频缓存（AudioRingBuffer）

- **内存占用**：每个session缓存15秒音频，占用内存但不占用GPU

## 可能的问题

### 问题1：第一次任务时触发S2 Rescoring，导致额外ASR调用

**场景**：
1. 第一次任务到达
2. 触发S2 rescoring（因为短句、低质量等）
3. 调用`secondaryDecodeWorker.decode()`
4. 这会额外调用一次ASR服务（占用GPU）
5. 如果此时服务还在启动中，可能导致"没有可用节点"

**代码位置**：
- `aggregator-middleware.ts` 第393-426行：S2 rescoring逻辑
- `secondary-decode-worker.ts` 第113行：调用`routeASRTask`

### 问题2：等待服务就绪时，S2可能触发额外的ASR调用

**场景**：
1. 第一次任务到达
2. `waitForServicesReady`等待服务就绪
3. 服务就绪后，处理任务
4. 如果触发S2 rescoring，会额外调用ASR服务
5. 如果ASR服务刚启动，可能还没完全准备好处理额外请求

### 问题3：批量翻译在第一次任务时可能触发

**场景**：
1. 第一次任务到达
2. 如果文本较短，可能触发批量翻译
3. 批量翻译会同时运行多个NMT任务（虽然已限制为2个并发）
4. 如果NMT服务刚启动，可能还没完全准备好

## 修复方案

### 方案1：在第一次任务时禁用S2 Rescoring（推荐）

```typescript
// 在aggregator-middleware.ts中
async process(job: JobAssignMessage, result: JobResult): Promise<AggregatorMiddlewareResult> {
  // 检查是否是第一次任务（通过session状态判断）
  const isFirstJob = !this.manager?.getMetrics(job.session_id);
  
  // 如果是第一次任务，禁用S2 rescoring
  if (isFirstJob) {
    logger.info({ jobId: job.job_id }, 'First job detected, disabling S2 rescoring to avoid GPU overload');
    // 跳过S2 rescoring逻辑
  }
}
```

### 方案2：在服务就绪检查中，确保ASR服务可以处理额外请求

```typescript
private async waitForServicesReady(maxWaitMs: number = 30000): Promise<void> {
  // 不仅检查服务是否运行，还检查服务是否真正可用
  // 可以发送一个测试请求，确认服务可以处理任务
}
```

### 方案3：在第一次任务时，增加服务就绪的等待时间

```typescript
// 如果是第一次任务，等待更长时间
if (wasFirstJob) {
  await this.waitForServicesReady(60000); // 从30秒增加到60秒
}
```

### 方案4：限制S2 rescoring的触发频率

```typescript
// 在rescoring前，检查服务负载
if (this.secondaryDecodeWorker?.canDecode()) {
  // 只有服务可用时才进行rescoring
}
```

## 推荐修复

**立即修复**：方案1 + 方案4

1. 在第一次任务时禁用S2 rescoring，避免额外ASR调用
2. 在rescoring前检查服务可用性，确保不会过载

这样可以：
- 避免第一次任务时的额外GPU占用
- 确保服务完全就绪后再处理复杂任务
- 减少"没有可用节点"的错误

## 验证方法

1. **检查日志**：
   - 查看第一次任务是否触发了S2 rescoring
   - 查看是否有"Secondary decode"的日志
   - 查看是否有"No available ASR service"的错误

2. **监控GPU使用**：
   - 在第一次任务时监控GPU使用
   - 确认是否有额外的ASR调用

3. **测试**：
   - 重启节点后，立即发送第一个任务
   - 确认是否还有"没有可用节点"的错误

