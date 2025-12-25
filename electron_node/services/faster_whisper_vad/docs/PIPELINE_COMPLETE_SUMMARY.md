# 完整Pipeline流程说明

**日期**: 2025-12-25  
**Pipeline**: ASR → NMT → TTS

---

## Pipeline流程概述

完整的Pipeline流程包含三个步骤：

```
音频输入 (Opus Plan A)
    ↓
[ASR] 语音识别
    ↓
识别文本
    ↓
[NMT] 机器翻译
    ↓
翻译文本
    ↓
[TTS] 文本转语音
    ↓
语音输出 (base64 PCM16)
```

---

## 各服务说明

### 1. ASR (Automatic Speech Recognition) - 语音识别

- **服务**: faster-whisper-vad
- **端口**: 6007
- **端点**: `/utterance`
- **输入**:
  - `audio`: base64编码的Opus音频数据（Plan A格式）
  - `audio_format`: `"opus"`
  - `sample_rate`: `16000`
- **输出**:
  - `text`: 识别文本
  - `language`: 检测到的语言

### 2. NMT (Neural Machine Translation) - 机器翻译

- **服务**: nmt-m2m100
- **端口**: 5008
- **端点**: `/v1/translate` ✅ (已修复)
- **输入**:
  - `text`: ASR识别文本
  - `src_lang`: 源语言（如 `"zh"`）
  - `tgt_lang`: 目标语言（如 `"en"`）
  - `context_text`: 上下文文本
- **输出**:
  - `text`: 翻译文本
  - `confidence`: 置信度

### 3. TTS (Text-to-Speech) - 文本转语音

- **服务**: piper-tts
- **端口**: 5006
- **端点**: `/v1/tts/synthesize`
- **输入**:
  - `text`: NMT翻译文本
  - `lang`: 目标语言（如 `"en"`）
  - `voice_id`: 语音ID（可选）
  - `sample_rate`: `16000`
- **输出**:
  - `audio`: base64编码的PCM16音频
  - `audio_format`: `"pcm16"`
  - `sample_rate`: `16000`

---

## job_result消息格式

完整的Pipeline完成后，节点端会发送 `job_result` 消息给调度服务器：

```typescript
{
  type: 'job_result',
  job_id: string,
  attempt_id: number,
  node_id: string,
  session_id: string,
  utterance_index: number,
  success: boolean,
  text_asr: string,           // ASR识别结果
  text_translated: string,    // NMT翻译结果
  tts_audio: string,         // TTS音频（base64编码）
  tts_format: string,        // TTS音频格式（如 'pcm16'）
  extra?: object,
  processing_time_ms: number,
  trace_id: string,
  error?: {                  // 如果失败
    code: string,
    message: string,
    details?: object
  }
}
```

---

## 数据流转示例

### 输入
```json
{
  "audio": "base64_opus_audio_data...",
  "audio_format": "opus",
  "sample_rate": 16000,
  "src_lang": "zh",
  "tgt_lang": "en"
}
```

### ASR输出
```json
{
  "text": "你好世界",
  "language": "zh"
}
```

### NMT输出
```json
{
  "text": "Hello World",
  "confidence": 0.95
}
```

### TTS输出
```json
{
  "audio": "base64_pcm16_audio_data...",
  "audio_format": "pcm16",
  "sample_rate": 16000
}
```

### 最终job_result
```json
{
  "type": "job_result",
  "success": true,
  "text_asr": "你好世界",
  "text_translated": "Hello World",
  "tts_audio": "base64_pcm16_audio_data...",
  "tts_format": "pcm16"
}
```

---

## 错误处理

如果Pipeline中任何一步失败，整个流程会中断：

1. **ASR失败**: 不会执行NMT和TTS
2. **NMT失败**: 不会执行TTS
3. **TTS失败**: 返回部分结果（ASR和NMT成功）

错误信息会包含在 `job_result` 的 `error` 字段中。

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/PIPELINE_TEST_SUMMARY.md` - 测试总结
- `electron_node/services/faster_whisper_vad/docs/TEST_RESULTS_AND_FIX.md` - 测试结果和修复
- `electron_node/services/faster_whisper_vad/docs/PIPELINE_E2E_TEST_README.md` - 端到端测试说明

