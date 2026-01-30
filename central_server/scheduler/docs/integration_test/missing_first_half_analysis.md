# 集成测试前半句丢失问题分析

**日期**: 2026-01-24  
**问题**: 语音识别结果丢失前半句话

---

## 一、问题描述

### 1.1 测试内容

用户朗读了一段长文本，测试语音识别稳定性。原文包含：
- 开头短句："现在我们开始进行一次语音识别稳定性测试。"
- 中间长句（超过10秒）
- 结尾短句

### 1.2 返回结果

**原文 (ASR)**:
```
[0] 開始進行一次雲視別穩定性測試
[2] 再做本次識別
[5] 總的任務,甚至出現於意義上的貨完整都寫了前後不連貫的情況
[7] 優勢的情況,那就說明我們當前的簽分作業和超市規則是基本可用的。
[8] 否則我們還需要繼續分析日製,找出到底是在哪一個環節把我的語音吃掉了。
```

**问题**：
- ❌ **丢失了前半句**："现在我们开始进行" → 只识别出 "開始進行一次雲視別穩定性測試"
- ❌ **utteranceIndex 不连续**：0, 2, 5, 7, 8（缺少 1, 3, 4, 6）
- ❌ **多个短句丢失前半部分**

---

## 二、可能原因分析

### 2.1 调度服务器端问题

#### 2.1.1 提前 Finalize

**可能原因**：
- 调度服务器在收到 `is_final=true` 后**无条件立即 finalize**
- 客户端在静音检测或手动发送时发送 `is_final=true`
- 导致**短音频片段被提前 finalize**，形成独立的 job

**检查点**：
1. ✅ 查看调度服务器日志，确认生成了哪些 job
2. ✅ 检查每个 job 的 `utterance_index` 是否连续
3. ✅ 检查每个 job 的 `reason`（IsFinal/Timeout/MaxDuration）
4. ✅ 检查每个 job 的音频时长

#### 2.1.2 UtteranceIndex 不连续

**可能原因**：
- 调度服务器在 finalize 时递增 `current_utterance_index`
- 如果某些 finalize 失败或被跳过，会导致 `utterance_index` 不连续
- 节点端可能无法正确合并不连续的 `utterance_index`

**检查点**：
1. ✅ 查看调度服务器日志，确认 `utterance_index` 的生成顺序
2. ✅ 检查是否有 finalize 失败或被跳过的日志
3. ✅ 检查 `finalize_inflight` 状态是否正确

### 2.2 节点端问题

#### 2.2.1 AudioAggregator 没有合并

**可能原因**：
- 每个 job 都创建新的 buffer（`"Buffer not found, creating new buffer"`）
- `hasMergedPendingAudio: false`（所有 job 都没有合并 pending 音频）
- AudioAggregator 无法找到之前的 buffer 进行合并

**检查点**：
1. ✅ 查看节点端日志，确认每个 job 的 `hasMergedPendingAudio` 状态
2. ✅ 检查 `pendingTimeoutAudio` 是否存在
3. ✅ 检查 `utteranceIndexDiff` 是否满足合并条件（≤2）

#### 2.2.2 UtteranceIndex 不连续导致无法合并

**可能原因**：
- AudioAggregator 的合并逻辑要求 `utteranceIndexDiff ≤ 2`
- 如果 `utteranceIndexDiff > 2`，会清除 `pendingTimeoutAudio`
- 不连续的 `utterance_index` 可能导致无法合并

**代码位置**（`audio-aggregator-finalize-handler.ts`）：
```typescript
const utteranceIndexDiff = job.utterance_index - pendingUtteranceIndex;

if (utteranceIndexDiff > 2) {
  // 清除 pendingTimeoutAudio
  buffer.pendingTimeoutAudio = undefined;
  // ...
}

// utteranceIndexDiff === 1 或 2，允许合并
```

**检查点**：
1. ✅ 查看节点端日志，确认 `utteranceIndexDiff` 的值
2. ✅ 检查是否因为 `utteranceIndexDiff > 2` 而清除了 `pendingTimeoutAudio`
3. ✅ 检查是否有 `"UtteranceIndex跳跃太大（>2），清除pendingTimeoutAudio"` 的日志

#### 2.2.3 AggregatorMiddleware 去重导致丢失

**可能原因**：
- `AggregatorMiddleware` 的去重逻辑可能误判
- 如果前半句被识别为重复文本，可能被过滤掉

**检查点**：
1. ✅ 查看节点端日志，确认是否有 `"Filtering duplicate text"` 的日志
2. ✅ 检查是否有 `"Filtering substring duplicate text"` 的日志
3. ✅ 检查是否有 `"Overlap detected"` 的日志

### 2.3 客户端问题

#### 2.3.1 静音检测误触发

**可能原因**：
- 客户端在句子中间检测到静音，误触发 `is_final=true`
- 导致音频被提前 finalize，前半句丢失

**检查点**：
1. ✅ 查看客户端日志，确认 `is_final=true` 的发送时机
2. ✅ 检查静音检测参数是否合理
3. ✅ 检查是否有误触发的日志

---

## 三、诊断步骤

### 3.1 查看调度服务器日志

**日志位置**: `central_server/scheduler/logs/scheduler.log`

**关键日志**：
1. **Job 创建日志**：
   ```
   【任务创建】Job 创建成功（已选节点）
   - job_id
   - session_id
   - utterance_index
   - reason (IsFinal/Timeout/MaxDuration)
   ```

2. **Finalize 日志**：
   ```
   Finalize triggered
   - utterance_index
   - reason
   - audio_duration_ms
   ```

### 3.2 查看节点端日志

**日志位置**: `electron_node/electron-node/logs/electron-main.log`

**关键日志**：
1. **AudioAggregator 处理日志**：
   ```
   AudioAggregator: Processing audio chunk
   - job_id
   - utterance_index
   - hasMergedPendingAudio
   - inputAudioDurationMs
   ```

2. **Finalize Handler 日志**：
   ```
   AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingTimeoutAudio
   AudioAggregatorFinalizeHandler: UtteranceIndex跳跃太大（>2），清除pendingTimeoutAudio
   ```

3. **AggregatorMiddleware 日志**：
   ```
   AggregatorMiddleware: Filtering duplicate text
   AggregatorMiddleware: Detected overlap, deduplicating text
   ```

### 3.3 分析 UtteranceIndex 连续性

**检查点**：
1. ✅ 从调度服务器日志中提取所有 `utterance_index`
2. ✅ 检查是否连续（0, 1, 2, 3, ...）
3. ✅ 如果发现不连续，查找缺失的 `utterance_index` 对应的日志

### 3.4 分析音频时长

**检查点**：
1. ✅ 从节点端日志中提取每个 job 的 `inputAudioDurationMs`
2. ✅ 检查是否有异常短的音频（< 1秒）
3. ✅ 检查是否有异常长的音频（> 20秒）

---

## 四、可能的问题场景

### 4.1 场景1：调度服务器提前 Finalize

**现象**：
- 调度服务器日志显示多个 job，`utterance_index` 不连续
- 每个 job 的音频时长都很短（< 3秒）
- 节点端日志显示 `"Buffer not found, creating new buffer"`

**原因**：
- 客户端在句子中间发送 `is_final=true`
- 调度服务器立即 finalize，导致前半句丢失

**解决方案**：
1. ✅ 优化客户端静音检测，避免误触发
2. ✅ 在调度服务器端增加最小音频时长检查
3. ✅ 延迟 finalize，等待更多音频累积

### 4.2 场景2：UtteranceIndex 不连续导致无法合并

**现象**：
- 调度服务器日志显示 `utterance_index` 不连续（0, 2, 5, 7, 8）
- 节点端日志显示 `"UtteranceIndex跳跃太大（>2），清除pendingTimeoutAudio"`

**原因**：
- 某些 finalize 失败或被跳过，导致 `utterance_index` 不连续
- AudioAggregator 无法合并不连续的 `utterance_index`

**解决方案**：
1. ✅ 修复调度服务器的 finalize 逻辑，确保 `utterance_index` 连续
2. ✅ 优化 AudioAggregator 的合并逻辑，支持不连续的 `utterance_index`
3. ✅ 增加日志，追踪 `utterance_index` 的生成过程

### 4.3 场景3：AggregatorMiddleware 去重导致丢失

**现象**：
- 节点端日志显示 `"Filtering duplicate text"` 或 `"Filtering substring duplicate text"`
- 前半句被识别为重复文本，被过滤掉

**原因**：
- `AggregatorMiddleware` 的去重逻辑误判
- 前半句与之前的文本相似，被误判为重复

**解决方案**：
1. ✅ 优化 `AggregatorMiddleware` 的去重逻辑
2. ✅ 增加日志，追踪去重决策过程
3. ✅ 调整去重阈值，避免误判

---

## 五、解决方案

### 5.1 修复 Buffer 清除逻辑（✅ 已完成）

**修改**: 与备份代码保持一致，只要有 pending 音频就保留 buffer

**效果**:
- ✅ 即使合并失败，只要 pending 音频存在，buffer 就不会被删除
- ✅ 下一个 job 能找到 buffer，可以继续合并

### 5.2 启用 AggregatorMiddleware（✅ 已完成）

**修改**: 启用 `AggregatorMiddleware`（`enabled: true`），配置与备份代码一致

**效果**:
- ✅ `hasAggregatorManager: true`
- ✅ `AggregationStage` 能够进行文本聚合
- ✅ 多个 job 的文本结果可以被合并

### 5.3 优化客户端静音检测（建议）

**建议**:
- 调整静音检测参数，避免在句子中间误触发
- 增加最小音频时长检查，避免短音频片段触发 `is_final=true`

### 5.4 优化调度服务器 finalize 逻辑（建议）

**建议**:
- 增加最小音频时长检查
- 延迟 finalize，等待更多音频累积
- 确保 `utterance_index` 连续

---

## 六、相关文档

- [集成测试 Job 处理过程分析](./integration_test_analysis.md)
- [任务管理](../job/README.md)
- [音频处理](../audio/README.md)
- [Finalize 处理机制](../finalize/README.md)

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24
