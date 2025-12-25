# 集成测试错误分析报告

**日期**: 2025-12-25  
**状态**: ✅ **已修复TTS端点路径，ASR崩溃问题待进一步调查**

---

## 发现的错误

### 1. TTS服务404错误 ✅ 已修复

**错误信息**:
```
Request failed with status code 404
baseURL: http://127.0.0.1:5006
url: /v1/tts/synthesize
```

**根本原因**:
- 节点端请求路径：`/v1/tts/synthesize`
- TTS服务实际端点：`/tts`
- 路径不匹配导致404错误

**修复方案**:
- 修改 `electron_node/electron-node/main/src/task-router/task-router.ts`
- 将端点路径从 `/v1/tts/synthesize` 改为 `/tts`
- 调整请求体格式以匹配TTS服务的`TtsRequest`模型：
  - `lang` → `language`
  - `voice_id` → `voice`
  - 移除不支持的字段（`speaker_id`, `sample_rate`）
- 处理响应：TTS服务返回WAV二进制数据，需要转换为base64

**修复代码**:
```typescript
// 修复前
const response = await httpClient.post('/v1/tts/synthesize', {
  text: task.text,
  lang: task.lang,
  voice_id: task.voice_id,
  speaker_id: task.speaker_id,
  sample_rate: task.sample_rate || 16000,
});

// 修复后
const response = await httpClient.post('/tts', {
  text: task.text,
  voice: task.voice_id || 'zh_CN-huayan-medium',
  language: task.lang || 'zh',
}, {
  responseType: 'arraybuffer', // WAV二进制数据
});

// 转换为base64
const audioBuffer = Buffer.from(response.data);
const audioBase64 = audioBuffer.toString('base64');
```

---

### 2. ASR服务崩溃 ⚠️ 待进一步调查

**错误信息**:
```
read ECONNRESET
Python service process exited with code 3221225477
```

**退出代码分析**:
- `3221225477` (0xC0000005) = Windows访问违规错误
- 通常表示段错误或内存访问错误
- 发生在处理Opus解码后的ASR阶段

**日志分析**:
```
INFO:audio_decoder:[job-8EC136AC] Successfully decoded Opus packets: 3840 samples
INFO:__main__:[job-8EC136AC] VAD检测到1个语音段，已提取有效语音
INFO:faster_whisper:Processing audio with duration 00:00.240
[服务崩溃，无后续日志]
```

**可能原因**:
1. **Faster Whisper模型问题**: 在处理音频时发生内存访问错误
2. **CUDA/GPU问题**: 如果使用GPU，可能是CUDA内存访问错误
3. **音频数据问题**: 解码后的音频数据可能有问题
4. **并发问题**: 多个请求同时处理时可能发生竞争条件

**建议调查方向**:
1. 检查Faster Whisper模型加载和推理代码
2. 检查CUDA内存使用情况
3. 添加更多异常处理和日志
4. 检查是否有内存泄漏或缓冲区溢出

---

## 修复状态

### ✅ TTS端点路径修复
- **文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`
- **状态**: 已修复
- **需要**: 重新编译TypeScript代码

### ⚠️ ASR服务崩溃
- **状态**: 待进一步调查
- **建议**: 
  1. 检查Faster Whisper服务日志
  2. 检查是否有内存问题
  3. 考虑添加更多错误处理

---

## 下一步

1. **重新编译TypeScript代码**: `npm run build:main`
2. **重启节点端**: 使TTS端点修复生效
3. **重新测试**: 验证TTS服务是否正常工作
4. **调查ASR崩溃**: 检查Faster Whisper服务日志和代码

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - 已修复TTS端点
- `electron_node/services/piper_tts/piper_http_server.py` - TTS服务实现
- `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log` - ASR服务日志

