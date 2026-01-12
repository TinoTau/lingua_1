# 内存泄漏修复方案

## 问题

节点端内存占用过高，导致找不到可用节点。

## 发现的内存泄漏点

### 1. DedupStage.lastSentText Map 无限增长 ⚠️ **高风险**

**位置**: `electron_node/electron-node/main/src/agent/postprocess/dedup-stage.ts`

**问题**:
- `lastSentText: Map<string, string>` 没有清理机制
- 每个 session 都会创建一条记录
- 如果 session 很多，会无限累积

**修复**: ✅ 已有 `removeSession()` 方法，但需要确保被调用

### 2. AggregatorMiddleware.lastSentText Map 无限增长 ⚠️ **高风险**

**位置**: `electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

**问题**:
- `lastSentText: Map<string, string>` 虽然有 `removeSession()`，但可能没有被调用
- 如果同时使用新旧架构，会有两个 Map

**修复**: ✅ 已有 `removeSession()` 方法，但需要确保被调用

### 3. pendingAsyncTranslations Map 无限增长 ⚠️ **高风险**

**位置**: 
- `electron_node/electron-node/main/src/agent/aggregator-middleware.ts`
- `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

**问题**:
- 如果 Promise 失败或超时，不会自动清理
- 可能累积大量失败的 Promise

**修复**: 需要添加超时清理机制

### 4. AggregatorManager 清理不及时 ⚠️ **中风险**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-manager.ts`

**问题**:
- 清理间隔 1 分钟，可能不够及时
- 如果 session 创建过快，可能短时间内超过 1000 个

**修复**: 缩短清理间隔，降低 maxSessions

### 5. AudioRingBuffer Map 累积 ⚠️ **中风险**

**位置**: `electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

**问题**:
- 虽然已禁用，但 Map 可能仍然存在
- 如果 session 很多，会累积大量 AudioRingBuffer

**修复**: ✅ 已有清理机制，但需要确保被调用

## 修复方案

### 1. 确保 removeSession 被调用

**问题**: NodeAgent 可能没有在 session 结束时调用 `removeSession()`

**修复**: 在 NodeAgent 中添加 session 清理逻辑

### 2. 添加 pendingAsyncTranslations 超时清理

**修复**: 在 TranslationStage 和 AggregatorMiddleware 中添加超时清理

### 3. 优化 AggregatorManager 清理

**修复**: 
- 缩短清理间隔（从 60 秒到 30 秒）
- 降低 maxSessions（从 1000 到 500）

### 4. 添加定期清理 lastSentText

**修复**: 在 PostProcessCoordinator 和 AggregatorMiddleware 中添加定期清理过期 session

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

