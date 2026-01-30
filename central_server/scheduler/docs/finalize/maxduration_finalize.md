# MaxDuration Finalize 详细说明

**日期**: 2026-01-24  
**目的**: 详细说明 MaxDuration finalize 的触发条件、处理机制和节点端行为

---

## 一、调度服务器端

### 1.1 触发条件

**触发条件**:
- 累积音频时长超过 `max_duration_ms`（默认 10 秒）

**代码位置**: `actor_event_handling.rs:83-94`

```rust
// 检查最大时长限制
if self.max_duration_ms > 0 && self.internal_state.accumulated_audio_duration_ms >= self.max_duration_ms {
    tracing::warn!(
        session_id = %self.session_id,
        utterance_index = utterance_index,
        accumulated_duration_ms = self.internal_state.accumulated_audio_duration_ms,
        max_duration_ms = self.max_duration_ms,
        "Audio duration exceeded max limit, auto-finalizing"
    );
    should_finalize = true;
    finalize_reason = "MaxDuration";
}
```

**特点**:
- ✅ 主动触发（在收到 chunk 时检查累积时长）
- ✅ 保护机制（防止超长语音导致缓冲区过大）
- ✅ 节点端会重新拼接（正常业务逻辑）

**典型场景**:
- 用户持续说话超过 10 秒
- 调度服务器自动截断，创建 job
- 节点端会按能量切片处理前 5+ 秒，缓存剩余部分等待下一个 job

**配置**:
- `max_duration_ms`: 默认 10000ms（10 秒），可通过配置调整

### 1.2 设置标识

**代码位置**: `actor_finalize.rs:148-153`

```rust
// 根据 finalize 原因设置标识
let is_manual_cut = reason == "IsFinal";
// ✅ 修复：MaxDuration 使用独立的标签，不与 timeout 混用
let is_timeout_triggered = reason == "Timeout";
// MaxDuration：用户持续说话超过最大时长，产生多 job；节点端按切片处理
let is_max_duration_triggered = reason == "MaxDuration";
```

**关键修复**:
- ✅ MaxDuration 使用独立的标签（`is_max_duration_triggered`），不与 timeout 混用
- ✅ 这个标识会传递给节点端，用于不同的处理逻辑

### 1.3 Session Affinity（节点绑定）

**代码位置**: `actor_finalize.rs:269-323`

```rust
// ============================================================
// Session Affinity：MaxDuration finalize 时记录 sessionId->nodeId 映射
// 连续长语音产生多 job，需路由到同一节点
// ============================================================
if is_max_duration_triggered {
    // 获取第一个job的node_id（如果有）
    if let Some(first_job) = jobs.first() {
        if let Some(ref node_id) = first_job.assigned_node_id {
            // 记录sessionId->nodeId映射到Redis
            if let Some(ref rt) = self.state.phase2 {
                let session_key = format!("scheduler:session:{}", self.session_id);
                let ttl_seconds = 5 * 60; // 5分钟TTL（优化：符合业务逻辑，避免长期缓存）
                
                // ✅ 修复：MaxDuration 使用独立的 Redis key，不与 timeout 混用
                // 使用Lua脚本原子性地设置max_duration_node_id
                let script = r#"
redis.call('HSET', KEYS[1], 'max_duration_node_id', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"#;
                // ...
            }
        }
    }
}
```

**功能**:
- ✅ MaxDuration finalize 时，记录 `max_duration_node_id` 映射
- ✅ 使用独立的 Redis key（`max_duration_node_id`），不与 timeout 混用
- ✅ 设置 5 分钟 TTL，避免长期缓存
- ✅ 后续 MaxDuration job 会路由到同一个节点

**目的**:
- 连续长语音产生多个 MaxDuration job，需要路由到同一节点
- 节点端会按能量切片处理前 5+ 秒，缓存剩余部分等待下一个 job
- 确保所有 MaxDuration job 都在同一个节点处理，便于合并

---

## 二、节点端处理

### 2.1 处理流程

**代码位置**: `audio-aggregator.ts:303-380`

```typescript
// 特殊处理：MaxDuration finalize
if (isMaxDurationTriggered && buffer) {
  const maxDurationResult = this.maxDurationHandler.handleMaxDurationFinalize(
    buffer,
    job,
    currentAudio,
    nowMs,
    this.aggregateAudioChunks.bind(this),
    this.createStreamingBatchesWithPending.bind(this)
  );
  
  // ✅ 状态机：进入 PENDING_MAXDUR 状态
  if (maxDurationResult.remainingAudio) {
    buffer.state = 'PENDING_MAXDUR';
  }
  
  // ✅ 修复：清空当前缓冲区（但保留 pendingMaxDurationAudio，如果有剩余部分）
  buffer.audioChunks = [];
  buffer.totalDurationMs = 0;
  buffer.originalJobInfo = [];
  
  if (maxDurationResult.shouldProcess && maxDurationResult.audioSegments) {
    // 有≥5秒的音频需要处理，返回处理后的音频段
    return {
      audioSegments: maxDurationResult.audioSegments.map(seg => seg.toString('base64')),
      originalJobIds: maxDurationResult.originalJobIds,
      shouldReturnEmpty: false,
    };
  } else {
    // 没有≥5秒的音频，返回空结果，等待下一个 job
    return {
      audioSegments: [],
      shouldReturnEmpty: true,
      isTimeoutPending: true,
    };
  }
}
```

**流程**:
```
MaxDuration finalize (isMaxDurationTriggered = true)
  ↓
独立处理路径（在 shouldProcessNow 之前）
  ↓
maxDurationHandler.handleMaxDurationFinalize()
  - 如果有 pendingTimeoutAudio，合并它
  - 按能量切片，处理前5秒（及以上）音频
  - 剩余部分缓存到 pendingMaxDurationAudio
  ↓
返回处理后的音频段（如果有≥5秒音频）
  ↓
等待下一个 job 合并剩余部分
```

### 2.2 处理逻辑

**核心逻辑**:
1. **合并 pendingTimeoutAudio**（如果有）
2. **按能量切片**，处理前 5+ 秒音频
3. **缓存剩余部分**到 `pendingMaxDurationAudio`

**代码位置**: `audio-aggregator-maxduration-handler.ts`

```typescript
// MaxDuration finalize 的处理逻辑：
// 1. 合并 pendingTimeoutAudio（如果有）
// 2. 按能量切片，处理前5秒（及以上）音频
// 3. 剩余部分缓存到 pendingMaxDurationAudio

// 缓存剩余部分（无条件）
buffer.pendingMaxDurationAudio = remainingAudio;
buffer.pendingMaxDurationAudioCreatedAt = nowMs;
buffer.pendingMaxDurationJobInfo = [...buffer.originalJobInfo];
```

### 2.3 缓存机制

**缓存特点**:
- ✅ 无条件缓存剩余部分（没有时长限制）
- ✅ 没有 TTL 机制（因为最终会有手动/timeout finalize 收尾）
- ✅ 使用独立的缓存字段（`pendingMaxDurationAudio`），不与 `pendingTimeoutAudio` 混用

**为什么没有 TTL**:
- MaxDuration finalize 最终都会有且必须要有一个手动/timeout finalize 的 job 进行收尾
- 不需要 TTL 机制来掩盖问题
- 如果一直没有手动/timeout finalize，说明系统有问题，应该修复而不是用 TTL 掩盖

### 2.4 与下一个 Job 的合并

**场景 1**: 下一个 job 也是 MaxDuration finalize

```
MaxDuration job 1: 处理前5秒，缓存剩余部分
  ↓
MaxDuration job 2: 合并 job 1 的剩余部分 + job 2 的音频
  ↓
按能量切片，处理前5秒，缓存新的剩余部分
  ↓
继续等待下一个 job...
```

**场景 2**: 下一个 job 是手动/timeout finalize

```
MaxDuration job 1: 处理前5秒，缓存剩余部分
  ↓
手动/timeout finalize job 2: 合并 job 1 的剩余部分 + job 2 的音频
  ↓
按能量切分，全部处理，不缓存
  ↓
返回结果
```

### 2.5 Head Alignment 策略

**策略说明**:
- 每个 ASR 批次应该使用**第一个切片的 job 容器**进行聚合
- 只有最后一个 job（手动/timeout finalize）使用**它自己的容器**

**目的**:
- 确保切片数量不会超过 job 容器数量
- 不会产生文本丢失的情况
- 使最终返回结果更完整，用户体验更好

**代码位置**: `audio-aggregator.ts:408`

```typescript
// 统一批次分配：所有 finalize 类型都使用相同的逻辑
const originalJobIds = batchJobInfo.map(info => info.jobId);
```

---

## 三、典型场景

### 3.1 场景 1: 35 秒长语音

```
T0: 用户开始说话（35 秒长语音）
  ↓
T1: 调度服务器检测到累积时长超过 10 秒，触发 MaxDuration finalize
  ↓
T2: 创建 job 0（10 秒音频），路由到节点 A
  ↓
T3: 节点 A 收到 job 0
  - 按能量切片，处理前 5 秒
  - 缓存剩余 5 秒到 pendingMaxDurationAudio
  ↓
T4: 调度服务器继续检测，触发 MaxDuration finalize
  ↓
T5: 创建 job 1（10 秒音频），路由到节点 A（Session Affinity）
  ↓
T6: 节点 A 收到 job 1
  - 合并 job 0 的剩余部分（5 秒）+ job 1 的音频（10 秒）= 15 秒
  - 按能量切片，处理前 5 秒
  - 缓存剩余 10 秒到 pendingMaxDurationAudio
  ↓
T7: 继续处理...
  ↓
T8: 用户停止说话，触发手动/timeout finalize
  ↓
T9: 创建 job 3（最后 5 秒音频），路由到节点 A
  ↓
T10: 节点 A 收到 job 3
  - 合并所有 pendingMaxDurationAudio + job 3 的音频
  - 按能量切分，全部处理
  - 返回结果
```

### 3.2 场景 2: 连续 MaxDuration Job

```
MaxDuration job 1: 10 秒音频
  - 处理前 5 秒 → ASR 批次 1（使用 job 1 的容器）
  - 缓存剩余 5 秒

MaxDuration job 2: 10 秒音频
  - 合并 job 1 的剩余部分（5 秒）+ job 2 的音频（10 秒）= 15 秒
  - 处理前 5 秒 → ASR 批次 2（使用 job 1 的容器，head alignment）
  - 缓存剩余 10 秒

MaxDuration job 3: 10 秒音频
  - 合并 job 2 的剩余部分（10 秒）+ job 3 的音频（10 秒）= 20 秒
  - 处理前 5 秒 → ASR 批次 3（使用 job 1 的容器，head alignment）
  - 缓存剩余 15 秒

手动/timeout finalize job 4: 5 秒音频
  - 合并 job 3 的剩余部分（15 秒）+ job 4 的音频（5 秒）= 20 秒
  - 按能量切分，全部处理 → ASR 批次 4（使用 job 4 的容器）
  - 返回结果
```

---

## 四、与 Timeout Finalize 的区别

### 4.1 关键差异

| 特性 | Timeout Finalize | MaxDuration Finalize |
|------|-----------------|---------------------|
| **触发条件** | 长时间无新 chunk（用户停止说话） | 累积时长超过限制（用户持续说话） |
| **处理方式** | 立即处理（大部分情况） | 部分处理（前 5+ 秒） |
| **缓存机制** | 短音频（< 1秒）才缓存 | 剩余部分无条件缓存 |
| **TTL 机制** | ✅ 10 秒 TTL | ❌ 无 TTL |
| **Session Affinity** | 清除映射（允许随机分配） | 记录映射（路由到同一节点） |
| **Redis Key** | `timeout_node_id` | `max_duration_node_id` |
| **处理路径** | `shouldProcessNow` | 独立路径（在 `shouldProcessNow` 之前） |

### 4.2 业务逻辑差异

**Timeout Finalize**:
- 用户停止说话，长时间无新 chunk
- 表示句子结束
- 需要立即处理，响应快

**MaxDuration Finalize**:
- 用户持续说话，超过最大时长
- 表示句子被截断，还有后续内容
- 需要部分处理，等待后续 job 合并

---

## 五、配置

### 5.1 调度服务器配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `max_duration_ms` | 10000ms | MaxDuration finalize 的触发阈值 |
| `max_duration_node_id TTL` | 300s | Session Affinity 的 TTL（5 分钟） |

### 5.2 节点端配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `MIN_SLICE_DURATION_MS` | 5000ms | 最小切片时长（5 秒） |

---

## 六、相关文档

- [调度服务器 Finalize 类型和触发条件](./scheduler_finalize_types.md)
- [调度服务器 Finalize 处理逻辑](./scheduler_finalize_processing.md)
- [节点端 Finalize 处理流程](./node_finalize_processing.md)
- [Timeout Finalize](./timeout_finalize.md)
- [节点端音频处理和 ASR 结果聚合](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/architecture_and_flow.md)
