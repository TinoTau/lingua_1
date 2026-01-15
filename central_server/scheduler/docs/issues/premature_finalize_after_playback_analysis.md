# 播放后提前 Finalize 问题分析

## 问题描述

在播放完成后，用户开始说话时，job3 和 job6 被提前 finalize（3秒 pause 触发）。

## 可能的原因

### 1. RestartTimer 事件未及时到达

**场景**：
- Web 端发送 `TTS_PLAY_ENDED` → 调度服务器收到 → 发送 `RestartTimer` 事件到 SessionActor
- 但是，如果 `RestartTimer` 事件在事件队列中排队，而音频 chunk 先到达
- 音频 chunk 会检查 pause，发现距离上次 chunk（上一个 utterance 的最后一个 chunk）超过 3 秒
- 触发 pause finalize
- 然后 `RestartTimer` 才到达，但已经太晚了

**检查方法**：
- 查看调度服务器日志，确认是否有 "TTS playback ended, restarted SessionActor timer" 日志
- 查看是否有 "Restarting timer after playback finished (RestartTimer event received)" 日志
- 确认这些日志的时间戳是否在音频 chunk 到达之前

### 2. RestartTimer 到达但时间戳更新不及时

**场景**：
- `RestartTimer` 先到达，更新了 `last_chunk_at_ms`
- 但是，如果音频 chunk 在 `RestartTimer` 之后很久才到达（比如网络延迟超过 3 秒）
- pause 检测发现时间差仍然超过 3 秒，触发 finalize

**检查方法**：
- 查看日志中的 `pause_duration_ms`，确认时间差是否真的超过 3 秒
- 查看 `RestartTimer` 的 `timestamp_ms` 和第一个音频 chunk 的 `timestamp_ms` 的时间差

### 3. playback_finished 标志被清除后触发 finalize

**场景**：
- `RestartTimer` 先到达，设置了 `playback_finished=true`
- 第一个音频 chunk 到达，清除了 `playback_finished` 标志
- pause 检测发现时间差超过 3 秒，触发 finalize
- `try_finalize` 检查 `playback_finished` 时，标志已经被清除，所以不会跳过

**检查方法**：
- 查看日志中的 `playback_finished` 标志状态
- 确认在 pause finalize 触发时，`playback_finished` 是否为 `false`

### 4. Web 端延迟发送未生效

**场景**：
- Web 端应该延迟 500ms 发送音频 chunk，但可能由于某种原因未生效
- 音频 chunk 在 `RestartTimer` 之前到达

**检查方法**：
- 查看 Web 端日志，确认是否有 "开始播放完成延迟期间，缓存音频数据" 日志
- 确认是否有 "播放完成延迟结束，发送缓存的音频数据" 日志
- 查看 `actualDelayMs`，确认延迟是否真的生效

## 诊断步骤

### 1. 检查调度服务器日志

查找以下关键日志：

```
# RestartTimer 相关
"TTS playback ended, restarted SessionActor timer"
"Restarting timer after playback finished (RestartTimer event received)"

# Pause finalize 相关
"Pause threshold exceeded, will trigger finalize"
"Triggering finalize from handle_audio_chunk"
"Starting finalize (enter_finalizing called)"
```

### 2. 检查时序

对于 job3 和 job6，确认：
- `RestartTimer` 事件的时间戳
- 第一个音频 chunk 的时间戳
- 时间差是否超过 3 秒

### 3. 检查 Web 端日志

查找以下关键日志：

```
# 播放完成
"[App] 🎵 播放完成"
"[App] 已发送 TTS_PLAY_ENDED"
"[SessionManager] 设置播放结束时间戳和延迟发送"

# 延迟发送
"[SessionManager] 开始播放完成延迟期间，缓存音频数据"
"[SessionManager] 播放完成延迟结束，发送缓存的音频数据"
"[SessionManager] 首次发送音频chunk（播放结束后）"
```

## 已添加的日志

为了帮助诊断，已添加以下详细日志：

1. **Pause 检测日志**：
   - 当 pause 超过阈值时，记录详细信息（时间戳、时间差、playback_finished 状态）
   - 当 pause 在阈值内时，记录 debug 级别日志

2. **RestartTimer 处理日志**：
   - 记录更新前后的 `last_chunk_at_ms`
   - 记录当前 utterance_index 和 finalize_inflight 状态

3. **Finalize 触发日志**：
   - 在 `handle_audio_chunk` 中触发 finalize 时，记录 `playback_finished` 状态

## 建议的修复方案

如果确认是时序问题，可以考虑：

1. **增加 playback_finished 的保护窗口**：
   - 在清除 `playback_finished` 标志后，增加一个短暂的保护窗口（比如 100ms）
   - 在这个窗口内，即使 pause 超过阈值，也不触发 finalize

2. **优化 RestartTimer 的优先级**：
   - 确保 `RestartTimer` 事件在事件队列中有更高的优先级
   - 或者使用单独的 channel 来处理 `RestartTimer` 事件

3. **增加更严格的检查**：
   - 在 `try_finalize` 中，不仅检查 `playback_finished`，还检查距离 `RestartTimer` 的时间
   - 如果距离 `RestartTimer` 的时间很短（比如 < 1 秒），即使 pause 超过阈值，也不触发 finalize
