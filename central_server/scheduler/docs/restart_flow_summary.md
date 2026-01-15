# Restart 流程总结

## 完整流程

### 1. Web端播放完语音
- Web端检测到TTS播放完成
- 发送 `TTS_PLAY_ENDED` 消息到调度服务器

### 2. 调度服务器收到 TTS_PLAY_ENDED
- 调度服务器收到消息后，发送 `RestartTimer` 事件到 SessionActor
- `handle_restart_timer` 被调用：
  - 更新 `last_chunk_at_ms` 为 RestartTimer 的时间戳（调度服务器时间）
  - 重置计时器

### 3. Web端延迟 500ms 后发送第一批音频 chunk
- Web端在播放完成后延迟 500ms，才开始发送新的音频 chunk
- 这确保了 RestartTimer 先到达调度服务器并更新 `last_chunk_at_ms`

### 4. 第一批音频 chunk 到达调度服务器
- `handle_audio_chunk` 被调用
- 调用 `record_chunk_and_check_pause` 检查 pause：
  - 计算：`当前时间戳 - last_chunk_at_ms`
  - 如果时间差 > 3秒（pause_ms），返回 `true`（触发 pause finalize）
  - 如果时间差 ≤ 3秒，返回 `false`（不触发 finalize）
  - **无论结果如何，都会更新 `last_chunk_at_ms` 为当前时间戳**

### 5. 用户持续说话
- 后续的音频 chunk 不断到达
- 每个 chunk 都会：
  - 调用 `record_chunk_and_check_pause` 检查 pause
  - 由于时间差很小（< 3秒），不会触发 pause finalize
  - 更新 `last_chunk_at_ms` 为当前时间戳
  - 累积音频时长到 `accumulated_audio_duration_ms`

### 6. Finalize 触发条件

Job 会在以下情况下被 finalize：

1. **用户手动截断**：Web端发送 `is_final=true`
   - 触发 `IsFinal` finalize

2. **达到最大音频时长**：`accumulated_audio_duration_ms >= max_duration_ms`（默认20秒）
   - 触发 `MaxDuration` finalize

3. **用户停止说话超过3秒**：pause 检测发现时间差 > 3秒
   - 触发 `Pause` finalize

4. **超时触发**：Timeout 计时器触发（如果用户长时间不说话）
   - 触发 `Timeout` finalize

5. **异常保护**：音频缓冲区超过 500KB
   - 触发 `MaxLength` finalize

## 关键点

### ✅ 正确的理解

1. **RestartTimer 先到达**：Web端延迟 500ms 发送音频 chunk，确保 RestartTimer 先到达并更新 `last_chunk_at_ms`
2. **第一批 chunk 不会触发 pause finalize**：时间差只有 500ms 左右，远小于 3秒阈值
3. **持续说话不会触发 pause finalize**：每个 chunk 都会更新 `last_chunk_at_ms`，时间差始终 < 3秒
4. **只有在用户停止说话超过3秒时，才会触发 pause finalize**

### ⚠️ 需要注意的点

1. **不是"开始创建job"**：音频 chunk 到达时，只是收集音频到缓冲区，**job 是在 finalize 时创建的**
2. **pause 检测的时机**：每个音频 chunk 到达时都会检查 pause，如果时间差 > 3秒，立即触发 finalize
3. **如果 RestartTimer 未及时到达**：如果音频 chunk 在 RestartTimer 之前到达，pause 检测会发现时间差 > 3秒（距离上一个 utterance 的最后一个 chunk），会触发 pause finalize

## 流程图

```
播放完成
  ↓
Web端发送 TTS_PLAY_ENDED
  ↓
调度服务器收到 → 发送 RestartTimer 事件
  ↓
handle_restart_timer: 更新 last_chunk_at_ms
  ↓
Web端延迟 500ms
  ↓
第一批音频 chunk 到达
  ↓
handle_audio_chunk: 
  - record_chunk_and_check_pause: 检查 pause（时间差约 500ms，< 3秒，不触发）
  - 更新 last_chunk_at_ms
  - 累积音频时长
  ↓
用户持续说话
  ↓
后续音频 chunk 不断到达
  ↓
每个 chunk:
  - record_chunk_and_check_pause: 检查 pause（时间差 < 3秒，不触发）
  - 更新 last_chunk_at_ms
  - 累积音频时长
  ↓
用户停止说话超过3秒
  ↓
下一个 chunk 到达（或 Timeout 触发）
  ↓
pause 检测发现时间差 > 3秒（或 Timeout 触发）
  ↓
触发 finalize → 创建 job
```
