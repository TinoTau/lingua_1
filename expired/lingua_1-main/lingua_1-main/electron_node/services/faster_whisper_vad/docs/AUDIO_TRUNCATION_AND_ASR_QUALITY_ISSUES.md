# 音频截断和ASR识别质量问题分析

**日期**: 2025-12-25  
**状态**: 🔍 **问题分析中**

---

## 用户反馈的问题

1. **调度服务器警告**：
   - `ASR结果可能不完整：句子未以标点符号结尾，可能是音频被过早截断`
   - 例如：`asr_text="这个东方飞简查一下"` - 没有标点符号结尾

2. **Web端播放的语音被截断**：
   - 播放的语音会丢失半句话
   - 说明TTS音频可能不完整

3. **ASR识别质量非常差**：
   - 识别结果：`"所以说预应则发送到几天端就会被处理 然后评并调整"`
   - 完全不知道在说什么

4. **重复问题**：
   - 仍然有重复的内容

---

## 问题分析

### 1. VAD静音检测过于敏感

**当前配置** (`webapp/web-client/src/types.ts`):
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015, // 进入语音：严格
  releaseThreshold: 0.008, // 退出语音：宽松
  windowMs: 100,
  attackFrames: 3, // 连续3帧语音才开始发送
  releaseFrames: 15, // 连续15帧静音才停止发送（150ms）
}
```

**问题**：
- `releaseFrames: 15` = 150ms 静音就停止发送
- 如果用户在说话过程中有短暂停顿（超过150ms），VAD会停止发送
- 这会导致音频被过早截断，ASR结果不完整

**示例场景**：
```
用户说话："所以说...（停顿200ms）...应该发送到节点端就会被处理"
VAD检测：150ms静音后停止发送
实际发送："所以说"
ASR结果："所以说"（不完整，未以标点符号结尾）
```

---

### 2. 音频发送逻辑

**当前逻辑** (`webapp/web-client/src/app.ts`):
```typescript
private onSilenceDetected(): void {
  if (this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
    // 发送剩余的音频数据
    if (this.audioBuffer.length > 0) {
      const chunk = this.concatAudioBuffers(this.audioBuffer);
      this.audioBuffer = [];
      this.wsClient.sendAudioChunk(chunk, false);
    }
    // 发送结束帧
    this.wsClient.sendFinal();
    // 停止录音
    this.stateMachine.stopRecording();
  }
}
```

**问题**：
- VAD停止发送后，`onSilenceDetected()` 会立即发送当前缓冲的音频
- 如果VAD在用户还没说完时就停止，会导致音频不完整

---

### 3. ASR识别质量

**当前配置** (`electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`):
```python
MIN_AUDIO_RMS = 0.002
MIN_AUDIO_STD = 0.002
MIN_AUDIO_DYNAMIC_RANGE = 0.01
MIN_AUDIO_DURATION = 0.5  # 最短音频时长0.5秒
```

**日志显示**：
- 音频时长：`4.56秒` ✅ 足够长
- `condition_on_previous_text=False` ✅ 已生效
- 但识别结果仍然很差

**可能的原因**：
1. **音频被截断**：VAD过早停止发送，导致音频不完整
2. **音频质量问题**：虽然通过了质量检查，但可能仍然有问题
3. **模型配置问题**：可能需要调整ASR参数

---

### 4. 重复问题

**状态**：
- `condition_on_previous_text=False` 已经生效 ✅
- 但可能还有跨utterance的重复

---

## 解决方案

### 1. 增加VAD的releaseFrames（允许更长的停顿）

**修改** (`webapp/web-client/src/types.ts`):
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015,
  releaseThreshold: 0.008,
  windowMs: 100,
  attackFrames: 3,
  releaseFrames: 30, // 从15增加到30（300ms，允许更长的停顿）
}
```

**理由**：
- 150ms的停顿太短，用户在说话过程中经常会有200-300ms的停顿
- 增加到300ms可以避免过早截断

---

### 2. 增加VAD的releaseThreshold（降低静音检测敏感度）

**修改** (`webapp/web-client/src/types.ts`):
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015,
  releaseThreshold: 0.005, // 从0.008降低到0.005（更宽松，避免误停止）
  windowMs: 100,
  attackFrames: 3,
  releaseFrames: 30,
}
```

**理由**：
- 降低releaseThreshold可以让VAD在更低的音量下继续发送
- 避免说话过程中音量稍微降低就被误判为静音

---

### 3. 检查ASR识别质量的其他原因

**需要检查**：
1. **音频编码质量**：检查Opus编码是否导致质量下降
2. **模型配置**：检查ASR模型参数是否正确
3. **上下文参数**：检查`initial_prompt`是否正确传递

---

## 验证步骤

### 1. 测试VAD修复

1. 重新编译Web端
2. 测试场景：
   - 用户说话："所以说...（停顿200ms）...应该发送到节点端就会被处理"
   - **期望**：VAD不会在150ms时停止，应该继续发送直到300ms静音

### 2. 测试ASR识别质量

1. 查看日志确认：
   - 音频时长是否足够（>0.5秒）
   - 音频质量指标（RMS、STD、动态范围）
   - ASR识别结果

2. 如果识别质量仍然很差：
   - 检查音频编码质量
   - 检查ASR模型配置
   - 检查上下文参数

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/ISSUE_STATUS_REPORT.md` - 问题状态报告
- `electron_node/electron-node/main/docs/CONDITION_ON_PREVIOUS_TEXT_FIX.md` - condition_on_previous_text修复

