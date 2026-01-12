# Finalize 机制说明

## 问题确认

用户询问：**finalize 是固定周期操作，还是基于静音检测的？**

## 答案：基于静音检测，不是固定周期

### Finalize 触发条件

Finalize **不是固定周期操作**，而是基于以下条件触发：

1. **Pause（静音检测）** - 主要机制
   - 当两个 `audio_chunk` 之间的时间间隔超过 `pause_ms`（默认 **3000ms**）时触发
   - 检测逻辑：`record_chunk_and_check_pause` 比较当前 chunk 时间戳和上一个 chunk 时间戳
   - 如果间隔 > `pause_ms`，返回 `pause_exceeded = true`，触发 finalize

2. **Timeout（超时机制）**
   - 如果 `pause_ms > 0`，每次收到新的 chunk 时会启动/重置超时计时器
   - 如果在 `pause_ms` 时间内没有收到新的 chunk，超时计时器会触发 `TimeoutFired` 事件
   - 这也会触发 finalize（原因：`"Timeout"`）

3. **MaxDuration（最大时长限制）**
   - 当累积音频时长超过 `max_duration_ms`（默认 **20000ms**）时触发
   - 这是异常保护机制，防止音频无限累积

4. **IsFinal（手动截断）**
   - 当收到 `is_final=true` 的音频块时触发
   - 这是 Web 端主动发送的截断信号

5. **MaxLength（异常保护）**
   - 当音频缓冲区超过 **500KB** 时触发
   - 这是极端情况下的异常保护，正常情况下不会触发

### 关键代码位置

```rust
// central_server/scheduler/src/websocket/session_actor/actor.rs
// 步骤2：检查暂停是否超过阈值（在添加音频块之后）
let pause_exceeded = self.state
    .audio_buffer
    .record_chunk_and_check_pause(&self.session_id, timestamp_ms, self.pause_ms)
    .await;

// 检查 pause_exceeded
if pause_exceeded {
    should_finalize = true;
    finalize_reason = "Pause";
}
```

```rust
// central_server/scheduler/src/managers/audio_buffer.rs
pub async fn record_chunk_and_check_pause(&self, session_id: &str, now_ms: i64, pause_ms: u64) -> bool {
    let mut map = self.last_chunk_at_ms.write().await;
    let exceeded = map
        .get(session_id)
        .map(|prev| now_ms.saturating_sub(*prev) > pause_ms as i64)
        .unwrap_or(false);
    map.insert(session_id.to_string(), now_ms);
    exceeded
}
```

## 关于"拼回"被分开的 Utterance

### 当前实现状态

**重要发现**：虽然系统有 `context_text` 机制，但目前**还没有真正用于"拼回"被分开的 utterance**。

### Context Text 的生成和传递

1. **生成时机**：
   - `context_text` 是在 **ASR Final 之后**，通过 `group_manager.on_asr_final` 生成的
   - 它包含之前 utterance 的 ASR 文本和翻译文本

2. **传递时机**：
   - `context_text` 是用于**下一个** utterance 的，而不是当前这个 utterance
   - 在 `do_finalize` 中调用 `create_job_assign_message` 时，传递的是 `None, None, None`
   - 这意味着当前 utterance 创建 job 时，`context_text` 是 `None`

3. **节点端使用**：
   - 即使传递了 `context_text`，节点端的 ASR 服务也不会使用它来"拼回"被分开的 utterance
   - 从 `task-router.ts` 来看：
     - `use_text_context = true`（保留文本上下文，这是 Faster Whisper 的标准功能）
     - 但是 `condition_on_previous_text = false`（避免重复识别）
   - `context_text` 主要用于**坏段检测**（`detectBadSegment`），而不是用于"拼回"

### 潜在问题

如果一段话在中间有停顿（比如思考、换气），可能会被错误地 finalize 分开：

1. **场景**：用户说"我想...（停顿 3 秒）...去北京"
2. **结果**：
   - 第一个 utterance：`utterance_index=0`，文本："我想"
   - 第二个 utterance：`utterance_index=1`，文本："去北京"
3. **当前行为**：
   - 两个 utterance 会分别发送到节点端进行 ASR
   - 节点端会分别识别，不会自动"拼回"
   - `context_text` 虽然会传递上一个 utterance 的文本，但主要用于坏段检测，而不是用于"拼回"

### 改进建议

如果需要实现"拼回"功能，需要：

1. **在 finalize 时传递 context_text**：
   - 在 `do_finalize` 中，从 `group_manager` 获取之前的 `context_text`
   - 传递给 `create_job_assign_message`

2. **节点端启用上下文拼接**：
   - 在 `task-router.ts` 中，根据 `context_text` 的存在，启用 `use_text_context` 和 `condition_on_previous_text`
   - 但这可能会导致重复识别问题（当上下文文本和当前音频内容相同时）

3. **更智能的拼接策略**：
   - 检测当前音频是否与上下文文本重叠
   - 如果重叠，使用上下文辅助识别；如果不重叠，正常识别

## 总结

1. **Finalize 是基于静音检测的，不是固定周期**：当两个 audio_chunk 之间的时间间隔超过 `pause_ms`（默认 3000ms）时触发。

2. **即使一段话被 finalize 分开，节点端目前也不会自动"拼回"**：
   - `context_text` 主要用于坏段检测，而不是用于"拼回"
   - 节点端的 `use_text_context` 和 `condition_on_previous_text` 默认都是 `false` 或谨慎使用

3. **如果需要在节点端"拼回"被分开的 utterance**，需要：
   - 在 finalize 时传递 `context_text`
   - 节点端启用上下文拼接功能
   - 注意避免重复识别问题

