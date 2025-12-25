# 集群测试问题分析

**日期**: 2025-12-25  
**状态**: 🔍 **问题已定位，需要修复**

---

## 问题总结

用户反馈：**重新编译并进行了集群测试，但是web端并没有可以播放的音频**

---

## 问题分析

### 1. 文本过滤器过于严格 ⚠️

**现象**：
- ASR 成功识别出文本（例如："好像是有內容,但是完全看不到"）
- 但被 `is_meaningless_transcript()` 标记为无意义
- 返回空响应，跳过 NMT 和 TTS

**日志证据**：
```
2025-12-25 09:30:41,429 - text_filter - WARNING - [Text Filter] Filtering text with punctuation: "好像是有內容,但是完全看不到"
2025-12-25 09:30:41,429 - __main__ - WARNING - [job-FBF82999] ASR transcript is meaningless (likely silence misrecognition), skipping NMT and TTS
```

**根本原因**：
- `text_filter.py` 第 38 行：如果文本包含任何标点符号（包括逗号、问号等），就会被过滤
- 但 ASR 模型（Faster Whisper）可能会在识别结果中包含标点符号
- 这导致有效的识别结果被误过滤

**影响**：
- 部分有效的语音识别结果被错误过滤
- 返回空响应，没有 TTS 音频生成

---

### 2. 调度服务器成功发送了结果 ✅

**日志证据**：
```
{"timestamp":"2025-12-24T20:30:39.5621678Z","level":"INFO","fields":{"message":"Sending translation result to session (single mode)","trace_id":"d74191d7-1429-458d-aca5-888b48cce8db","session_id":"s-6751BCA3","text_asr":"閫欓倞鐐轰粈楹兼矑鏈夎繑鍥炴","text_translated":"Why is this part not back to this part?","tts_audio_len":100412}}
{"timestamp":"2025-12-24T20:30:39.5625884Z","level":"INFO","fields":{"message":"Successfully sent translation result to session","trace_id":"d74191d7-1429-458d-aca5-888b48cce8db","session_id":"s-6751BCA3"}}
```

**结论**：
- 调度服务器确实成功发送了包含 TTS 音频的结果
- 问题不在调度服务器端

---

### 3. Web 端不自动播放 TTS ⚠️

**代码证据**：
```typescript
// webapp/web-client/src/app.ts:393-405
if (message.tts_audio && message.tts_audio.length > 0) {
  console.log('收到 TTS 音频，累积到缓冲区，不自动播放');
  // ...
  this.ttsPlayer.addAudioChunk(message.tts_audio).catch((error) => {
    console.error('添加 TTS 音频块失败:', error);
  });
  // 触发 UI 更新，显示播放按钮和时长
  this.notifyTtsAudioAvailable();
} else {
  console.log('翻译结果中没有 TTS 音频');
}
```

**问题**：
- Web 端改为手动播放模式，需要用户点击播放按钮
- 如果用户没有点击播放按钮，即使收到 TTS 音频也不会播放

**可能的原因**：
1. UI 没有显示播放按钮
2. 播放按钮被禁用或隐藏
3. 用户不知道需要手动点击播放

---

## 修复方案

### 方案 1：调整文本过滤器（推荐）

**问题**：文本过滤器过于严格，过滤了包含标点符号的有效文本

**修复**：
- 移除或放宽标点符号检查
- 或者只过滤特定的标点符号（如括号、特殊符号），保留常见的标点（逗号、句号、问号）

**修改文件**：`electron_node/services/faster_whisper_vad/text_filter.py`

**建议修改**：
```python
# 3. 检查标点符号（放宽规则：只过滤特殊标点，保留常见标点）
# 注意：ASR 模型可能会在识别结果中包含标点符号，这是正常的
# 只过滤明显无意义的标点符号（如括号、特殊符号）
special_punctuation = [
    '（', '）', '【', '】', '《', '》',  # 中文括号
    '(', ')', '[', ']', '{', '}',  # 英文括号
    '"', '"', '\u2018', '\u2019',  # 引号
    '@', '#', '$', '%', '^', '&', '*', '+', '=', '<', '>', '~', '`',  # 特殊符号
]
if any(c in text_trimmed for c in special_punctuation):
    logger.warning(f"[Text Filter] Filtering text with special punctuation: \"{text_trimmed}\"")
    return True

# 允许常见的标点符号（逗号、句号、问号、感叹号等）
# 这些是 ASR 模型正常输出的标点符号
```

---

### 方案 2：检查 Web 端播放逻辑

**问题**：Web 端不自动播放 TTS，需要用户手动点击播放按钮

**检查项**：
1. UI 是否显示播放按钮？
2. 播放按钮是否可用（enabled）？
3. 用户是否知道需要点击播放按钮？

**建议**：
- 如果 UI 没有播放按钮，需要添加
- 如果播放按钮被禁用，需要检查禁用条件
- 考虑恢复自动播放功能（如果用户需要）

---

## 下一步行动

### 立即修复

1. ✅ **调整文本过滤器**
   - 修改 `text_filter.py`，放宽标点符号检查
   - 只过滤特殊标点符号，保留常见标点

2. ⚠️ **检查 Web 端播放逻辑**
   - 确认 UI 是否有播放按钮
   - 检查播放按钮是否可用
   - 考虑是否需要恢复自动播放

### 测试验证

1. **重新编译节点端**
   ```bash
   cd electron_node/services/faster_whisper_vad
   # 修改 text_filter.py 后，重启服务
   ```

2. **进行集成测试**
   - 测试包含标点符号的语音识别
   - 验证 TTS 音频是否正常生成和播放

---

## 相关日志

### 节点端日志
- `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log`
- 关键日志：`[Text Filter] Filtering text with punctuation: "好像是有內容,但是完全看不到"`

### 调度服务器日志
- `central_server/scheduler/logs/scheduler.log`
- 关键日志：`Successfully sent translation result to session`

### Web 端日志
- 浏览器 Console
- 关键日志：`收到 TTS 音频，累积到缓冲区，不自动播放`

---

**分析完成时间**: 2025-12-25  
**状态**: 🔍 **问题已定位，等待修复**

