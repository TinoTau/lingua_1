# 音频处理流程详细分析

## 一、Web端音频发送流程

### 1.1 手动发送音频（用户点击"发送"按钮）

**触发路径：**
```
用户点击"发送"按钮 
→ App.sendCurrentUtterance() 
→ SessionManager.sendCurrentUtterance()
```

**详细流程：**

1. **SessionManager.sendCurrentUtterance()** (`session_manager.ts:167-235`)
   - 检查状态：必须在 `INPUT_RECORDING` 且会话活跃
   - 如果有剩余音频缓冲区（`audioBuffer.length > 0`）：
     - 合并剩余音频：`concatAudioBuffers(this.audioBuffer)`
     - 发送音频块：`wsClient.sendAudioChunk(audioData, false)` （is_final=false）
     - 标记已发送：`hasSentAudioChunksForCurrentUtterance = true`
     - 清空缓冲区：`audioBuffer = []`
   - 如果之前已发送过音频块（`hasSentAudioChunksForCurrentUtterance = true`）：
     - 发送 finalize：`wsClient.sendFinal()` （发送空的 is_final=true）
     - 递增 utterance_index：`currentUtteranceIndex++`
     - 重置标志：`hasSentAudioChunksForCurrentUtterance = false`
   - 如果音频缓冲区为空且没有发送过音频块：跳过发送（避免空 finalize）

2. **WebSocketClient.sendFinal()** (`websocket_client.ts:313-318`)
   - 调用 `audioSender.sendFinal()`

3. **AudioSender.sendFinal()** (`audio_sender.ts:249-286`)
   - Binary Frame 模式：发送 `FINAL` 帧（`BinaryFrameType.FINAL`）
   - JSON 模式：发送空的 `audio_chunk` 消息，`is_final=true`，`payload=''`

### 1.2 自动发送音频（持续录音，每100ms发送一次）

**触发路径：**
```
Recorder.onAudioFrame() 
→ SessionManager.onAudioFrame()
→ WebSocketClient.sendAudioChunk()
→ AudioSender.sendAudioChunk()
```

**详细流程：**

1. **SessionManager.onAudioFrame()** (`session_manager.ts:240-301`)
   - 检查状态：必须在 `INPUT_RECORDING`
   - 检查等待标志：如果 `isWaitingForPlaybackFinalize = true`：
     - 只缓存音频数据，不发送（等待播放完成后的 sendFinal 先到达）
     - 返回
   - 缓存音频数据：`audioBuffer.push(audioData)`
   - 自动发送逻辑（每10帧=100ms）：
     - 如果 `audioBuffer.length >= 10`：
       - 合并前10帧：`concatAudioBuffers(this.audioBuffer.splice(0, 10))`
       - 发送音频块：`wsClient.sendAudioChunk(chunk, false)` （is_final=false）
       - 标记已发送：`hasSentAudioChunksForCurrentUtterance = true`
       - 记录首次发送延迟（如果之前有播放结束时间戳）

2. **WebSocketClient.sendAudioChunk()** (`websocket_client.ts:301-307`)
   - 调用 `audioSender.sendAudioChunk(audioData, isFinal)`

3. **AudioSender.sendAudioChunk()** (`audio_sender.ts:71-92`)
   - 检查背压状态：
     - 如果暂停：加入队列
     - 如果降速：加入队列
     - 正常：直接发送
   - 调用 `sendAudioChunkInternal()`

4. **AudioSender.sendAudioChunkInternal()** (`audio_sender.ts:106-243`)
   - Binary Frame 模式：编码音频 → 发送 `AUDIO_CHUNK` 帧
   - JSON 模式：编码音频 → 发送 `audio_chunk` 消息，`is_final=false`

### 1.3 静音检测触发发送

**触发路径：**
```
Recorder.onSilenceDetected() 
→ SessionManager.onSilenceDetected()
```

**详细流程：**

1. **SessionManager.onSilenceDetected()** (`session_manager.ts:306-335`)
   - 检查状态：必须在 `INPUT_RECORDING`
   - 如果有剩余音频缓冲区：
     - 合并并发送：`wsClient.sendAudioChunk(chunk, false)`
     - 标记已发送：`hasSentAudioChunksForCurrentUtterance = true`
     - 发送 finalize：`wsClient.sendFinal()`
     - 递增 utterance_index：`currentUtteranceIndex++`
     - 重置标志：`hasSentAudioChunksForCurrentUtterance = false`
   - 如果音频缓冲区为空但之前已发送过音频块：
     - 发送 finalize：`wsClient.sendFinal()`
     - 递增 utterance_index：`currentUtteranceIndex++`
     - 重置标志：`hasSentAudioChunksForCurrentUtterance = false`
   - 停止录音：`stateMachine.stopRecording()`

### 1.4 播放完成后发送信号

**触发路径：**
```
TtsPlayer.onPlaybackFinished() 
→ App.onPlaybackFinished()
```

**详细流程：**

1. **App.onPlaybackFinished()** (`app.ts:1082-1130`)
   - 发送 TTS_PLAY_ENDED 消息（如果 trace_id 和 group_id 存在）
   - 记录播放结束时间戳：`sessionManager.setPlaybackFinishedTimestamp(Date.now())`
   - 设置等待标志：`sessionManager.setWaitingForPlaybackFinalize(true)` （阻止新chunk发送）
   - 发送 finalize：`wsClient.sendFinal()` （发送空的 is_final=true，用于重置调度服务器的计时器）
   - 50ms 后清除等待标志：`setTimeout(() => sessionManager.setWaitingForPlaybackFinalize(false), 50)`
   - 清空 trace_id 和 group_id

2. **SessionManager.setWaitingForPlaybackFinalize()** (`session_manager.ts:362-376`)
   - 设置/清除 `isWaitingForPlaybackFinalize` 标志
   - 如果清除标志，记录延迟日志

---

## 二、调度服务器处理流程

### 2.1 接收音频块（handle_audio_chunk）

**入口：** `SessionActor.handle_audio_chunk()` (`actor_event_handling.rs:25-212`)

**详细流程：**

1. **确定 utterance_index** (第34-48行)
   - 如果正在 finalize（`finalize_inflight.is_some()`）：
     - 使用 `finalizing_index + 1`（下一个 utterance）
   - 否则：
     - 使用 `current_utterance_index`

2. **添加音频块到缓冲区** (第74-78行)
   - `audio_buffer.add_chunk(session_id, utterance_index, chunk)`
   - 返回：`(should_finalize_due_to_length, current_size_bytes)`

3. **更新状态** (第80-88行)
   - 更新 `last_chunk_timestamp_ms = timestamp_ms`
   - 更新 `first_chunk_client_timestamp_ms`（如果是第一个chunk）
   - 进入 `Collecting` 状态
   - 累积音频时长：`accumulated_audio_duration_ms += chunk_duration_ms`

4. **检查暂停是否超过阈值** (第90-107行)
   - 如果 `chunk_size > 0`（有实际音频内容）：
     - `record_chunk_and_check_pause(session_id, timestamp_ms, pause_ms)`
     - 更新 `last_chunk_at_ms` 并检查是否超过 `pause_ms`（默认3000ms）
     - 返回 `pause_exceeded`（true/false）
   - 如果 `chunk_size == 0`（空的 is_final=true）：
     - `update_last_chunk_at_ms(session_id, timestamp_ms)` （只更新，不检查）
     - `pause_exceeded = false` （不触发 pause finalize）

5. **检查是否需要 finalize** (第109-158行)
   - 检查 `pause_exceeded`：如果超过暂停阈值，`should_finalize = true`，`finalize_reason = "Pause"`
   - 检查最大时长限制：如果超过 `max_duration_ms`，`should_finalize = true`，`finalize_reason = "MaxDuration"`
   - 检查 `is_final`：如果 `is_final = true`，`should_finalize = true`，`finalize_reason = "IsFinal"`
   - 检查异常保护限制：如果超过 500KB，`should_finalize = true`，`finalize_reason = "MaxLength"`

6. **执行 finalize 或重置计时器** (第160-209行)
   - 如果需要 finalize 且没有正在 finalize：
     - `try_finalize(utterance_index, finalize_reason)` (第164行)
     - 如果 finalize 失败且原因是 "IsFinal"：
       - 重置计时器：`reset_timers()` (第181行)
   - 如果不需要 finalize：
     - 如果 `chunk_size > 0`（有实际音频内容）：
       - **重置计时器**：`reset_timers()` (第191行) **（关键：持续音频会重置计时器）**
     - 如果 `chunk_size == 0` 且没有正在 finalize：
       - 重置计时器：`reset_timers()` (第194行) **（空的 is_final=true 也会重置计时器）**
     - 如果正在 finalize 且是空的 is_final=true：
       - **不重置计时器**（避免干扰正在进行的 finalize）

### 2.2 暂停检测（record_chunk_and_check_pause）

**方法：** `AudioBufferManager.record_chunk_and_check_pause()` (`audio_buffer.rs:56-64`)

**详细流程：**
1. 获取上次时间戳：`last_chunk_at_ms.get(session_id)`
2. 计算时间差：`now_ms - prev_ms`
3. 检查是否超过阈值：`time_diff > pause_ms`（默认3000ms）
4. 更新时间戳：`last_chunk_at_ms.insert(session_id, now_ms)`
5. 返回 `exceeded`（true/false）

### 2.3 超时触发（handle_timeout_fired）

**入口：** `SessionActor.handle_timeout_fired()` (`actor_event_handling.rs:216-260`)

**详细流程：**
1. 检查 generation 是否有效（防止过期计时器触发）
2. 检查时间戳是否匹配：
   - 获取 `audio_buffer.get_last_chunk_at_ms(session_id)`
   - 如果时间戳不匹配（有新chunk到达），忽略本次超时
3. 如果时间戳匹配（确实超时了）：
   - `try_finalize(current_utterance_index, "Timeout")`

### 2.4 重置计时器（reset_timers）

**方法：** `SessionActor.reset_timers()` (`actor_timers.rs:14-50`)

**详细流程：**
1. 取消旧计时器：`cancel_timers()`
2. 更新 generation：`increment_timer_generation()`
3. 获取时间戳：
   - 优先使用 `audio_buffer.get_last_chunk_at_ms(session_id)` （最准确）
   - 否则使用 `internal_state.last_chunk_timestamp_ms`
   - 否则使用当前时间
4. 启动新计时器：
   - 等待 `pause_ms`（默认3000ms）
   - 检查时间戳是否仍然匹配
   - 如果匹配，发送 `TimeoutFired` 事件

### 2.5 Finalize 流程（try_finalize）

**方法：** `SessionActor.try_finalize()` (`actor_finalize.rs:11-81`)

**详细流程：**
1. 检查是否可以 finalize：`can_finalize(utterance_index)`
   - 如果已经 finalize 或正在 finalize，返回 false
2. 进入 finalizing 状态：`enter_finalizing(utterance_index)`
   - 设置 `finalize_inflight = Some(utterance_index)`
3. 应用 Hangover 延迟：
   - Manual finalize：`hangover_manual_ms`
   - Auto finalize：`hangover_auto_ms`
   - Exception：0ms
4. 执行 finalize：`do_finalize(utterance_index, reason, finalize_type)`
5. 如果 finalize 成功：
   - 完成 finalize：`complete_finalize()`
     - 递增 `current_utterance_index`
     - 清除 `finalize_inflight = None`
   - 重置累积音频时长：`accumulated_audio_duration_ms = 0`
6. 如果 finalize 失败：
   - 恢复状态：`state = Idle`
   - 清除 `finalize_inflight = None`

---

## 三、关键时间点和状态转换

### 3.1 播放完成后的时序

```
T0: 播放完成
  → App.onPlaybackFinished()
  → 设置 isWaitingForPlaybackFinalize = true
  → 发送 sendFinal()（空的 is_final=true）
  
T0+50ms: 清除 isWaitingForPlaybackFinalize = false
  → 允许发送新的音频chunk

T1: 用户开始说话，首次音频chunk到达调度服务器
  → handle_audio_chunk(chunk, is_final=false)
  → record_chunk_and_check_pause() 更新 last_chunk_at_ms
  → reset_timers() 重置计时器（基于新的时间戳）
```

### 3.2 持续音频输入的时序

```
T0: 第一个音频chunk到达
  → record_chunk_and_check_pause() 更新 last_chunk_at_ms = T0
  → reset_timers() 启动计时器（基于 T0）

T1: 第二个音频chunk到达（T0 + 100ms）
  → record_chunk_and_check_pause() 更新 last_chunk_at_ms = T1
  → reset_timers() 重置计时器（基于 T1，取消旧计时器）

T2: 第三个音频chunk到达（T1 + 100ms）
  → record_chunk_and_check_pause() 更新 last_chunk_at_ms = T2
  → reset_timers() 重置计时器（基于 T2，取消旧计时器）

...（持续重置，不会触发超时）
```

### 3.3 暂停检测的时序

```
T0: 最后一个音频chunk到达
  → record_chunk_and_check_pause() 更新 last_chunk_at_ms = T0
  → reset_timers() 启动计时器（基于 T0）

T0 + 3000ms: 没有新chunk到达
  → 计时器触发 TimeoutFired
  → handle_timeout_fired()
  → try_finalize(utterance_index, "Timeout")
```

---

## 四、潜在问题和冗余分析

### 4.1 冗余逻辑

1. **双重时间戳管理**
   - `internal_state.last_chunk_timestamp_ms` 和 `audio_buffer.last_chunk_at_ms` 都存储最后chunk的时间戳
   - **问题**：两个时间戳可能不同步
   - **修复**：`reset_timers()` 已优先使用 `audio_buffer.get_last_chunk_at_ms()`，但 `internal_state.last_chunk_timestamp_ms` 仍然存在

2. **空的 is_final=true 的重复处理**
   - 播放完成后发送空的 `is_final=true`
   - 手动发送时也可能发送空的 `is_final=true`（如果缓冲区为空）
   - **问题**：两种场景都触发 `IsFinal` finalize，但意图不同
   - **建议**：区分"重置计时器"和"手动finalize"的意图

### 4.2 潜在冲突

1. **finalize_inflight 期间的计时器重置**
   - **当前逻辑**：如果 `finalize_inflight.is_some()` 且 `chunk_size > 0`，仍然重置计时器
   - **潜在问题**：在 finalize 期间（hangover延迟），如果收到新chunk，会重置计时器
   - **分析**：这是正确的，因为新chunk应该重置计时器，防止在hangover期间超时

2. **空的 is_final=true 在 finalize 期间的处理**
   - **当前逻辑**：如果 `finalize_inflight.is_some()` 且 `chunk_size == 0`，不重置计时器
   - **潜在问题**：播放完成后的 sendFinal 可能在 finalize 期间到达，不会重置计时器
   - **分析**：这是合理的，因为 finalize 期间不应该被空的 is_final=true 干扰

3. **pause_exceeded 和 is_final 的优先级**
   - **当前逻辑**：如果 `pause_exceeded = true` 且 `is_final = true`，`finalize_reason = "IsFinal"`（后检查的覆盖前面的）
   - **潜在问题**：如果用户暂停超过3秒，然后手动发送，finalize原因会被标记为 "IsFinal" 而不是 "Pause"
   - **分析**：这可能不是问题，因为两种原因都会触发 finalize

### 4.3 时序问题

1. **播放完成后的 sendFinal 和首次音频chunk的竞争**
   - **当前逻辑**：使用 `isWaitingForPlaybackFinalize` 标志，50ms 延迟
   - **潜在问题**：如果网络延迟 > 50ms，首次音频chunk可能在 sendFinal 之前到达
   - **建议**：考虑使用更可靠的机制（例如等待 sendFinal 的确认）

2. **计时器重置的时机**
   - **当前逻辑**：每次收到新chunk（`chunk_size > 0`）都重置计时器
   - **潜在问题**：如果chunk到达频率很高，计时器会频繁重置，但这是预期的行为

---

## 五、建议优化

### 5.1 简化时间戳管理
- 移除 `internal_state.last_chunk_timestamp_ms`，统一使用 `audio_buffer.last_chunk_at_ms`

### 5.2 区分 finalize 意图
- 添加新的消息类型或标志，区分"重置计时器"和"手动finalize"
- 或者：空的 `is_final=true` 只用于重置计时器，不触发 finalize

### 5.3 改进播放完成后的同步机制
- 考虑使用确认机制，确保 sendFinal 先到达调度服务器
- 或者：在调度服务器端，如果收到空的 `is_final=true` 且缓冲区为空，只重置计时器，不触发 finalize

### 5.4 优化 finalize 期间的chunk处理
- 在 finalize 期间收到的chunk，应该明确标记为"下一个utterance"
- 确保计时器重置逻辑与 finalize 状态一致
