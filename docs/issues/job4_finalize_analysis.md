# Job4 提前 Finalize 问题分析

## 问题描述

根据测试结果，job4（utterance_index=4）被提前 finalize，导致内容被截断。需要检查 web 端日志，确认是否存在播放结束后无法立即切换麦克风状态的问题。

## 如何导出 Web 端日志

### 方法1：使用浏览器控制台（推荐）

1. **打开浏览器控制台**（F12）
2. **导出日志**：
   ```javascript
   window.logHelper.exportLogs()
   ```
3. 日志文件会自动下载到浏览器的默认下载目录

### 方法2：通过 URL 参数自动保存

在浏览器地址栏添加参数启用自动保存：
```
http://localhost:9001/?logAutoSave=true&logAutoSaveInterval=30000
```

这样日志会每30秒自动保存一次。

## 需要检查的关键日志点

### 1. Job3 播放完成（触发 job4 的开始）

搜索日志中的以下关键字：
- `[App] 🎵 播放完成` - 记录播放完成的时间戳
- `设置播放结束时间戳和延迟发送` - 记录延迟配置和当前 utterance_index
- `TTS_PLAY_ENDED` - 记录发送给调度服务器的时间
- `currentUtteranceIndex: 3` - 确认是 job3

### 2. 状态切换和录音器恢复

搜索：
- `[StateMachine] 播放完成，从 PLAYING_TTS 转换到 INPUT_RECORDING` - 状态切换时间
- `[App] 播放完成后已恢复录音` - 录音器恢复时间
- `恢复录音失败` - 如果存在失败，记录时间

### 3. Job4 的首次音频发送

搜索：
- `🎤 首次发送音频chunk（播放结束后）` - **关键日志**
  - 检查 `delayFromPlaybackEndMs` - 从播放结束到首次发送的延迟
  - 检查 `utteranceIndex: 4` - 确认是 job4
  - 检查 `expectedDelayMs: 500` - 预期的500ms延迟

### 4. RestartTimer 和音频 Chunk 的时间顺序

需要确认：
1. **RestartTimer 发送时间**：通过 WebSocket 日志或调度服务器日志
2. **第一批音频 chunk 到达调度服务器的时间**：通过调度服务器日志
3. **两者之间的时间差**：应该是 500ms + 网络延迟

## 预期的时间线

正常情况下的时间线应该是：

```
T0: Job3 TTS 播放完成
    ├─ [App] 🎵 播放完成
    ├─ 发送 TTS_PLAY_ENDED 到调度服务器
    └─ 设置 playbackFinishedTimestamp

T0 + ~50ms: 状态切换
    └─ [StateMachine] 从 PLAYING_TTS 转换到 INPUT_RECORDING

T0 + ~50-100ms: 录音器恢复
    └─ [App] 播放完成后已恢复录音

T0 + 500ms: 播放完成延迟结束
    ├─ 发送缓存的音频数据
    └─ 🎤 首次发送音频chunk（播放结束后）

T0 + 500ms + 网络延迟: 调度服务器收到第一批 chunk
    └─ 此时 RestartTimer 应该已经到达并重置了计时器
```

## 问题排查点

### 如果 delayFromPlaybackEndMs 远大于 500ms

可能的原因：
1. 录音器恢复失败或延迟
2. 状态切换延迟
3. onAudioFrame 回调被阻塞

### 如果首次音频 chunk 在 RestartTimer 之前到达调度服务器

可能的原因：
1. 延迟机制未生效
2. 网络延迟导致 RestartTimer 未及时到达

### 如果 job4 被 pause finalize

检查调度服务器日志中：
- RestartTimer 到达时间
- 第一批 chunk 到达时间
- pause_duration_ms 是否超过 3000ms

## 调度服务器日志检查

在调度服务器日志中搜索：
```
utterance_index.*4|job4|RestartTimer.*4|AudioChunk.*4|finalize.*4
```

重点关注：
1. RestartTimer 事件的时间戳
2. 第一批 AudioChunk 到达的时间戳
3. Finalize 事件的时间和原因
