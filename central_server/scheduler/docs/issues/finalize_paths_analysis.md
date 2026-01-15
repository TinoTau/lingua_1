# 调度服务器 Finalize 路径分析

## Finalize 触发路径总览

调度服务器中有 **6 个路径**可以触发 finalize：

1. **Pause** - 暂停超过阈值（默认 3 秒）
2. **Timeout** - 超时触发（pause_ms 计时器到期）
3. **IsFinal** - 收到 `is_final=true` 消息
4. **MaxDuration** - 音频时长超过限制（默认 20 秒）
5. **MaxLength** - 音频缓冲区超过异常保护限制（500KB）
6. **SessionClose** - 会话关闭时强制 finalize

---

## 路径 1: Pause Finalize

### 触发条件
- 在 `handle_audio_chunk` 中，当收到实际音频内容（`chunk_size > 0`）时
- 调用 `record_chunk_and_check_pause()` 检查暂停时长
- 如果 `当前时间 - 上次chunk时间 > pause_ms`（默认 3000ms），触发 finalize

### 流程
1. **`handle_audio_chunk`**：
   - 添加音频 chunk 到缓冲区
   - 更新 `last_chunk_at_ms`
   - 调用 `record_chunk_and_check_pause()` 检查暂停
   - 如果 `pause_exceeded = true`，设置 `finalize_reason = "Pause"`

2. **`try_finalize(utterance_index, "Pause")`**：
   - 检查是否可以 finalize（去重检查）
   - 检查是否播放已完成（`playback_finished`）
   - 进入 finalizing 状态
   - 判断 finalize 类型：`FinalizeType::Auto`
   - 应用 Hangover 延迟（`hangover_auto_ms`）
   - 调用 `do_finalize()`

3. **`do_finalize()`**：
   - 获取音频数据（`take_combined`）
   - 如果缓冲区为空，返回 `false`（不递增 utterance_index）
   - 设置 `is_pause_triggered = true`
   - 创建翻译任务（ASR + NMT + TTS）
   - 派发任务到节点

4. **完成**：
   - 递增 `utterance_index`
   - 重置状态（`pending_short_audio`、`accumulated_audio_duration_ms` 等）
   - 重置计时器（如果还有后续 chunk）

---

## 路径 2: Timeout Finalize

### 触发条件
- 在 `reset_timers()` 中启动的计时器到期
- 计时器检查 `generation` 和时间戳是否匹配
- 如果匹配，发送 `TimeoutFired` 事件

### 流程
1. **`handle_timeout_fired`**：
   - 检查 `generation` 是否有效（防止过期计时器）
   - 检查时间戳是否匹配（防止旧计时器触发）
   - 如果 `audio_buffer` 中没有时间戳，忽略（可能已 finalize）
   - 调用 `try_finalize(utterance_index, "Timeout")`

2. **`try_finalize(utterance_index, "Timeout")`**：
   - 判断 finalize 类型：`FinalizeType::Auto`
   - 应用 Hangover 延迟（`hangover_auto_ms`）
   - 调用 `do_finalize()`

3. **`do_finalize()`**：
   - 设置 `is_timeout_triggered = true`
   - 创建翻译任务
   - 派发任务到节点

4. **完成**：同 Pause Finalize

---

## 路径 3: IsFinal Finalize

### 触发条件
- 在 `handle_audio_chunk` 中，当收到 `is_final=true` 的音频 chunk 时
- 可以是空的 chunk（用于手动触发 finalize）

### 流程
1. **`handle_audio_chunk`**：
   - 添加音频 chunk 到缓冲区（即使是空的）
   - 如果 `is_final = true`，设置 `finalize_reason = "IsFinal"`
   - 注意：空的 `is_final=true` 不用于 pause 检测

2. **`try_finalize(utterance_index, "IsFinal")`**：
   - 判断 finalize 类型：`FinalizeType::Manual`
   - 应用 Hangover 延迟（`hangover_manual_ms`）
   - 调用 `do_finalize()`

3. **`do_finalize()`**：
   - 设置 `is_manual_cut = true`
   - 创建翻译任务
   - 派发任务到节点

4. **完成**：同 Pause Finalize

---

## 路径 4: MaxDuration Finalize

### 触发条件
- 在 `handle_audio_chunk` 中，累积音频时长超过 `max_duration_ms`（默认 20000ms）
- 每次收到 chunk 时，累积 `chunk_duration_ms` 到 `accumulated_audio_duration_ms`

### 流程
1. **`handle_audio_chunk`**：
   - 累积音频时长：`accumulated_audio_duration_ms += chunk_duration_ms`
   - 如果 `accumulated_audio_duration_ms >= max_duration_ms`，设置 `finalize_reason = "MaxDuration"`

2. **`try_finalize(utterance_index, "MaxDuration")`**：
   - 判断 finalize 类型：`FinalizeType::Auto`
   - 应用 Hangover 延迟（`hangover_auto_ms`）
   - 调用 `do_finalize()`

3. **`do_finalize()`**：
   - 设置 `is_timeout_triggered = true`（与 Timeout 相同）
   - 创建翻译任务
   - 派发任务到节点

4. **完成**：同 Pause Finalize

---

## 路径 5: MaxLength Finalize（异常保护）

### 触发条件
- 在 `add_chunk()` 中，音频缓冲区总大小超过 500KB
- 这是异常保护机制，正常情况下不应该触发

### 流程
1. **`handle_audio_chunk`**：
   - 调用 `add_chunk()` 返回 `should_finalize_due_to_length`
   - 如果为 `true`，设置 `finalize_reason = "MaxLength"`

2. **`try_finalize(utterance_index, "MaxLength")`**：
   - 判断 finalize 类型：`FinalizeType::Exception`
   - 不应用 Hangover 延迟（异常情况）
   - 调用 `do_finalize()`

3. **`do_finalize()`**：
   - 创建翻译任务
   - 派发任务到节点

4. **完成**：同 Pause Finalize

---

## 路径 6: SessionClose Finalize

### 触发条件
- 会话关闭时，强制 finalize 当前 utterance（如果有数据）

### 流程
1. **`handle_close()`**：
   - 获取当前 `utterance_index`
   - 调用 `try_finalize(utterance_index, "SessionClose")`

2. **`try_finalize(utterance_index, "SessionClose")`**：
   - 判断 finalize 类型：`FinalizeType::Exception`
   - 不应用 Hangover 延迟
   - 调用 `do_finalize()`

3. **`do_finalize()`**：
   - 如果缓冲区为空，返回 `false`（不递增 utterance_index）
   - 创建翻译任务
   - 派发任务到节点

4. **完成**：
   - 设置状态为 `Closed`
   - 不再处理新的事件

---

## 共同流程：try_finalize

所有路径都会经过 `try_finalize()`，共同步骤：

1. **去重检查**：`can_finalize(utterance_index)`
   - 检查是否已经 finalize 或正在 finalize
   - 检查 `utterance_index` 是否匹配

2. **播放完成检查**：`is_playback_finished()`
   - 如果播放已完成，直接返回 `false`（不开始 finalize）

3. **进入 finalizing 状态**：`enter_finalizing(utterance_index)`
   - 设置 `state = Finalizing`
   - 设置 `finalize_inflight = Some(utterance_index)`

4. **判断 finalize 类型**：`FinalizeType::from_reason(reason)`
   - `Manual`: IsFinal
   - `Auto`: Pause, Timeout, MaxDuration
   - `Exception`: MaxLength, SessionClose

5. **应用 Hangover 延迟**：
   - `Manual`: `hangover_manual_ms`
   - `Auto`: `hangover_auto_ms`
   - `Exception`: 0（不延迟）

6. **执行 finalize**：`do_finalize()`

7. **完成或失败**：
   - 成功：递增 `utterance_index`，重置状态
   - 失败：恢复状态为 `Idle`

---

## 共同流程：do_finalize

所有路径都会经过 `do_finalize()`，共同步骤：

1. **获取会话信息**

2. **获取音频数据**：`take_combined(utterance_index)`
   - 如果缓冲区为空，返回 `false`（不递增 utterance_index）

3. **设置 finalize 标识**：
   - `is_manual_cut`: IsFinal
   - `is_pause_triggered`: Pause
   - `is_timeout_triggered`: Timeout, MaxDuration

4. **创建翻译任务**：`create_translation_jobs()`
   - ASR Job
   - NMT Job
   - TTS Job

5. **派发任务到节点**：
   - 检查是否已派发（幂等）
   - 发送 `JobAssign` 消息到节点
   - 标记任务为已分发

6. **返回 `true`**（成功）或 `false`（失败）

---

## Finalize 类型和 Hangover 延迟

| Finalize 类型 | 触发原因 | Hangover 延迟 |
|--------------|---------|--------------|
| Manual | IsFinal | `hangover_manual_ms` |
| Auto | Pause, Timeout, MaxDuration | `hangover_auto_ms` |
| Exception | MaxLength, SessionClose | 0（不延迟） |

---

## 关键检查点

1. **去重检查**：防止重复 finalize 同一个 `utterance_index`
2. **播放完成检查**：防止播放完成后立即触发 finalize
3. **空缓冲区检查**：如果缓冲区为空，不 finalize（避免 utterance_index 跳过）
4. **Generation 检查**：Timeout 路径检查计时器 generation 是否有效
5. **时间戳检查**：Timeout 路径检查时间戳是否匹配

---

## 状态变化

### Finalize 成功
- `current_utterance_index += 1`
- `state = Idle`
- `finalize_inflight = None`
- 重置 `pending_short_audio`、`accumulated_audio_duration_ms` 等

### Finalize 失败
- `state = Idle`
- `finalize_inflight = None`
- `utterance_index` 不变（后续 chunk 继续使用当前 index）
