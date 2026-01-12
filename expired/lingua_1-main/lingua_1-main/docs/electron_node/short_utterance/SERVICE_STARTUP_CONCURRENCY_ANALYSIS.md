# 服务启动并发问题分析

## 问题描述

重启节点端后，还是没有找到可用节点。需要检查哪些并发操作占用了大量的GPU或内存。

## 发现的潜在问题

### 1. 服务串行启动，但每个服务启动时都会加载模型

在 `index.ts` 第270-275行：

```typescript
for (const name of toStart) {
  logger.info({ serviceName: name }, 'Auto-starting Python service...');
  pythonServiceManager.startService(name).catch((error) => {
    logger.error({ error, serviceName: name }, 'Failed to auto-start Python service');
  });
}
```

**问题**：
- 服务是串行启动的（for循环），但每个服务启动时都会加载模型
- 如果多个服务同时启动（虽然代码是串行的，但异步操作可能重叠），模型加载会占用大量GPU和内存
- 每个Python服务启动时都会：
  - 加载模型到GPU
  - 初始化服务进程
  - 等待服务就绪

### 2. 服务启动是异步的，可能重叠

虽然使用for循环串行启动，但每个`startService`都是异步的，可能多个服务同时启动：

```typescript
// 服务1开始启动（异步）
pythonServiceManager.startService('faster_whisper_vad').catch(...);
// 服务2立即开始启动（异步，不等待服务1完成）
pythonServiceManager.startService('nmt').catch(...);
// 服务3立即开始启动（异步，不等待服务1和2完成）
pythonServiceManager.startService('tts').catch(...);
```

**问题**：
- 多个服务可能同时加载模型到GPU
- 每个服务加载模型都会占用GPU内存
- 如果GPU内存不足，可能导致服务启动失败或"没有可用节点"

### 3. 模型加载可能占用大量GPU内存

每个服务启动时：
- ASR服务（faster-whisper-vad）：加载Whisper模型（可能几GB）
- NMT服务（nmt-m2m100）：加载翻译模型（可能几GB）
- TTS服务（piper-tts或your-tts）：加载TTS模型（可能几GB）

**问题**：
- 如果同时加载多个模型，GPU内存可能不足
- 即使串行启动，如果服务启动很快，模型加载可能重叠

### 4. 等待服务就绪的机制可能不够

在 `inference-service.ts` 中，`waitForServicesReady` 只等待10秒：

```typescript
private async waitForServicesReady(maxWaitMs: number = 10000): Promise<void> {
  // 最多等待10秒
}
```

**问题**：
- 如果服务启动需要更长时间（特别是模型加载），10秒可能不够
- 如果服务启动失败，可能一直等待到超时

## 修复方案

### 方案1：串行启动服务，等待每个服务完全启动后再启动下一个（推荐）

```typescript
// 串行启动服务，等待每个服务完全启动后再启动下一个
for (const name of toStart) {
  logger.info({ serviceName: name }, 'Auto-starting Python service...');
  try {
    await pythonServiceManager.startService(name);
    logger.info({ serviceName: name }, 'Python service started successfully');
    // 等待服务完全就绪（包括模型加载）
    await this.waitForServiceReady(name);
  } catch (error) {
    logger.error({ error, serviceName: name }, 'Failed to auto-start Python service');
  }
}
```

### 方案2：限制同时启动的服务数量

```typescript
// 限制同时启动的服务数量（最多2个）
const MAX_CONCURRENT_STARTUPS = 2;
for (let i = 0; i < toStart.length; i += MAX_CONCURRENT_STARTUPS) {
  const chunk = toStart.slice(i, i + MAX_CONCURRENT_STARTUPS);
  await Promise.allSettled(
    chunk.map(name => pythonServiceManager.startService(name))
  );
}
```

### 方案3：增加等待服务就绪的超时时间

```typescript
private async waitForServicesReady(maxWaitMs: number = 30000): Promise<void> {
  // 从10秒增加到30秒，给模型加载更多时间
}
```

### 方案4：检查GPU内存，避免同时加载过多模型

```typescript
private async checkGpuMemory(): Promise<boolean> {
  // 检查GPU内存使用情况
  // 如果内存不足，等待或跳过某些服务
}
```

## 推荐修复

**立即修复**：方案1 + 方案3

1. 串行启动服务，等待每个服务完全启动后再启动下一个
2. 增加等待服务就绪的超时时间（从10秒增加到30秒）
3. 添加服务启动完成的日志，便于调试

这样可以：
- 避免多个服务同时加载模型
- 减少GPU内存峰值
- 确保服务完全启动后再处理任务

## 验证方法

1. **检查日志**：
   - 查看服务启动顺序
   - 查看服务启动时间
   - 查看是否有GPU内存不足的错误

2. **监控GPU使用**：
   - 在服务启动时监控GPU内存
   - 确认是否有多个服务同时加载模型

3. **测试**：
   - 重启节点后，等待所有服务启动完成
   - 确认是否还有"没有可用节点"的错误

