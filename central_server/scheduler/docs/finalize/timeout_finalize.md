# Timeout Finalize 详细说明

**日期**: 2026-01-24  
**目的**: 详细说明 Timeout finalize 的触发条件、处理机制和节点端行为

---

## 一、调度服务器端

### 1.1 触发条件

**触发机制**:
- 长时间没有新的音频 chunk（超过 `pause_ms`，默认 3 秒）
- 通过计时器机制触发

**代码位置**: 
- 计时器重置: `actor_timers.rs:13-52`
- 超时处理: `actor_event_handling.rs:157-202`

**触发流程**:
1. 每次收到音频 chunk 后，调用 `reset_timers()` 重置计时器
2. 计时器等待 `pause_ms` 毫秒（默认 3 秒）
3. 如果期间没有新 chunk，触发 `TimeoutFired` 事件
4. `handle_timeout_fired()` 调用 `try_finalize(utterance_index, "Timeout")`

**关键代码**:
```rust
// 重置计时器
pub(crate) async fn reset_timers(&mut self) -> Result<(), anyhow::Error> {
    // 取消旧计时器
    self.cancel_timers();
    
    // 启动新计时器
    let handle = tokio::spawn(async move {
        sleep(Duration::from_millis(pause_ms)).await;
        
        // 检查时间戳是否仍然匹配（防止新 chunk 到达后触发旧超时）
        if let Some(last_ts) = state.audio_buffer.get_last_chunk_at_ms(&session_id).await {
            if last_ts != timestamp_ms {
                return; // 时间戳已更新，忽略本次超时
            }
        }
        
        // 发送超时事件
        let _ = event_tx.send(SessionEvent::TimeoutFired {
            generation,
            timestamp_ms,
        });
    });
}

// 处理超时事件
pub(crate) async fn handle_timeout_fired(&mut self, generation: u64, timestamp_ms: i64) -> Result<(), anyhow::Error> {
    // 检查 generation 和时间戳是否有效
    // ...
    
    let utterance_index = self.internal_state.current_utterance_index;
    self.try_finalize(utterance_index, "Timeout").await?;
    Ok(())
}
```

### 1.2 为什么 Timeout Finalize 会有音频数据？

**典型场景**:
1. ✅ **用户开始说话**：音频数据进入缓冲区（`audio_buffer.add_chunk()`）
2. ✅ **用户停止说话**：长时间没有新的 chunk（超过 `pause_ms`，默认 3 秒）
3. ✅ **超时触发 finalize**：计时器触发 `TimeoutFired` 事件
4. ✅ **此时缓冲区中可能有音频数据**（用户之前说的话）

**结论**:
- ✅ **Timeout finalize 不一定无音频**
- ✅ **Timeout finalize 可能有音频数据**（用户说了一些话，然后停止，超时触发）

### 1.3 处理逻辑

**代码位置**: `actor_finalize.rs:111-129`

```rust
// 获取音频数据
let audio_data = match self
    .state
    .audio_buffer
    .take_combined(&self.session_id, utterance_index)
    .await
{
    Some(data) if !data.is_empty() => data,
    _ => {
        warn!(
            session_id = %self.session_id,
            utterance_index = utterance_index,
            reason = reason,
            "Audio buffer empty, skipping finalize"
        );
        crate::metrics::on_empty_finalize();
        return Ok(false);  // ✅ 如果没有音频数据，跳过 finalize
    }
};
```

**处理逻辑**:
- ✅ 如果音频缓冲区为空，跳过 finalize（不创建 job）
- ✅ 如果有音频数据，创建 job 并派发到节点端

### 1.4 Session Affinity 处理

**代码位置**: `actor_finalize.rs:156-195`

```rust
// Session Affinity：手动/timeout finalize时立即清除timeout_node_id映射
if is_manual_cut || is_timeout_triggered {
    // 使用Lua脚本原子性地清除timeout_node_id
    // ...
}
```

**功能**:
- ✅ Timeout finalize 时，清除 `timeout_node_id` 映射
- ✅ 后续 job 可以使用随机分配

---

## 二、节点端处理

### 2.1 处理流程

**代码位置**: `audio-aggregator.ts:290-298`

```typescript
const shouldProcessNow =
  isManualCut ||  // 手动截断：立即处理
  isTimeoutTriggered ||  // 超时finalize，立即处理
  // ...
```

**流程**:
```
Timeout finalize (isTimeoutTriggered = true)
  ↓
shouldProcessNow = true（因为 isTimeoutTriggered = true）
  ↓
finalizeHandler.handleFinalize()
  - 如果有 pendingTimeoutAudio，合并它
  - 如果当前音频短（< 1秒）且没有合并，缓存到 pendingTimeoutAudio
  ↓
条件判断：
  - 如果合并了 pendingTimeoutAudio → 按能量切分 → 发送给 ASR
  - 如果缓存了短音频 → 返回空结果，等待下一个 job
  - 否则 → 按能量切分 → 发送给 ASR
```

### 2.2 对齐 Pause Finalize 行为

**对齐的行为**:

| 特性 | 对齐前（Timeout Finalize） | 对齐后（对齐 Pause Finalize） |
|------|-------------------------|---------------------------|
| **缓存机制** | 缓存所有音频到 `pendingTimeoutAudio` | ✅ 只缓存短音频（< 1秒）到 `pendingTimeoutAudio` |
| **处理时机** | 延迟处理（返回空结果，等待合并） | ✅ 立即处理（立即返回音频，发送给 ASR） |
| **实际效果** | 响应慢，等待下一个 job 合并 | ✅ 响应快，立即处理 |
| **TTL 机制** | ✅ 保留 10 秒 TTL | ✅ 保留 10 秒 TTL（不变） |

**关键修改**:
- ✅ 移除 timeout finalize 的特殊处理（返回空结果）
- ✅ 让 timeout finalize 走正常的立即处理流程
- ✅ 只缓存短音频（< 1秒）到 `pendingTimeoutAudio`

### 2.3 缓存逻辑

**代码位置**: `audio-aggregator-finalize-handler.ts`

```typescript
// 2. 如果当前timeout音频短且还没有缓存，保存到pendingTimeoutAudio
// 类似 pause finalize 的逻辑：只缓存短音频（< 1秒）
if (!hasMergedPendingAudio && !buffer.pendingTimeoutAudio && isTimeoutTriggered) {
  const currentDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
  
  // ✅ 关键：只有短音频（< 1秒）才缓存
  if (currentDurationMs < this.SHORT_AUDIO_THRESHOLD_MS) {
    shouldCachePendingTimeout = true;
  }
}
```

**缓存条件**:
- ✅ 当前音频短（< 1 秒）
- ✅ 没有合并 `pendingTimeoutAudio`
- ✅ 是 Timeout finalize

### 2.4 TTL 机制

**代码位置**: `audio-aggregator-timeout-handler.ts`

```typescript
// 检查 pendingTimeoutAudio 是否超过 TTL（10秒）
const ttlCheckResult = this.checkTimeoutTTL(buffer, job, currentAudio, nowMs);

if (ttlCheckResult && ttlCheckResult.shouldProcess) {
  // 超过 TTL，强制处理 pendingTimeoutAudio
  // ...
}
```

**TTL 机制**:
- ✅ `pendingTimeoutAudio` 有 10 秒 TTL
- ✅ 如果 10 秒内没有新的 job，强制处理 `pendingTimeoutAudio`
- ✅ 作为兜底机制，防止短音频一直缓存

---

## 三、典型场景

### 3.1 场景 1: 长音频 Timeout Finalize

```
T0: 用户说了一些话（音频 2 秒）
  ↓
T1: 用户停止说话，长时间没有新 chunk
  ↓
T2: 计时器等待 3 秒后，触发 Timeout finalize
  ↓
T3: 节点端收到 Timeout finalize job（音频 2 秒）
  ↓
T4: 缓存机制（How）
    - 不缓存（音频 ≥ 1秒）
  ↓
T5: 处理时机（When）
    - 立即处理音频
    - 按能量切分
  ↓
T6: 实际效果（What）
    - 音频立即发送给 ASR
    - 用户感受到快速响应
```

### 3.2 场景 2: 短音频 Timeout Finalize

```
T0: 用户说了一些话（音频 0.5 秒）
  ↓
T1: 用户停止说话，长时间没有新 chunk
  ↓
T2: 计时器等待 3 秒后，触发 Timeout finalize
  ↓
T3: 节点端收到 Timeout finalize job（音频 0.5 秒）
  ↓
T4: 缓存机制（How）
    - 缓存短音频到 pendingTimeoutAudio（0.5秒）
  ↓
T5: 处理时机（When）
    - 立即处理音频
    - 按能量切分
  ↓
T6: 实际效果（What）
    - 如果合并后的音频仍然 < 1秒，缓存到 pendingTimeoutAudio
    - 等待下一个 job 合并
    - 用户感受到快速响应（如果合并后 ≥ 1秒，立即处理）
```

### 3.3 场景 3: TTL 强制处理

```
T0: Timeout finalize 缓存短音频（0.5秒）到 pendingTimeoutAudio
  ↓
T1: 等待下一个 job...
  ↓
T2: 10 秒后，没有新的 job
  ↓
T3: TTL 机制触发，强制处理 pendingTimeoutAudio
  ↓
T4: 按能量切分，发送给 ASR
  ↓
T5: 返回结果
```

---

## 四、与 Pause Finalize 的对比

### 4.1 对齐的行为

| 特性 | Pause Finalize（备份） | Timeout Finalize（对齐后） |
|------|----------------------|-------------------------|
| **缓存机制** | 只缓存短音频（< 1秒） | ✅ 只缓存短音频（< 1秒） |
| **处理时机** | 立即处理 | ✅ 立即处理 |
| **实际效果** | 响应快 | ✅ 响应快 |

### 4.2 保留的差异（TTL 机制）

| 特性 | Pause Finalize（备份） | Timeout Finalize（对齐后） |
|------|----------------------|-------------------------|
| **TTL 机制** | ❌ 无 | ✅ 10 秒 TTL（保留） |

---

## 五、配置

### 5.1 调度服务器配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `pause_ms` | 3000ms | Timeout finalize 的触发阈值 |

### 5.2 节点端配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `SHORT_AUDIO_THRESHOLD_MS` | 1000ms | 短音频阈值（< 1秒） |
| `TIMEOUT_TTL_MS` | 10000ms | TTL 阈值（10 秒） |

---

## 六、相关文档

- [调度服务器 Finalize 类型和触发条件](./scheduler_finalize_types.md)
- [调度服务器 Finalize 处理逻辑](./scheduler_finalize_processing.md)
- [节点端 Finalize 处理流程](./node_finalize_processing.md)
- [MaxDuration Finalize](./maxduration_finalize.md)
