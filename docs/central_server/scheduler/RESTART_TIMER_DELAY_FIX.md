# RestartTimer延迟导致的pause finalize误触发 - 修复

## 修复日期
2026-01-17

## 问题描述

用户发现：**用户一直连续说话，根本没有停顿**，但调度服务器却检测到了pause并触发了finalize。

**根本原因**：RestartTimer和音频chunk的时序竞争导致pause检测误触发。

### 问题场景

**场景**：
```
上一个utterance的最后一个chunk (t1)
  ↓
TTS播放完成，Web端发送TTS_PLAY_ENDED (t2)
  ↓
用户立即开始说话（没有停顿）
  ↓
Web端延迟500ms，缓存音频 (t2 + 500ms)
  ↓
延迟结束，发送第一批音频chunk (t2 + 500ms)
  ↓
【问题】如果RestartTimer在t2 + 500ms之后才到达
  ↓
pause检测：t2 + 500ms - t1 > 3000ms（距离上一个utterance的最后一个chunk）
  ↓
【触发pause finalize】❌ 错误！
```

**连续pause finalize的原因**：
- 如果用户在连续说话过程中，有多个TTS播放完成事件
- 每次播放完成后，如果RestartTimer未及时到达，就会触发pause finalize
- 导致连续的pause finalize（Job 4→7, Job 8→11）

---

## 修复方案

### 修复位置
**文件**: `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs`
**位置**: 第79-155行（pause检测逻辑）

### 修复内容

**改进pause检测逻辑**：
1. 检查是否是刚finalize后的新utterance的第一个chunk
2. 如果是新utterance的第一个chunk，且时间差<5秒，可能是RestartTimer延迟，不应该触发pause finalize
3. 给RestartTimer足够的延迟容忍度（5秒）

### 修复后的代码逻辑

```rust
// 修复：检查是否是刚finalize后的新utterance的第一个chunk
// 如果时间差<5秒，可能是RestartTimer延迟，不应该触发pause finalize
let is_first_chunk_after_finalize = utterance_index > self.internal_state.current_utterance_index;
let pause_duration_ms = last_chunk_at.map(|prev| timestamp_ms - prev).unwrap_or(0);
const RESTART_TIMER_DELAY_TOLERANCE_MS: i64 = 5000; // RestartTimer延迟容忍度：5秒

// 如果是新utterance的第一个chunk，且时间差<5秒，可能是RestartTimer延迟，不触发pause finalize
let should_ignore_pause_due_to_restart_timer_delay = 
    is_first_chunk_after_finalize && 
    pause_duration_ms > self.pause_ms as i64 && 
    pause_duration_ms < RESTART_TIMER_DELAY_TOLERANCE_MS;

if pause_exceeded_result {
    if should_ignore_pause_due_to_restart_timer_delay {
        // 不触发pause finalize，记录日志
        false
    } else {
        // 正常触发pause finalize
        pause_exceeded_result
    }
}
```

### 关键检查点

1. **`is_first_chunk_after_finalize`**：
   - 检查`utterance_index > current_utterance_index`
   - 说明这是刚finalize后的新utterance的第一个chunk

2. **时间差检查**：
   - `pause_duration_ms > pause_ms`：确实超过了pause阈值（>3秒）
   - `pause_duration_ms < 5秒`：但在RestartTimer延迟容忍度内

3. **不触发pause finalize**：
   - 如果满足上述条件，不触发pause finalize
   - 记录日志说明原因

---

## 修复效果

修复后：
- ✅ 如果音频chunk在RestartTimer之前到达（或RestartTimer延迟），且是新utterance的第一个chunk，时间差<5秒，不触发pause finalize
- ✅ 避免连续pause finalize的问题
- ✅ 用户连续说话时，不会因为RestartTimer时序问题而触发pause finalize

**预期效果**：
- Job 4~7：如果Job 7是新utterance的第一个chunk，且时间差<5秒，不触发pause finalize
- Job 8~11：如果Job 11是新utterance的第一个chunk，且时间差<5秒，不触发pause finalize
- 避免错误切分导致的重复翻译

---

## 相关文件

- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - 已修复
- `docs/central_server/scheduler/restart_flow_summary.md` - RestartTimer流程说明
- `docs/electron_node/JOB_8_11_MERGE_ROOT_CAUSE.md` - 合并问题根本原因分析
