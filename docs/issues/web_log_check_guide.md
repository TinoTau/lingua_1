# Web端日志检查指南

## 日志存储方式

Web端的日志系统使用 **IndexedDB** 存储日志，而不是直接写入文件。日志文件 `web-client.log` 只包含启动信息。

运行时日志会：
1. **输出到浏览器控制台**（console.log/error/warn）
2. **存储到IndexedDB**（每5秒刷新一次）

## 检查方法

### 方法1：浏览器控制台（推荐）

1. 打开浏览器开发者工具（F12）
2. 切换到 **Console** 标签
3. 查找以下关键日志：

#### 播放完成相关日志：
```
[App] 🎵 播放完成
[StateMachine] 播放完成，从 PLAYING_TTS 转换到 INPUT_RECORDING
[App] State changed: PLAYING_TTS -> INPUT_RECORDING
```

#### 录音器恢复相关日志：
```
[App] 从播放状态回到录音状态，正在恢复录音...
[App] ✅ 已恢复录音，可以继续说话（事件驱动）
[App] ✅ 播放完成后已恢复录音（事件驱动）
```

#### 延迟发送相关日志：
```
[SessionManager] 设置播放结束时间戳和延迟发送
[SessionManager] 开始播放完成延迟期间，缓存音频数据
[SessionManager] 播放完成延迟结束，发送缓存的音频数据
```

#### 首次音频chunk发送日志：
```
[SessionManager] 🎤 首次发送音频chunk（播放结束后）
[SessionManager] 📤 发送第一批音频chunk到调度服务器
```

### 方法2：从IndexedDB导出日志

在浏览器控制台执行：

```javascript
// 获取logger实例并导出日志
import { logger } from './logger';
logger.exportLogs();
```

这会下载一个日志文件，包含所有IndexedDB中存储的日志。

### 方法3：检查关键时间戳

在浏览器控制台查找以下时间戳，对比调度服务器的日志：

1. **播放完成时间**：`[App] 🎵 播放完成`
2. **状态切换时间**：`[StateMachine] 播放完成，从 PLAYING_TTS 转换到 INPUT_RECORDING`
3. **录音器恢复时间**：`[App] ✅ 已恢复录音`
4. **首次音频chunk发送时间**：`[SessionManager] 🎤 首次发送音频chunk`
5. **TTS_PLAY_ENDED发送时间**：`[App] 已发送 TTS_PLAY_ENDED`

## 关键时间点对比

对比以下时间点，找出延迟原因：

| 事件 | Web端时间戳 | 调度服务器时间戳 | 时间差 |
|------|------------|----------------|--------|
| 播放完成 | | | |
| 状态切换 | | | |
| 录音器恢复 | | | |
| 首次音频chunk发送 | | | |
| TTS_PLAY_ENDED发送 | | | |
| RestartTimer到达 | | | |
| 第一个音频chunk到达 | | | |

## 可能的问题诊断

### 如果录音器恢复延迟：
- 查找 `[App] ⚠️ 事件驱动恢复失败，使用fallback`
- 查找 `[App] ❌ 恢复录音失败`
- 检查是否有多次重试

### 如果延迟发送机制未生效：
- 查找 `[SessionManager] 开始播放完成延迟期间，缓存音频数据`
- 如果没有这个日志，说明延迟机制未触发

### 如果状态机未切换：
- 查找 `[StateMachine] 播放完成，从 PLAYING_TTS 转换到 INPUT_RECORDING`
- 如果没有这个日志，说明状态机切换有问题

## 建议的检查步骤

1. **打开浏览器控制台**，清空日志
2. **重新运行测试**，复现问题
3. **查找关键日志**，记录时间戳
4. **对比调度服务器日志**，找出时间差
5. **分析延迟原因**，确定是录音器恢复延迟、延迟发送机制，还是其他原因
