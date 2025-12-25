# Web端音频缓存和ASR上下文问题分析

**日期**: 2025-12-25  
**状态**: 🔍 **问题分析中**

---

## 问题描述

用户反馈：
1. **Web端没有将调度服务器返回的音频放入缓存区**
2. **大量已经被翻译好的内容被丢弃**
3. **语音识别的准确度需要查看上下文相关的日志**

---

## 日志分析

### 1. 调度服务器日志

**成功发送的结果**：
```
"Sending translation result to session (single mode)"
"tts_audio_len=228752"
"Successfully sent translation result to session"
```

**被跳过的空结果**：
```
"Skipping empty translation result (silence detected), not forwarding to web client"
```

**结果队列状态**：
```
expected_index=12, queue_size=9, queue_indices=[0, 1, 2, 3, 4, 5, 6, 7, 10]
```

**分析**：
- ✅ 调度服务器成功发送了翻译结果（`tts_audio_len=228752`）
- ⚠️ 有很多空结果被跳过（静音检测）
- ⚠️ 结果队列中有结果但没有被释放（`expected_index=12`，但队列中只有 `[0, 1, 2, 3, 4, 5, 6, 7, 10]`）

---

### 2. ASR服务日志

**上下文参数**：
```
has_initial_prompt=True, initial_prompt_length=17
initial_prompt_preview='搴旇鏈夌‖鐗囪杩斿洖浜?浣嗘槸杩樻病鏈夋樉绀?'
condition_on_previous_text=True  # ⚠️ 应该是 False
```

**问题**：
- ⚠️ `condition_on_previous_text=True` 应该被设置为 `False`，以避免重复识别
- ⚠️ 日志显示乱码，可能是日志编码问题（但实际数据可能是正确的）

---

## 代码检查

### 1. ASR Worker 默认值问题

**文件**: `electron_node/services/faster_whisper_vad/asr_worker_process.py`

**问题**：
```python
condition_on_previous_text = task.get("condition_on_previous_text", True)  # ❌ 默认值是 True
```

**应该改为**：
```python
condition_on_previous_text = task.get("condition_on_previous_text", False)  # ✅ 默认值改为 False
```

**原因**：
- `faster_whisper_vad_service.py` 中 `UtteranceRequest.condition_on_previous_text: bool = False`
- 但如果任务中没有传递这个参数，`asr_worker_process.py` 会使用默认值 `True`
- 这会导致 ASR 重复识别问题

---

### 2. Web端音频缓存逻辑

**文件**: `webapp/web-client/src/app.ts`

**当前实现**：
```typescript
case 'translation_result':
  // 检查结果是否为空
  if (asrEmpty && translatedEmpty && ttsEmpty) {
    console.log('[App] 收到空文本结果（静音检测），跳过缓存和播放');
    return;  // ❌ 直接返回，不处理
  }
  
  // 处理 TTS 音频
  if (message.tts_audio && message.tts_audio.length > 0) {
    this.ttsPlayer.addAudioChunk(message.tts_audio, message.utterance_index).then(() => {
      console.log('[App] TTS 音频块已添加到缓冲区');
    });
  }
```

**可能的问题**：
1. **Web端没有收到消息**：
   - WebSocket 连接断开
   - 消息路由错误
   - 消息被过滤

2. **消息被过滤**：
   - 空结果检查：`if (asrEmpty && translatedEmpty && ttsEmpty)` 可能过于严格
   - 会话状态检查：`if (!this.isSessionActive)` 可能过早结束会话

3. **音频添加失败**：
   - `addAudioChunk()` 抛出错误但被捕获
   - base64 解码失败
   - 音频格式不匹配

---

## 修复方案

### 1. 修复 ASR Worker 默认值

**文件**: `electron_node/services/faster_whisper_vad/asr_worker_process.py`

**修改**：
```python
condition_on_previous_text = task.get("condition_on_previous_text", False)  # 默认值改为 False
```

---

### 2. 增强 Web端日志

**文件**: `webapp/web-client/src/app.ts`

**添加详细日志**：
```typescript
case 'translation_result':
  console.log('[App] 收到 translation_result 消息:', {
    utterance_index: message.utterance_index,
    has_text_asr: !!message.text_asr,
    has_text_translated: !!message.text_translated,
    has_tts_audio: !!message.tts_audio,
    tts_audio_length: message.tts_audio?.length || 0,
    is_session_active: this.isSessionActive
  });
  
  // ... 现有逻辑 ...
  
  if (message.tts_audio && message.tts_audio.length > 0) {
    console.log('[App] 准备添加 TTS 音频到缓冲区:', {
      utterance_index: message.utterance_index,
      base64_length: message.tts_audio.length
    });
    
    this.ttsPlayer.addAudioChunk(message.tts_audio, message.utterance_index)
      .then(() => {
        console.log('[App] ✅ TTS 音频块已成功添加到缓冲区');
      })
      .catch((error) => {
        console.error('[App] ❌ 添加 TTS 音频块失败:', error);
      });
  } else {
    console.warn('[App] ⚠️ 翻译结果中没有 TTS 音频');
  }
```

---

### 3. 检查结果队列问题

**问题**：`expected_index=12`，但队列中只有 `[0, 1, 2, 3, 4, 5, 6, 7, 10]`

**可能的原因**：
- 结果 8, 9, 11 丢失或延迟
- 结果队列的 gap tolerance 机制可能有问题

**需要检查**：
- 结果队列的 `gap_timeout_ms` 配置
- `MissingResult` 消息是否被正确处理

---

## 诊断步骤

### 1. 检查浏览器控制台

**打开浏览器开发者工具（F12），查看控制台日志**：

**预期日志**：
```
[App] 收到 translation_result 消息: {utterance_index: 10, has_tts_audio: true, ...}
收到 TTS 音频，累积到缓冲区，不自动播放 base64长度: 228752
TtsPlayer: 添加音频块，当前状态: input_recording base64长度: 228752 utteranceIndex: 10
TtsPlayer: 音频块已添加到缓冲区，缓冲区大小: 1 utteranceIndex: 10
[App] ✅ TTS 音频块已成功添加到缓冲区
```

**如果没有看到这些日志**：
- ❌ Web端没有收到 `translation_result` 消息
- ⚠️ 检查 WebSocket 连接状态
- ⚠️ 检查消息是否被过滤

---

### 2. 检查 ASR 上下文日志

**查看 ASR 服务日志**：
```bash
tail -f electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log | grep -i "ASR.*上下文\|condition_on_previous_text"
```

**预期日志**：
```
ASR 上下文参数: has_initial_prompt=True, initial_prompt_length=17, condition_on_previous_text=False
```

**如果看到 `condition_on_previous_text=True`**：
- ❌ ASR Worker 默认值问题
- ⚠️ 需要修复 `asr_worker_process.py`

---

## 下一步

1. ✅ **修复 ASR Worker 默认值**：将 `condition_on_previous_text` 默认值改为 `False`
2. ⏳ **增强 Web端日志**：添加详细的接收和处理日志
3. ⏳ **检查浏览器控制台**：确认 Web端是否收到消息
4. ⏳ **检查结果队列**：确认为什么 `expected_index` 不匹配

