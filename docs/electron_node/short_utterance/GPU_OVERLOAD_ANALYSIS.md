# GPU过载问题分析

## 问题描述

测试时一句返回结果都没有，因为GPU占用波动非常大，导致在运行中出现没有可用节点。

## 发现的潜在问题

### 1. 批量翻译同时运行（最可能的原因）

在 `aggregator-middleware.ts` 第1193-1216行：

```typescript
// 并行处理批次中的每个任务
const promises = batch.map(async (item) => {
  // ... 每个任务调用 routeNMTTask
  const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
  // ...
});

// 等待所有任务完成
await Promise.allSettled(promises);
```

**问题**：
- `MAX_BATCH_SIZE = 10`：最多同时处理10个NMT任务
- 每个NMT任务都会占用GPU资源
- 如果同时有多个job，每个job可能触发批量翻译，导致GPU过载

### 2. NMT Repair同时翻译多个候选

在 `aggregator-middleware.ts` 第679-695行：

```typescript
const translationPromises = sourceCandidates.map(async (sourceCandidate) => {
  const nmtTask: NMTTask = {
    text: sourceCandidate,
    // ...
  };
  const nmtResult = await this.taskRouter!.routeNMTTask(nmtTask);
  return {
    candidate: sourceCandidate,
    translation: nmtResult.text,
  };
});

const translatedCandidates = await Promise.all(translationPromises);
```

**问题**：
- 如果有多个源候选（同音字修复），会同时翻译所有候选
- `nmtRepairNumCandidates: 5`：最多5个候选，意味着可能同时运行5个NMT任务
- 如果同时有多个job触发NMT Repair，GPU占用会急剧增加

### 3. 二次解码与主ASR同时运行

虽然 `SecondaryDecodeWorker` 的并发限制为1，但它可能与主ASR任务同时运行：

- 主ASR任务：占用GPU
- 二次解码任务：也占用GPU（虽然并发限制为1，但可能与主ASR并行）

### 4. 批量处理窗口过短

```typescript
private readonly BATCH_WINDOW_MS = 100;  // 批量处理窗口：100ms
private readonly MAX_BATCH_SIZE = 10;  // 最大批量大小：10个
```

**问题**：
- 100ms的窗口很短，如果短时间内有多个job，会快速累积到批量队列
- 一旦达到10个，立即触发批量处理，导致10个NMT任务同时运行

## 修复方案

### 方案1：限制批量翻译的并发数（推荐）

将批量翻译改为串行或限制并发数：

```typescript
// 方案1A：串行处理（最简单，但可能较慢）
for (const item of batch) {
  try {
    const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
    item.resolve(nmtResult.text);
  } catch (error) {
    item.reject(error as Error);
  }
}

// 方案1B：限制并发数（推荐）
const MAX_CONCURRENT_NMT = 2;  // 最多同时运行2个NMT任务
const chunks = [];
for (let i = 0; i < batch.length; i += MAX_CONCURRENT_NMT) {
  const chunk = batch.slice(i, i + MAX_CONCURRENT_NMT);
  const promises = chunk.map(async (item) => {
    // ... 处理逻辑
  });
  await Promise.allSettled(promises);
}
```

### 方案2：限制NMT Repair的并发数

```typescript
// 限制同时翻译的候选数
const MAX_CONCURRENT_CANDIDATES = 2;
const chunks = [];
for (let i = 0; i < sourceCandidates.length; i += MAX_CONCURRENT_CANDIDATES) {
  const chunk = sourceCandidates.slice(i, i + MAX_CONCURRENT_CANDIDATES);
  const promises = chunk.map(async (sourceCandidate) => {
    // ... 翻译逻辑
  });
  const results = await Promise.all(promises);
  // ... 处理结果
}
```

### 方案3：增加批量处理窗口

```typescript
private readonly BATCH_WINDOW_MS = 500;  // 从100ms增加到500ms
private readonly MAX_BATCH_SIZE = 5;  // 从10减少到5
```

### 方案4：禁用批量翻译（临时方案）

如果GPU资源有限，可以临时禁用批量翻译：

```typescript
// 在 shouldBatch 判断中，直接返回 false
const shouldBatch = false;  // 临时禁用批量翻译
```

## 推荐修复

**立即修复**：限制批量翻译和NMT Repair的并发数

1. 批量翻译：限制为最多2个并发
2. NMT Repair：限制为最多2个并发
3. 增加批量处理窗口：从100ms增加到500ms
4. 减少批量大小：从10减少到5

这样可以：
- 减少GPU占用峰值
- 保持一定的并行度（不会太慢）
- 避免GPU过载导致"没有可用节点"

## 已实施的修复

### 1. 限制批量翻译并发数

```typescript
// 限制并发数，分批处理（避免GPU过载）
const MAX_CONCURRENT = this.MAX_CONCURRENT_NMT;  // 2
for (let i = 0; i < batch.length; i += MAX_CONCURRENT) {
  const chunk = batch.slice(i, i + MAX_CONCURRENT);
  const promises = chunk.map(async (item) => {
    // ... 处理逻辑
  });
  // 等待当前批次完成后再处理下一批
  await Promise.allSettled(promises);
}
```

### 2. 限制NMT Repair并发数

```typescript
// 限制并发数，分批处理（避免GPU过载）
const MAX_CONCURRENT_CANDIDATES = 2;  // 最多同时翻译2个候选
for (let i = 0; i < sourceCandidates.length; i += MAX_CONCURRENT_CANDIDATES) {
  const chunk = sourceCandidates.slice(i, i + MAX_CONCURRENT_CANDIDATES);
  const translationPromises = chunk.map(async (sourceCandidate) => {
    // ... 翻译逻辑
  });
  const chunkResults = await Promise.all(translationPromises);
  translatedCandidates.push(...chunkResults);
}
```

### 3. 调整批量处理参数

```typescript
private readonly BATCH_WINDOW_MS = 500;  // 从100ms增加到500ms
private readonly MAX_BATCH_SIZE = 5;  // 从10减少到5
private readonly MAX_CONCURRENT_NMT = 2;  // 新增：批量翻译最大并发数
```

## 验证方法

1. **检查日志**：
   - 查看是否有"Processing batch retranslation"日志
   - 查看batchSize是否达到10
   - 查看是否有多个NMT任务同时运行

2. **监控GPU占用**：
   - 在批量处理时监控GPU占用
   - 确认是否同时运行了多个NMT任务

3. **测试**：
   - 修复后重新测试
   - 确认GPU占用是否稳定
   - 确认是否还有"没有可用节点"的错误

