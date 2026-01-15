# Web端日志增强总结

## 已添加的日志

### 1. 播放完成相关日志

**位置**: `tts_player.ts:341-352`
- `[TtsPlayer] 所有音频块播放完成，调用 finishPlaying` - 播放完成时间戳
- `[TtsPlayer] 调用 playbackFinishedCallback` - 回调调用时间戳

**位置**: `app.ts:1137-1178`
- `[App] 🎵 播放完成` - 播放完成时间戳
- `[App] 已发送 TTS_PLAY_ENDED` - TTS_PLAY_ENDED发送时间戳
- `[App] 播放完成，TTS_PLAY_ENDED 消息已发送` - 设置延迟发送时间戳

### 2. 状态机切换日志

**位置**: `state_machine.ts:61-78`
- `[StateMachine] State transition: PLAYING_TTS -> INPUT_RECORDING` - 状态切换时间戳

### 3. 录音器恢复日志

**位置**: `app.ts:260-310` (onStateChange)
- `[App] 从播放状态回到录音状态，正在恢复录音...` - 状态变化时间戳
- `[App] requestAnimationFrame 回调执行` - RAF延迟时间
- `[App] ✅ 已恢复录音，可以继续说话（事件驱动）` - 录音器恢复成功时间戳
- `[App] ❌ 恢复录音失败（事件驱动）` - 恢复失败时间戳
- `[App] ✅ 重试恢复录音成功` - 重试成功时间戳
- `[App] ⚠️ 事件驱动恢复失败，使用fallback` - Fallback触发时间戳

**位置**: `app.ts:1191-1240` (onPlaybackFinished备用恢复)
- `[App] 播放完成后检测到录音器未恢复，使用事件驱动恢复录音...` - 备用恢复触发时间戳
- 类似的录音器恢复日志

### 4. 延迟发送机制日志

**位置**: `session_manager.ts:272-319`
- `[SessionManager] 开始播放完成延迟期间，缓存音频数据` - 延迟开始时间戳
  - 包含：延迟开始时间、延迟结束时间、剩余延迟时间
- `[SessionManager] 播放完成延迟结束，发送缓存的音频数据` - 延迟结束时间戳
  - 包含：实际延迟时间、缓存的帧数、从播放完成到现在的总时间

### 5. 音频帧处理日志

**位置**: `session_manager.ts:245-280`
- `[SessionManager] 收到音频帧，但状态不是 INPUT_RECORDING，跳过处理` - 状态检查失败日志
  - 每100帧记录一次，或第一次跳过时记录
- `[SessionManager] 状态已恢复为 INPUT_RECORDING，开始处理音频帧` - 状态恢复日志
  - 包含：之前跳过的帧数

### 6. 首次音频chunk发送日志

**位置**: `session_manager.ts:370-397`
- `[SessionManager] 🎤 首次发送音频chunk（播放结束后）` - 首次chunk发送时间戳
  - 包含：播放完成时间、首次发送时间、延迟时间
- `[SessionManager] 📤 发送第一批音频chunk到调度服务器` - 发送详情
- `[SessionManager] ✅ 第一批音频chunk已调用sendAudioChunk` - sendAudioChunk调用完成时间戳

### 7. 音频发送器日志

**位置**: `audio_sender.ts:160-173` (Binary Frame模式)
- `[AudioSender] 发送 audio_chunk 二进制帧` - 发送时间戳、序列号、数据大小

**位置**: `audio_sender.ts:230-238` (JSON模式)
- `[AudioSender] 发送 audio_chunk 消息` - 发送时间戳、序列号、数据大小

## 关键时间点对比

测试时，请在浏览器控制台查找以下日志，记录时间戳：

| 事件 | 日志关键词 | 时间戳字段 |
|------|----------|-----------|
| TTS播放完成 | `[TtsPlayer] 所有音频块播放完成` | `timestamp` |
| 状态机切换 | `[StateMachine] State transition` | `timestamp` |
| 录音器恢复开始 | `[App] 从播放状态回到录音状态` | `timestamp` |
| 录音器恢复成功 | `[App] ✅ 已恢复录音` | `recorderEndTimestamp` |
| 延迟发送开始 | `[SessionManager] 开始播放完成延迟期间` | `delayStartTime` |
| 延迟发送结束 | `[SessionManager] 播放完成延迟结束` | `delayEndTime` |
| 首次chunk发送 | `[SessionManager] 🎤 首次发送音频chunk` | `firstChunkSentTimestamp` |
| TTS_PLAY_ENDED发送 | `[App] 已发送 TTS_PLAY_ENDED` | `ts_end_ms` |

## 诊断步骤

1. **打开浏览器控制台**（F12），清空日志
2. **重新运行测试**，复现问题
3. **查找关键日志**，记录所有时间戳
4. **计算时间差**：
   - 播放完成 → 状态切换
   - 状态切换 → 录音器恢复
   - 录音器恢复 → 延迟发送开始
   - 延迟发送结束 → 首次chunk发送
   - 首次chunk发送 → 调度服务器收到（对比调度服务器日志）
5. **分析延迟原因**：
   - 如果录音器恢复延迟 > 100ms，可能是 `requestAnimationFrame` 延迟或恢复失败
   - 如果延迟发送时间 > 500ms，可能是延迟机制问题
   - 如果首次chunk发送到调度服务器收到的时间差 > 100ms，可能是网络延迟

## 注意事项

- 所有日志都包含 `timestamp` 和 `timestampIso` 字段，便于对比
- 日志会同时输出到浏览器控制台和IndexedDB
- 可以使用 `logger.exportLogs()` 导出所有日志到文件
