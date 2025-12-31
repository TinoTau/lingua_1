# 节点端内存占用分析

## 问题描述

节点端内存占用过高，导致找不到可用节点。

## 可能的内存占用点

### 1. AggregatorManager（最大潜在占用）

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-manager.ts`

**存储**:
- `states: Map<string, AggregatorState>` - 每个 session 的状态
- `lastAccessTime: Map<string, number>` - 每个 session 的最后访问时间

**配置**:
- `maxSessions: 1000` - 最多 1000 个 session
- `ttlMs: 5 * 60 * 1000` - 5 分钟 TTL

**每个 AggregatorState 的内存占用**:
- `sessionId`: ~50 bytes
- `pendingText`: ~100 bytes (平均)
- `lastUtterance`: ~200 bytes
- `tailBuffer`: ~50 bytes
- `recentCommittedText`: ~500 bytes (5条，每条100字节)
- `recentKeywords`: ~200 bytes (10个关键词，每个20字节)
- `lastTranslatedText`: ~200 bytes
- `metrics`: ~100 bytes
- **总计：约 1.4 KB per session**

**最大内存占用**:
- 1000 sessions × 1.4 KB = **1.4 MB**（理论最大）

**清理机制**:
- ✅ 每分钟清理过期 session（TTL 5 分钟）
- ✅ LRU 回收（超过 maxSessions 时）

**潜在问题**:
- 如果 session 创建过快，可能短时间内超过 1000 个
- 如果清理不及时，可能累积大量 session

### 2. TranslationCache（LRUCache）

**位置**: 
- `electron_node/electron-node/main/src/agent/aggregator-middleware.ts` (旧架构)
- `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts` (新架构)

**配置**:
- `max: 200` - 最多 200 条缓存
- `ttl: 10 * 60 * 1000` - 10 分钟 TTL

**每条缓存的内存占用**:
- `key` (cacheKey): ~100 bytes
- `value` (翻译文本): ~200 bytes (平均)
- **总计：约 300 bytes per entry**

**最大内存占用**:
- 200 entries × 300 bytes = **60 KB**（理论最大）

**清理机制**:
- ✅ LRUCache 自动清理（超过 max 时）
- ✅ TTL 过期自动清理

**潜在问题**:
- 如果同时使用新旧架构，会有两个 TranslationCache（重复）

### 3. DedupStage.lastSentText（Map）

**位置**: `electron_node/electron-node/main/src/agent/postprocess/dedup-stage.ts`

**存储**:
- `lastSentText: Map<string, string>` - 每个 session 最后发送的文本

**每条记录的内存占用**:
- `key` (sessionId): ~50 bytes
- `value` (text): ~200 bytes (平均)
- **总计：约 250 bytes per entry**

**潜在问题**:
- ❌ **没有清理机制** - Map 会无限增长
- 如果 session 很多，会累积大量记录

### 4. AggregatorMiddleware.lastSentText（Map）

**位置**: `electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

**存储**:
- `lastSentText: Map<string, string>` - 每个 session 最后发送的文本

**潜在问题**:
- ❌ **没有清理机制** - Map 会无限增长
- 如果同时使用新旧架构，会有两个 lastSentText Map（重复）

### 5. AudioRingBuffer（已禁用，但代码还在）

**位置**: `electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

**存储**:
- `audioBuffers: Map<string, AudioRingBuffer>` - 每个 session 的音频缓存

**每个 AudioRingBuffer 的内存占用**:
- 15秒缓存，16kHz，PCM16: 15 × 16000 × 2 = **480 KB**

**潜在问题**:
- 虽然已禁用，但 Map 可能仍然存在
- 如果 session 很多，会累积大量 AudioRingBuffer

### 6. pendingAsyncTranslations（Map）

**位置**: 
- `electron_node/electron-node/main/src/agent/aggregator-middleware.ts`
- `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

**存储**:
- `pendingAsyncTranslations: Map<string, Promise<string>>` - 待更新的翻译

**潜在问题**:
- ❌ **没有清理机制** - 如果 Promise 失败或超时，Map 会累积

## 内存泄漏风险点

### 高风险

1. **DedupStage.lastSentText Map 无限增长**
   - 没有清理机制
   - 每个 session 都会创建一条记录
   - 如果 session 很多，会累积大量记录

2. **AggregatorMiddleware.lastSentText Map 无限增长**
   - 没有清理机制
   - 如果同时使用新旧架构，会有两个 Map

3. **pendingAsyncTranslations Map 无限增长**
   - 如果 Promise 失败或超时，不会自动清理
   - 可能累积大量失败的 Promise

### 中风险

4. **AggregatorManager 清理不及时**
   - 如果 session 创建过快，可能短时间内超过 1000 个
   - 清理间隔 1 分钟，可能不够及时

5. **AudioRingBuffer Map 累积**
   - 虽然已禁用，但 Map 可能仍然存在
   - 如果 session 很多，会累积大量 AudioRingBuffer

### 低风险

6. **TranslationCache 重复**
   - 如果同时使用新旧架构，会有两个 TranslationCache
   - 但 LRUCache 有自动清理机制

## 日志文件位置

### 节点端日志

- **Electron 主进程**: `electron_node/electron-node/logs/electron-main.log`
- **Rust 推理服务**: `electron_node/services/node-inference/logs/node-inference.log`
- **NMT 服务**: `electron_node/services/nmt_m2m100/logs/nmt-service.log`
- **TTS 服务**: `electron_node/services/piper_tts/logs/tts-service.log`
- **ASR 服务**: `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log`

### 调度服务器日志

- **Scheduler**: `central_server/scheduler/logs/scheduler.log`

### Web 前端日志

- **Web Client**: `webapp/web-client/logs/web-client.log`

## 检查方法

### 1. 检查日志中的内存相关信息

在节点端日志中搜索：
- `Memory usage analysis`
- `Cleaned up expired AggregatorState sessions`
- `totalSessions`
- `translationCache`
- `lastSentText`

### 2. 检查 session 数量

在节点端日志中搜索：
- `Created new AggregatorState`
- `Removed expired AggregatorState`
- `totalSessions`

### 3. 检查 Map 大小

在代码中添加日志，输出：
- `AggregatorManager.states.size`
- `DedupStage.lastSentText.size`
- `AggregatorMiddleware.lastSentText.size`
- `TranslationCache.size`

## 修复建议

### 1. 添加 DedupStage.lastSentText 清理机制

```typescript
// 在 PostProcessCoordinator 中添加清理逻辑
removeSession(sessionId: string): void {
  this.dedupStage.removeSession(sessionId);
  // ...
}
```

### 2. 添加 AggregatorMiddleware.lastSentText 清理机制

```typescript
// 在 removeSession 中清理
removeSession(sessionId: string): void {
  // ...
  this.lastSentText.delete(sessionId);
}
```

### 3. 添加 pendingAsyncTranslations 清理机制

```typescript
// 添加超时清理
setTimeout(() => {
  this.pendingAsyncTranslations.delete(cacheKey);
}, timeoutMs);
```

### 4. 降低 maxSessions 限制

```typescript
maxSessions: 500,  // 从 1000 降低到 500
```

### 5. 缩短清理间隔

```typescript
setInterval(() => this.cleanupExpiredSessions(), 30000); // 从 60 秒降低到 30 秒
```

### 6. 清理 AudioRingBuffer Map

```typescript
// 在 removeSession 中清理
this.audioBuffers.delete(sessionId);
```

## 下一步

1. 查看日志，确认是哪个组件占用了过多内存
2. 添加内存监控日志
3. 实施修复建议
4. 验证内存占用是否降低

