# 流式ASR实现总结

**日期**: 2026-01-16  
**状态**: ✅ **实现完成**

---

## 一、实现内容

### 1. AudioAggregator流式切分逻辑

**核心功能**：
- ✅ `pendingTimeoutAudio`机制：超时finalize的音频缓存，等待下一个job合并
- ✅ `pendingSmallSegments`机制：<5秒的音频片段缓存，等待合并成≥5秒批次
- ✅ `originalJobIds`分配：头部对齐策略，每个ASR批次对应一个originalJobId
- ✅ 5秒流式切分：长音频按能量切分，组合成~5秒批次发送给ASR
- ✅ `pendingTimeoutAudio` TTL：10秒超时强制处理

**关键文件**：
- `audio-aggregator.ts` - 核心流式切分逻辑
- `audio-aggregator-utils.ts` - 添加了`splitAudioByEnergy`方法
- `audio-aggregator-types.ts` - 类型定义

### 2. Session Affinity机制

**核心功能**：
- ✅ `SessionAffinityManager`：管理超时finalize的sessionId->nodeId映射
- ✅ 超时finalize时记录映射
- ✅ 手动/pause finalize时清除映射
- ✅ 30分钟TTL自动清理过期映射

**关键文件**：
- `session-affinity-manager.ts` - Session affinity管理器
- `node-agent.ts` - 在node_register_ack时设置nodeId

### 3. OriginalJobResultDispatcher

**核心功能**：
- ✅ 按originalJobId分组ASR结果
- ✅ 累积多个ASR批次到同一个JobResult的segments数组
- ✅ 当达到期望片段数量或finalize时，触发后续处理

**关键文件**：
- `original-job-result-dispatcher.ts` - 原始Job结果分发器

### 4. 相关文件更新

**已更新**：
- ✅ `pipeline-orchestrator-audio-processor.ts` - 支持多段音频和originalJobIds
- ✅ `asr-step.ts` - 支持流式批次处理和OriginalJobResultDispatcher
- ✅ `job-pipeline.ts` - 支持跳过ASR步骤（通过providedCtx）

---

## 二、关键设计决策

### 2.1 流式切分策略

- **长音频（>10秒）**：按能量切分，组合成~5秒批次
- **短音频（<5秒）**：缓存到`pendingSmallSegments`，等待合并
- **超时finalize**：缓存到`pendingTimeoutAudio`，等待下一个job合并
- **手动/pause finalize**：立即按能量切分，发送给ASR

### 2.2 头部对齐策略

- 每个ASR批次以第一个片段的originalJobId作为整个批次的originalJobId
- 简化结果分组，避免跨job的复杂分组逻辑
- 所有ASR结果都会归并到对应originalJob的切片数组里

### 2.3 Session Affinity策略

- **超时finalize**：记录sessionId->nodeId映射，确保后续job发送到同一个节点
- **手动/pause finalize**：可以随机分配，清除映射
- **TTL**：30分钟自动清理过期映射

---

## 三、使用说明

### 3.1 调度服务器配置

**需要支持**：
1. 查询sessionId->nodeId映射的API（用于超时finalize的job分配）
2. 或者，节点端在超时finalize时主动通知调度服务器

**当前实现**：
- 节点端记录映射（`SessionAffinityManager`）
- 需要调度服务器支持查询或通知机制

### 3.2 节点端配置

**无需额外配置**：
- SessionAffinityManager自动管理nodeId
- AudioAggregator自动使用SessionAffinityManager

---

## 四、注意事项

### 4.1 调度服务器集成

**待实现**：
- 调度服务器需要支持查询sessionId->nodeId映射
- 或者在超时finalize时，节点端主动通知调度服务器

**建议**：
- 在调度服务器中添加API：`GET /api/session-affinity/{sessionId}`
- 返回该session应该路由到的nodeId（如果存在）

### 4.2 测试建议

1. **测试超时finalize的session affinity**：
   - 发送超时finalize的job，验证后续job是否发送到同一个节点

2. **测试流式切分**：
   - 发送长音频（>10秒），验证是否按~5秒批次切分

3. **测试pendingSmallSegments**：
   - 发送短音频（<5秒），验证是否缓存等待合并

4. **测试originalJobIds分配**：
   - 验证多个ASR批次是否正确分配到对应的originalJobId

---

## 五、文件清单

### 新增文件
1. ✅ `session-affinity-manager.ts` - Session affinity管理器
2. ✅ `original-job-result-dispatcher.ts` - 原始Job结果分发器
3. ✅ `audio-aggregator-types.ts` - 类型定义

### 修改文件
1. ✅ `audio-aggregator.ts` - 重新实现流式切分逻辑
2. ✅ `audio-aggregator-utils.ts` - 添加`splitAudioByEnergy`方法
3. ✅ `pipeline-orchestrator-audio-processor.ts` - 支持多段音频和originalJobIds
4. ✅ `asr-step.ts` - 支持流式批次处理和OriginalJobResultDispatcher
5. ✅ `job-pipeline.ts` - 支持跳过ASR步骤
6. ✅ `node-agent.ts` - 在node_register_ack时设置SessionAffinityManager的nodeId

---

**审核状态**: ✅ **实现完成，等待测试**  
**下一步**: 需要调度服务器支持session affinity查询或通知机制
