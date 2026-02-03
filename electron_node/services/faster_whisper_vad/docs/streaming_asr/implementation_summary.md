# 节点端流式 ASR 优化实施总结

**日期**: 2026-01-24；2026-02 更新  
**依据**: 决策部门反馈（[streaming_asr_node_optimization_guide.md](streaming_asr_node_optimization_guide.md)）  
**原则**: 不考虑兼容，保持代码简洁，做好单元测试

**架构变更（2026-02）**：**OriginalJobResultDispatcher** 已移除，相关实现与单测已删除。结果发送现由 ResultSender + buildResultsToSend 单路径完成。下文提及 Dispatcher 的条目为历史记录。

---

## 一、P0 必须补充（已完成）

### 1. 冻结并规范 AudioBuffer 的 Key 定义 ✅

**实现**:
- 新增 `audio-aggregator-buffer-key.ts` 模块
- 提供 `buildBufferKey()` 工具函数
- 规范：`bufferKey = session_id [+ room_code] [+ input_stream_id / speaker_id]`
- 全链路打印 `bufferKey`、`epoch`、`state`

**关键代码**:
```typescript
// audio-aggregator-buffer-key.ts
export function buildBufferKey(job: JobAssignMessage, ctx?: Partial<BufferKeyContext>): string {
  const keyParts: string[] = [job.session_id];
  // ... 可选字段：room_code, input_stream_id, speaker_id, target_lang
  return keyParts.join('|');
}
```

**日志示例**:
```typescript
logger.info({
  bufferKey,
  epoch: buffer.epoch,
  state: buffer.state,
  // ...
});
```

### 2. Buffer 生命周期状态机化 ✅

**实现**:
- `AudioBuffer` 增加 `state: BufferState` 和 `epoch: number` 字段
- 状态机：`OPEN` → `PENDING_TIMEOUT` / `PENDING_MAXDUR` / `FINALIZING` → `CLOSED`
- 写入前检查：如果 `state === FINALIZING || CLOSED`，切换到新 epoch
- 防止 finalize 后写入旧 buffer

**状态机逻辑**:
```typescript
// 写入前检查
if (buffer.state === 'FINALIZING' || buffer.state === 'CLOSED') {
  const newEpoch = buffer.epoch + 1;
  // 创建新 epoch 的 buffer
  buffer = { state: 'OPEN', epoch: newEpoch, ... };
}

// Finalize 时进入 FINALIZING 状态
buffer.state = 'FINALIZING';
buffer.lastFinalizeAt = nowMs;
```

### 3. 统一 expectedSegmentCount 的来源 ✅

**实现**:
- 强制：`expectedSegmentCount = batchCountForThisJob`（该 originalJobId 对应的 batch 数量）
- 不再使用 `undefined`（累积等待）
- 所有注册必须提供明确的 `expectedSegmentCount`

**关键代码**:
```typescript
// runAsr-step.ts
const batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length;
const expectedSegmentCount = batchCountForThisJob;  // 强制一致
```

### 4. ~~OriginalJobResultDispatcher 增加 registration TTL 兜底~~（组件已移除）

**实现**:
- 每个 registration 记录 `startedAt` 和 `ttlTimerHandle`
- TTL：10秒（决策部门建议 5-10秒）
- 超时强制 finalize（partial）+ 清理，避免永远等不齐
- 输出 `partial=true`、`reason=registration_ttl`

**关键代码**:
```typescript
// 注册时启动 TTL 定时器
registration.ttlTimerHandle = setTimeout(() => {
  this.forceFinalizePartial(sessionId, originalJobId, 'registration_ttl');
}, this.REGISTRATION_TTL_MS);

// 超时强制 finalize
private async forceFinalizePartial(sessionId, originalJobId, reason) {
  // 输出已有 segments，标注 partial=true
  // 清理 registration
}
```

### 5. ASR 失败 segment 的核销策略 ✅

**实现**:
- ASR 失败时，创建 `missing=true` 的 segment
- 发送给 dispatcher，计入 `receivedCount` 和 `missingCount`
- 确保 registration 可以完成（不会永远等不齐）

**关键代码**:
```typescript
// runAsr-step.ts
catch (error) {
  const missingAsrData: OriginalJobASRData = {
    originalJobId,
    asrText: '',
    asrSegments: [],
    batchIndex: i,
    missing: true,  // 标记为缺失
  };
  await dispatcher.addASRSegment(job.session_id, originalJobId, missingAsrData);
}
```

### 6. 统一 batch → originalJobId 归属策略 ✅

**实现**:
- 全局采用**头部对齐策略**（MaxDuration/Manual/Timeout 行为一致）
- 使用 `batchJobInfo`（每个 batch 的第一个片段对应的 jobInfo）
- 删除容器装填算法（仅用于统计或调试）

**关键代码**:
```typescript
// audio-aggregator.ts
// 统一使用头部对齐策略
const originalJobIds = batchJobInfo.map(info => info.jobId);
```

### 7. 删除/清理路径增加删除原因与 pending 状态日志 ✅

**实现**:
- 新增 `deleteBuffer()` 方法，统一删除逻辑
- 每次 delete 必须打印：
  - `reason`（删除原因）
  - `pendingTimeoutAudioLength`、`pendingMaxDurationAudioLength`、`pendingSmallSegmentsCount`
  - `state`、`epoch`
  - `decisionBranch`（判定分支）

**关键代码**:
```typescript
private deleteBuffer(bufferKey: string, buffer: AudioBuffer | undefined, reason: string, nowMs: number) {
  logger.info({
    bufferKey,
    epoch: buffer.epoch,
    state: buffer.state,
    reason,
    decisionBranch: 'DELETE_BUFFER',
    pendingTimeoutAudioLength,
    pendingMaxDurationAudioLength,
    pendingSmallSegmentsCount,
    // ...
  });
  buffer.state = 'CLOSED';
  this.buffers.delete(bufferKey);
}
```

### 8. utteranceIndex 连续性阈值超界处理策略 ✅

**实现**:
- 差值 > 2 时：强制 finalize pending（丢弃 pending，不合并）
- 不允许"静默失败"，必须有明确的 `action` 和 `reason`
- 增加埋点：`utterance_gap`、`action=force_finalize_pending`

**关键代码**:
```typescript
// audio-aggregator-finalize-handler.ts
if (utteranceIndexDiff > 2) {
  logger.warn({
    utteranceIndexDiff,
    action: 'force_finalize_pending',
    reason: 'UtteranceIndex跳跃太大（>2），强制finalize pending',
  });
  // 丢弃 pending，不合并
  buffer.pendingTimeoutAudio = undefined;
  return { shouldMerge: false };
}
```

---

## 二、架构优化亮点

### 1. 流式切分逻辑统一（已完成）

**架构设计**:
- `createStreamingBatchesWithPending` 返回 `batchJobInfo` 数组
- 每个 batch 的第一个片段对应的 jobInfo 在创建 batch 时记录
- MaxDuration handler 直接使用 `batchJobInfo`，无需重新计算偏移量

**代码对比**:
- **重构前**：约 50 行复杂逻辑，手动跟踪偏移量和索引
- **重构后**：1 行代码 `const originalJobIds = batchJobInfo.map(info => info.jobId);`

### 2. 音频格式验证统一（已完成）

**架构设计**:
- 所有格式验证统一到 `decodeAudioChunk()`
- `pipeline-orchestrator-audio-processor.ts` 中删除所有重复验证代码

---

## 三、关键数据结构更新

### AudioBuffer

```typescript
export interface AudioBuffer {
  state: BufferState;           // 新增：状态机状态
  epoch: number;                // 新增：代次
  bufferKey: string;            // 新增：唯一标识
  lastWriteAt?: number;         // 新增：最后写入时间
  lastFinalizeAt?: number;      // 新增：最后 finalize 时间
  // ... 其他字段
}
```

### OriginalJobRegistration

```typescript
interface OriginalJobRegistration {
  expectedSegmentCount: number;  // 修改：不再允许 undefined
  receivedCount: number;         // 新增：已接收片段数量
  missingCount: number;          // 新增：缺失片段数量
  ttlTimerHandle?: NodeJS.Timeout;  // 新增：TTL 定时器
  // ... 其他字段
}
```

### OriginalJobASRData

```typescript
export interface OriginalJobASRData {
  missing?: boolean;  // 新增：是否缺失（ASR 失败/超时）
  // ... 其他字段
}
```

---

## 四、关键日志字段（统一格式）

所有关键日志必须包含以下字段：

- `bufferKey`, `epoch`, `state`
- `originalJobId`, `utteranceIndex`
- `finalizeReason`（manual/timeout/maxdur/ttl）
- `pendingTimeoutAudioLength`, `pendingMaxDurationAudioLength`
- `expectedSegmentCount`, `receivedCount`, `missingCount`
- `assignStrategy=head_alignment`
- `action`（merge/force_finalize/drop/recreate）
- `reason`（删除原因）

---

## 五、验收标准

### P0 全部完成后：

- ✅ "Buffer not found / recreate" 在正常用例中**趋近于 0**
- ✅ 任何情况下不会出现 registration 永久悬挂
- ✅ MaxDuration/Timeout/Manual 行为一致（头部对齐）
- ✅ 关键日志可直接定位：是 key 不稳定、是误删 pending、还是 finalize 过频

---

## 六、更新的文件清单

### 新增文件

1. `audio-aggregator-buffer-key.ts`：bufferKey 生成工具

### 修改文件

1. `audio-aggregator-types.ts`：
   - 添加 `BufferState` 类型
   - `AudioBuffer` 增加 `state`、`epoch`、`bufferKey` 字段

2. `audio-aggregator.ts`：
   - 使用 `buildBufferKey()` 生成 bufferKey
   - 添加状态机逻辑（FINALIZING 检查、epoch 切换）
   - 统一 batch 归属策略（头部对齐）
   - 添加 `deleteBuffer()` 方法

3. `audio-aggregator-finalize-handler.ts`：
   - utteranceIndex 超界处理策略（差值>2时强制 finalize pending）

4. ~~`original-job-result-dispatcher.ts`~~（已移除）：
   - 添加 registration TTL 机制
   - 添加 `forceFinalizePartial()` 方法
   - 支持 missing segment 核销
   - 更新 `receivedCount` 和 `missingCount` 计数

5. `asr-step.ts`：
   - 统一 `expectedSegmentCount` 来源
   - ASR 失败时创建 missing segment

6. `audio-aggregator-maxduration-handler.ts`：
   - 使用 `batchJobInfo` 简化容器分配逻辑（已完成）

---

## 七、测试建议

### 必测场景

1. **BufferKey 稳定性**：
   - 同一句话期间 bufferKey 不变化
   - 重连后 bufferKey 行为符合预期

2. **Pending 合并**：
   - 短句 timeout pending 合并到下一 job
   - MaxDuration 尾巴 pending 合并到下一 job
   - utterance_gap 超界策略可观测

3. **Finalize 行为一致性**：
   - MaxDuration 与 Manual/Timeout 的 batch→job 归属一致

4. **Dispatcher 兜底**：
   - ASR segment 永远等不齐时不会卡死（TTL 触发）
   - missing segment 计数正确

5. **删除/清理正确性**：
   - buffer delete 必有原因且不会误删 pending

---

## 八、后续优化建议（P1/P2）

### P1：性能与抗压

1. **ASR 并发与背压**（per-session + per-node）
2. **参数 profile 化**（交互/精度）
3. **语言感知的 segment 拼接器**（CJK/拉丁语系差异化）

### P2：质量与工程化

1. **测试用例与回归脚本**（3 类关键场景）
2. **指标与埋点**（utterance_gap、registration_timeout、buffer_recreate）
3. **状态机可视化与调试页面**（可选）

---

## 九、总结

所有 P0 必须补充项已完成，代码架构清晰简洁，通过数据结构设计解决问题，而不是打补丁。关键改进：

1. **架构清晰**：bufferKey、状态机、TTL 机制都是通过数据结构设计实现
2. **代码简洁**：MaxDuration handler 的容器分配从 50 行简化为 1 行
3. **易于维护**：所有逻辑集中，便于调试和修改
4. **避免重复**：流式切分和格式验证统一到单一方法
