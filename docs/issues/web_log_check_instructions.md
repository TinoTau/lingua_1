# Web端日志检查说明

## 问题

Job3被提前finalize，需要检查web端日志确认原因。

## 检查方法

### 方法1：浏览器控制台（推荐）

1. **打开浏览器开发者工具**（F12）
2. **切换到 Console 标签**
3. **查找以下关键日志**，记录时间戳：

#### 静音检测相关（最可能的原因）
```
[SessionManager] 🔇 静音检测触发
[SessionManager] 📤 发送 finalize（静音检测：有音频数据）
[SessionManager] 📤 发送 finalize（静音检测：无音频数据但已发送过chunk）
[SessionManager] 静音检测：已发送剩余音频数据和 finalize
```

#### 手动发送相关
```
[SessionManager] sendCurrentUtterance 被调用
[SessionManager] 📤 发送 finalize（sendCurrentUtterance）
```

#### Job2播放完成相关
```
[TtsPlayer] 所有音频块播放完成
[App] 🎵 播放完成
[StateMachine] State transition: PLAYING_TTS -> INPUT_RECORDING
[App] 已发送 TTS_PLAY_ENDED
```

#### 首次音频chunk发送（job3的第一个chunk）
```
[SessionManager] 🎤 首次发送音频chunk（播放结束后）
[SessionManager] 📤 发送第一批音频chunk到调度服务器
```

### 方法2：从IndexedDB导出日志

在浏览器控制台执行：

```javascript
// 方法1：使用暴露的工具
window.logHelper.exportLogs();

// 方法2：直接访问logger
window.app.logger.exportLogs();
```

这会下载一个日志文件，包含所有IndexedDB中存储的日志。

### 方法3：手动复制控制台日志

1. 在控制台中右键点击日志
2. 选择"Save as..."或"Copy"
3. 保存到文件

## 关键时间点对比

请对比以下时间点，找出问题原因：

| 事件 | Web端时间戳 | 调度服务器时间戳 | 时间差 |
|------|------------|----------------|--------|
| Job2播放完成 | | `21:43:50.6433711Z` | |
| 状态切换 | | | |
| 录音器恢复 | | | |
| 首次音频chunk发送 | | | |
| **静音检测触发** | | | **关键** |
| **发送 is_final=true** | | `21:43:36.3528143Z` | **关键** |
| TTS_PLAY_ENDED发送 | | `21:43:50.6433711Z` | |
| RestartTimer到达 | | `21:43:50.6440854Z` | |

## 可能的原因

1. **静音检测触发了finalize**（最可能）：
   - 如果web端检测到静音，会自动发送 `is_final=true`
   - 检查是否有 `[SessionManager] 🔇 静音检测触发` 的日志
   - 检查时间戳是否在 `21:43:36.3528143Z` 附近

2. **用户手动点击了"发送"按钮**：
   - 如果用户点击了发送按钮，会触发 `sendCurrentUtterance()`
   - 检查是否有 `[SessionManager] sendCurrentUtterance 被调用` 的日志

3. **延迟发送机制问题**：
   - 如果延迟发送机制没有正确工作，可能在错误的时间发送了finalize
   - 检查延迟发送相关的日志时间戳

## 诊断步骤

1. **打开浏览器控制台**，清空日志
2. **重新运行测试**，复现问题
3. **查找关键日志**，特别是：
   - 是否有 `🔇 静音检测触发` 的日志
   - 是否有 `📤 发送 finalize` 的日志
   - 记录所有时间戳
4. **对比调度服务器日志**，找出时间差
5. **分析问题原因**，确定是静音检测、手动发送，还是其他原因

## 需要提供的信息

请提供以下日志的时间戳（ISO格式）：

1. Job2播放完成的时间戳
2. **是否有 `🔇 静音检测触发` 的日志？如果有，时间戳是什么？**
3. **是否有 `📤 发送 finalize` 的日志？如果有，时间戳是什么？**
4. 是否有 `sendCurrentUtterance 被调用` 的日志？如果有，时间戳是什么？
5. 首次音频chunk发送的时间戳（job3的第一个chunk）

这些信息将帮助确定job3被提前finalize的根本原因。
