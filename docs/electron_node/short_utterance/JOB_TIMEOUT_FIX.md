# Job超时问题修复

## 问题分析

### 问题现象

从日志分析发现，`job-01501A34`出现了超时问题：

**时间线**：
1. **22:56:57.278** - 节点端收到job_assign，开始处理
2. **22:56:57.950** - ASR返回空结果，被过滤，**没有发送job_result**
3. **22:57:27.793** - 调度服务器等待30秒，没有收到job_result，认为超时，发送job_cancel
4. **22:57:31.298** - 调度服务器触发failover，重新派发job
5. **22:57:32.102** - ASR再次返回空结果，又被过滤
6. **22:58:01.805** - 调度服务器再次等待30秒，没有收到job_result，认为超时
7. **22:58:07.328** - 调度服务器再次触发failover，重新派发job
8. **22:58:08.267** - ASR返回结果
9. **22:58:09.806** - NMT翻译完成
10. **22:58:09.807** - 发送job_result

### 根本原因

1. **节点端处理时间很短**：
   - ASR处理：~1秒
   - NMT处理：~1.5秒
   - 总处理时间：~2.5秒

2. **但是节点端没有发送job_result**：
   - 当ASR返回空结果时，`PostProcessCoordinator`返回`shouldSend: false`
   - `NodeAgent`检查到空结果，直接`return`，不发送job_result
   - 调度服务器等待30秒，没有收到job_result，认为超时

3. **触发failover**：
   - 调度服务器认为job超时，触发failover
   - 重新派发同一个job（attempt_id递增）
   - 导致重复处理

### 问题代码位置

1. **PostProcessCoordinator** (`postprocess-coordinator.ts` 第105-118行)：
   ```typescript
   if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
     return {
       shouldSend: false,  // 问题：返回false，导致不发送
       aggregatedText: '',
       translatedText: '',
     };
   }
   ```

2. **NodeAgent** (`node-agent.ts` 第1005-1018行)：
   ```typescript
   if (isEmpty) {
     logger.info(..., 'ASR result is empty, skipping job_result send');
     return;  // 问题：直接返回，不发送job_result
   }
   ```

## 修复方案

### 修复1: PostProcessCoordinator - 返回shouldSend=true

**文件**：`electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

**修改**（第105-118行）：
- 即使ASR结果为空，也返回`shouldSend: true`
- 这样调度服务器知道节点端已经处理完成，不会触发超时
- 调度服务器的result_queue会处理空结果，不会发送给客户端

```typescript
if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
  return {
    shouldSend: true,  // 修复：返回true，确保发送空结果给调度服务器，避免超时
    aggregatedText: '',
    translatedText: '',
    ttsAudio: '',
    ttsFormat: 'opus',
    reason: 'ASR result is empty (filtered by AggregatorMiddleware or empty ASR)',
  };
}
```

### 修复2: NodeAgent - 发送空结果

**文件**：`electron_node/electron-node/main/src/agent/node-agent.ts`

**修改**（第1005-1018行）：
- 即使ASR结果为空，也发送job_result（空结果）给调度服务器
- 这样调度服务器知道节点端已经处理完成，不会触发超时

```typescript
if (isEmpty) {
  logger.info(
    { 
      jobId: job.job_id, 
      reason: 'ASR result is empty, but sending empty job_result to scheduler to prevent timeout',
    },
    'NodeAgent: ASR result is empty, sending empty job_result to scheduler to prevent timeout'
  );
  // 继续执行，发送空结果
} else {
  // ...正常处理
}
```

## 工作流程

### 修复后的流程

1. 节点端收到job_assign，开始处理
2. ASR返回空结果
3. `PipelineOrchestrator`返回空结果（text_asr: ''）
4. `PostProcessCoordinator`返回`shouldSend: true`（即使文本为空）
5. `NodeAgent`发送job_result（空结果）给调度服务器
6. 调度服务器收到job_result，知道节点端已经处理完成，**不会触发超时**
7. 调度服务器的result_queue处理空结果，**不会发送给客户端**

### 调度服务器处理空结果

调度服务器的`result_queue`会检查结果是否为空：
- 如果`text_asr`和`text_translated`都为空，会创建`MissingResult`或直接跳过
- 不会将空结果发送给客户端

## 优势

1. **避免超时**：即使ASR返回空结果，也发送job_result，调度服务器知道节点端已处理完成
2. **避免重复处理**：不会触发failover，不会重复派发job
3. **不影响客户端**：调度服务器的result_queue会处理空结果，不会发送给客户端
4. **保持30秒超时机制**：不需要延长超时时间，保持系统响应速度

## 相关文件

- **PostProcessCoordinator**: `electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`
- **NodeAgent**: `electron_node/electron-node/main/src/agent/node-agent.ts`
- **PipelineOrchestrator**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`
- **ResultQueue**: `central_server/scheduler/src/managers/result_queue.rs`

## 为什么重新派发后最终产生了文本？

### 问题

用户提出了一个很好的问题：如果ASR返回空结果，为什么在调度服务器重新派发（failover）后，最终又产生了文本？

### 分析

从日志分析发现，`job-01501A34`的三次处理过程：

**第一次处理**（22:56:57）：
- audioLength: 5312 (opus)
- aggregatedAudioLength: 40960 (PCM16, ~1.28秒)
- pendingSecondHalf: **无**
- ASR结果: **空**

**第二次处理**（22:57:31）：
- audioLength: 5312 (opus) - **相同的音频数据**
- aggregatedAudioLength: 40960 (PCM16, ~1.28秒)
- pendingSecondHalf: **无**
- ASR结果: **空**

**第三次处理**（22:58:07）：
- audioLength: 5312 (opus) - **仍然是相同的音频数据**
- **pendingSecondHalfLength: 74432 (~2.3秒) - 关键！**
- aggregatedAudioLength: 115392 (PCM16, ~3.6秒) - **合并后的音频**
- ASR结果: **有文本！**

### 根本原因

1. **前两次处理时音频太短**：
   - 只有1.28秒的音频，ASR无法识别出有效文本
   - 没有pendingSecondHalf可以合并

2. **pendingSecondHalf的来源**：
   - 在两次处理之间，同一个session的其他utterance（可能是utteranceIndex=5或更早）
   - 触发了timeout split，产生了pendingSecondHalf（约2.3秒）
   - **pendingSecondHalf是session级别的，不是job级别的**
   - 即使job被failover重新派发，pendingSecondHalf仍然保留在session缓冲区中

3. **第三次处理时音频更长**：
   - AudioAggregator合并了pendingSecondHalf（2.3秒）+ 当前音频（1.28秒）
   - 总长度约3.6秒，ASR能够识别出文本

### 关键点

- **pendingSecondHalf是session级别的**：存储在`AudioAggregator`的session缓冲区中
- **failover不会清除pendingSecondHalf**：因为它是session级别的，不是job级别的
- **这导致第三次处理时，音频更长，ASR能够识别**

### 这说明了什么？

1. **AudioAggregator的pendingSecondHalf机制是有效的**：
   - 它能够保留之前split的后半句，与后续音频合并
   - 这提高了ASR识别的成功率

2. **但是也暴露了一个问题**：
   - 如果前两次处理时，pendingSecondHalf还没有产生，ASR返回空结果
   - 节点端没有发送job_result，导致调度服务器认为超时
   - 触发failover，重新派发job
   - 第三次处理时，pendingSecondHalf已经存在，ASR能够识别

3. **修复后的效果**：
   - 即使ASR返回空结果，也发送job_result给调度服务器
   - 调度服务器知道节点端已经处理完成，不会触发超时
   - 不会触发failover，不会重复派发job
   - 后续的utterance会自然合并pendingSecondHalf，ASR能够识别

### 关于去重机制的作用

**用户问题**：如果空结果接收了合并文本（pendingSecondHalf），将合并文本作为自己的结果发回调度服务器，那么这个问题是否已经被调度服务器的重复Job过滤机制解决了？

**答案**：**部分解决，但不完全**。

1. **去重机制的工作原理**：
   - 基于 `session_id` + `job_id` 进行去重
   - 如果同一个 `job_id` 在30秒内收到多次结果，会被过滤
   - **failover时，`job_id` 不变，只是 `attempt_id` 递增**

2. **去重机制可以解决的问题**：
   - 如果同一个 `job_id` 在30秒内收到多次结果（例如failover后重新派发），会被过滤
   - 这可以防止重复输出

3. **去重机制无法解决的问题**：
   - **如果前两次处理时，节点端没有发送job_result（空结果被过滤），调度服务器不会记录该job_id**
   - 第三次处理时，即使发送了job_result（包含pendingSecondHalf），去重机制也无法识别这是重复的
   - 因为前两次没有记录，第三次是第一次记录

4. **修复的必要性**：
   - **即使ASR返回空结果，也发送job_result给调度服务器**
   - 这样调度服务器会记录该job_id，如果后续failover重新派发，去重机制可以过滤
   - **更重要的是，调度服务器知道节点端已经处理完成，不会触发超时，不会触发failover**

5. **节点端去重机制（统一基于job_id）**：
   - **之前的机制问题**：
     - 之前的DedupStage使用文本内容进行去重
     - 对于空结果：`dedupKey = '|'`（两个空字符串用|连接）
     - 如果`lastSent`也是`'|'`，会返回`shouldSend: false`
     - **问题1**：如果同一个job_id被failover重新派发，第二次处理时如果也是空结果，会被过滤（因为文本内容相同），调度服务器收不到第二次的空结果
     - **问题2**：如果不同的job_id都是空结果，也会被过滤（因为文本内容相同），导致不同的job_id无法分别发送空结果
     - **问题3**：对文本进行过滤只会增加调度服务器的负担
     - **问题4**：文本丢失的情况是节点端的问题，不应该掩盖这个问题
   - **新机制（统一基于job_id）**：
     - **DedupStage 统一使用 job_id 进行去重**：
       - 所有结果（空结果和非空结果）都使用 `job_id` 进行去重（30秒TTL，与调度服务器保持一致）
       - 移除基于文本内容的去重逻辑（normalizeText、calculateTextSimilarity等）
       - 同一个job_id在30秒内只发送一次结果
       - 不同的job_id即使文本内容相同，也会分别发送
     - **PostProcessCoordinator 让所有结果都经过 DedupStage 检查**：
       - 即使 DedupStage 过滤了结果，仍然发送给调度服务器（用于核销）
       - 这样调度服务器知道节点端已经处理完成，不会触发超时
   - **双重保护**：
     - 节点端去重：避免重复发送相同的job_id（基于job_id）
     - 调度服务器去重：如果同一个job_id在30秒内收到多次结果，会被过滤

6. **总结**：
   - 去重机制可以防止重复输出（如果同一个job_id收到多次结果）
   - 但是，如果节点端不发送空结果，调度服务器无法知道节点端已经处理完成
   - 修复后，即使空结果也发送job_result，调度服务器可以：
     - 记录job_id，启用去重机制
     - 知道节点端已经处理完成，不会触发超时
     - 不会触发failover，不会重复派发job
   - **节点端空结果去重**：
     - 避免重复发送相同的空结果
     - 与调度服务器的去重机制配合，形成双重保护

---

**修复日期**：2025-12-30  
**修复人员**：AI Assistant  
**状态**：✅ 已修复，待测试验证

