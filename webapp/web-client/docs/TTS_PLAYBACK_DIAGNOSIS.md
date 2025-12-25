# TTS播放问题诊断

**日期**: 2025-12-25  
**问题**: 调度服务器已收到节点端返回的结果，但web端没有可播放的内容

---

## 问题排查步骤

### 1. 检查调度服务器日志

**查看调度服务器是否成功转发结果到web端**:

```bash
# 查看调度服务器日志
tail -f central_server/scheduler/logs/scheduler.log | grep -i "Sending translation result"
```

**预期日志**:
```
"Sending translation result to session (single mode)"
"tts_audio_len: 123624"
"Successfully sent translation result to session"
```

**如果看到这些日志**:
- ✅ 调度服务器已成功转发结果
- ✅ TTS音频已发送（`tts_audio_len > 0`）
- ⚠️ 问题可能在web端接收或处理

---

### 2. 检查浏览器控制台日志

**打开浏览器开发者工具（F12），查看控制台日志**:

#### 2.1 检查是否收到 `translation_result` 消息

**预期日志**:
```
=== 翻译结果 ===
原文 (ASR): "你好"
译文 (NMT): "Hello"
当前状态: input_recording
是否有 TTS 音频: true 长度: 123624
收到 TTS 音频，累积到缓冲区，不自动播放 base64长度: 123624
```

**如果没有看到这些日志**:
- ❌ Web端没有收到 `translation_result` 消息
- ⚠️ 检查WebSocket连接是否正常
- ⚠️ 检查消息路由是否正确

#### 2.2 检查TTS音频是否添加到缓冲区

**预期日志**:
```
TtsPlayer: 添加音频块，当前状态: input_recording base64长度: 123624
TtsPlayer: 音频块已添加到缓冲区，缓冲区大小: 1 是否正在播放: false 总时长: 3.86 秒
[App] TTS 音频块已添加到缓冲区，触发 UI 更新
```

**如果没有看到这些日志**:
- ❌ TTS音频添加失败
- ⚠️ 检查 `addAudioChunk()` 是否抛出错误
- ⚠️ 检查base64解码是否成功

#### 2.3 检查UI更新是否触发

**预期日志**:
```
[App] TTS 音频可用，总时长: 3.86 秒 hasPendingAudio: true
[App] 触发 UI 更新（不改变状态），当前状态: input_recording hasPendingAudio: true
[UI] UI 更新通知（状态未变化）: { state: 'input_recording', hasPendingAudio: true, duration: 3.86 }
```

**如果没有看到这些日志**:
- ❌ UI更新没有触发
- ⚠️ 检查 `notifyTtsAudioAvailable()` 是否被调用
- ⚠️ 检查当前状态是否为 `INPUT_RECORDING`

#### 2.4 检查播放按钮状态

**预期日志**:
```
[UI] INPUT_RECORDING: sendBtn 状态 { isSessionActive: true, sendBtnDisabled: false }
[UI] UI 更新通知（状态未变化）: { state: 'input_recording', hasPendingAudio: true, duration: 3.86 }
```

**如果 `hasPendingAudio: false`**:
- ❌ `hasPendingTtsAudio()` 返回 `false`
- ⚠️ 检查 `audioBuffers.length` 是否为 0
- ⚠️ 检查音频是否真的添加到缓冲区

---

## 常见问题及解决方案

### 问题1: Web端没有收到 `translation_result` 消息

**可能原因**:
1. WebSocket连接断开
2. 消息路由错误（session_id不匹配）
3. 消息被过滤（空文本检查）

**解决方案**:
1. 检查WebSocket连接状态
2. 检查 `session_id` 是否匹配
3. 检查调度服务器日志中的 `session_id`

---

### 问题2: TTS音频为空或长度为0

**可能原因**:
1. 节点端没有生成TTS音频
2. 调度服务器过滤了空结果
3. base64编码/解码错误

**解决方案**:
1. 检查节点端日志，确认TTS音频已生成
2. 检查调度服务器日志，确认 `tts_audio_len > 0`
3. 检查浏览器控制台，确认 `message.tts_audio.length > 0`

---

### 问题3: TTS音频添加失败

**可能原因**:
1. base64解码失败
2. PCM16转换失败
3. AudioContext初始化失败

**解决方案**:
1. 检查浏览器控制台是否有错误日志
2. 检查 `addAudioChunk()` 是否抛出异常
3. 检查 `ensureAudioContext()` 是否成功

---

### 问题4: UI更新没有触发

**可能原因**:
1. 当前状态不是 `INPUT_RECORDING`
2. `notifyTtsAudioAvailable()` 没有被调用
3. `notifyUIUpdate()` 没有触发回调

**解决方案**:
1. 检查当前状态：`this.stateMachine.getState()`
2. 检查 `notifyTtsAudioAvailable()` 是否在 `addAudioChunk().then()` 中调用
3. 检查 `stateMachine.onStateChange()` 回调是否注册

---

### 问题5: 播放按钮仍然被禁用

**可能原因**:
1. `hasPendingTtsAudio()` 返回 `false`
2. UI更新时 `audioBuffers.length === 0`
3. 播放按钮状态更新逻辑错误

**解决方案**:
1. 检查 `audioBuffers.length` 是否 > 0
2. 检查 `hasPendingAudio()` 实现是否正确
3. 检查UI更新逻辑中播放按钮的 `disabled` 属性设置

---

## 调试命令

### 在浏览器控制台执行

```javascript
// 检查TTS播放器状态
window.app.ttsPlayer.audioBuffers.length
window.app.ttsPlayer.hasPendingAudio()
window.app.ttsPlayer.getTotalDuration()

// 检查应用状态
window.app.stateMachine.getState()
window.app.hasPendingTtsAudio()
window.app.getTtsAudioDuration()

// 手动触发UI更新
window.app.stateMachine.notifyUIUpdate()
```

---

## 完整日志检查清单

### 调度服务器日志
- [ ] `"Received JobResult"`
- [ ] `"Sending translation result to session (single mode)"`
- [ ] `"tts_audio_len: XXXX"` (XXXX > 0)
- [ ] `"Successfully sent translation result to session"`

### 浏览器控制台日志
- [ ] `"=== 翻译结果 ==="`
- [ ] `"是否有 TTS 音频: true 长度: XXXX"`
- [ ] `"收到 TTS 音频，累积到缓冲区，不自动播放"`
- [ ] `"TtsPlayer: 添加音频块"`
- [ ] `"TtsPlayer: 音频块已添加到缓冲区，缓冲区大小: 1"`
- [ ] `"[App] TTS 音频块已添加到缓冲区，触发 UI 更新"`
- [ ] `"[App] TTS 音频可用，总时长: X.XX 秒 hasPendingAudio: true"`
- [ ] `"[App] 触发 UI 更新（不改变状态）"`
- [ ] `"[UI] UI 更新通知（状态未变化）: { hasPendingAudio: true }"`

---

## 相关文档

- [TTS UI更新时序修复](./TTS_UI_UPDATE_TIMING_FIX.md)
- [TTS缓冲区UI更新修复](./TTS_BUFFER_UI_UPDATE_FIX.md)

