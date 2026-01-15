# Web端日志保存到文件确认

## 日志保存机制

### 1. Logger系统（自动保存）

所有通过 `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()` 的日志都会：
- ✅ **自动保存到IndexedDB**（每5秒刷新一次）
- ✅ **页面卸载时自动保存**
- ✅ **缓冲区满（1000条）时自动保存**
- ✅ **同时输出到控制台**（用于开发调试）

### 2. Console日志桥接（新增）

已创建 `console_logger_bridge.ts`，它会：
- ✅ **拦截所有 `console.log/warn/error/info/debug` 输出**
- ✅ **将关键日志自动保存到logger系统**
- ✅ **关键日志包括**：
  - `[App]` 开头的日志
  - `[StateMachine]` 开头的日志
  - `[TtsPlayer]` 开头的日志
  - `[SessionManager]` 开头的日志
  - `[AudioSender]` 开头的日志
  - 包含"播放完成"的日志
  - 包含"State transition"的日志
  - 包含"TTS_PLAY_ENDED"的日志
  - 包含"恢复录音"的日志
  - 包含"静音检测"的日志
  - 包含"发送 finalize"的日志
  - 包含"首次发送音频chunk"的日志
  - 包含"playbackFinished"的日志
  - 包含"RestartTimer"的日志

### 3. 日志存储位置

- **IndexedDB**: 所有日志都存储在浏览器的IndexedDB中（数据库名：`lingua-logs`）
- **自动刷新**: 每5秒自动刷新一次到IndexedDB
- **导出文件**: 可以通过 `window.logHelper.exportLogs()` 导出到文件

## 关键日志确认

以下关键日志**都会自动保存到文件**：

### ✅ 播放完成相关
- `[TtsPlayer] 所有音频块播放完成` - ✅ 保存（console桥接）
- `[App] 🎵 播放完成` - ✅ 保存（console桥接）
- `[StateMachine] State transition` - ✅ 保存（console桥接）
- `[App] 已发送 TTS_PLAY_ENDED` - ✅ 保存（console桥接）

### ✅ 录音器恢复相关
- `[App] 从播放状态回到录音状态` - ✅ 保存（console桥接）
- `[App] ✅ 已恢复录音` - ✅ 保存（console桥接）

### ✅ 延迟发送相关
- `[SessionManager] 设置播放结束时间戳和延迟发送` - ✅ 保存（logger.info）
- `[SessionManager] 开始播放完成延迟期间` - ✅ 保存（logger.info）
- `[SessionManager] 播放完成延迟结束` - ✅ 保存（logger.info）

### ✅ 首次音频chunk发送
- `[SessionManager] 🎤 首次发送音频chunk` - ✅ 保存（logger.info）
- `[SessionManager] 📤 发送第一批音频chunk` - ✅ 保存（logger.info）
- `[AudioSender] 发送 audio_chunk` - ✅ 保存（logger.debug）

### ✅ 静音检测相关（关键）
- `[SessionManager] 🔇 静音检测触发` - ✅ 保存（logger.info）
- `[SessionManager] 📤 发送 finalize（静音检测）` - ✅ 保存（logger.info）

### ✅ 手动发送相关
- `[SessionManager] sendCurrentUtterance 被调用` - ✅ 保存（logger.info）
- `[SessionManager] 📤 发送 finalize（sendCurrentUtterance）` - ✅ 保存（logger.info）

### ✅ Finalize发送相关（关键）
- `[AudioSender] 📤 发送 finalize 信号` - ✅ 保存（logger.info）

## 如何导出日志文件

### 方法1：使用日志工具（推荐）

在浏览器控制台执行：

```javascript
// 导出所有日志到文件
window.logHelper.exportLogs();
```

这会下载一个日志文件，包含：
- IndexedDB中存储的所有日志
- 当前缓冲区中的日志

### 方法2：直接访问logger

```javascript
// 如果window.app可用
window.app.logger.exportLogs();
```

## 日志文件格式

日志文件格式：
```
2026-01-14T21:43:36.3528143Z [INFO] [SessionManager] 🔇 静音检测触发
{
  "timestamp": 1768427016352,
  "timestampIso": "2026-01-14T21:43:36.3528143Z",
  "currentState": "INPUT_RECORDING",
  "isSessionActive": true,
  "audioBufferLength": 10,
  "hasSentAudioChunks": true,
  "utteranceIndex": 3
}
```

## 确认清单

- ✅ 所有 `logger.info/warn/error/debug` 的日志都会保存
- ✅ 所有关键 `console.log` 的日志都会通过桥接保存
- ✅ 日志每5秒自动刷新到IndexedDB
- ✅ 页面卸载时自动保存
- ✅ 可以通过 `window.logHelper.exportLogs()` 导出文件

## 测试建议

1. **运行测试**，复现问题
2. **等待至少5秒**（确保日志已刷新到IndexedDB）
3. **在浏览器控制台执行**：
   ```javascript
   window.logHelper.exportLogs();
   ```
4. **检查下载的日志文件**，查找关键日志

## 注意事项

- 日志存储在IndexedDB中，不会自动下载到文件
- 需要手动调用 `exportLogs()` 来导出文件
- 如果浏览器关闭，IndexedDB中的日志仍然保留（除非清除浏览器数据）
- 建议在测试完成后立即导出日志，避免丢失
