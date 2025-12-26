# 测试完整文档 (Part 6/13)



---

## PIPELINE_COMPLETE_SUMMARY.md

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



---

## PIPELINE_E2E_TEST_README.md

# 节点端Pipeline端到端测试说明

**日期**: 2025-12-25  
**目的**: 验证节点端完整服务流程（ASR → NMT）能正确工作并将结果返回给调度服务器

---

## 测试范围

### 1. 服务健康检查
- faster-whisper-vad 服务 (端口 6007)
- nmt-m2m100 服务 (端口 5008)

### 2. ASR服务测试
- 发送Opus音频数据（Plan A格式）
- 验证识别结果

### 3. NMT服务测试
- 发送ASR识别文本
- 验证翻译结果

### 4. TTS服务测试
- 发送NMT翻译文本
- 验证语音音频生成

### 5. 完整Pipeline测试
- ASR → NMT → TTS 完整流程
- 验证数据能正确流转

---

## 运行测试

### 前置条件

1. **确保服务正在运行**：
   ```bash
   # faster-whisper-vad 应该在端口 6007
   # nmt-m2m100 应该在端口 5008
   # piper-tts 应该在端口 5006
   ```

2. **编译TypeScript代码**：
   ```bash
   cd electron_node/electron-node
   npm run build:main
   ```

3. **运行测试**：
   ```bash
   # 使用Node.js直接运行编译后的JS文件
   node main/electron-node/main/src/tests/pipeline-e2e-test.js
   
   # 或者使用ts-node（如果已安装）
   npx ts-node tests/pipeline-e2e-test.ts
   ```

---

## 测试输出

### 成功示例
```
============================================================
节点端Pipeline端到端测试
============================================================

[步骤1] 检查服务健康状态
✅ 服务健康检查

[测试完整Pipeline]
  1. 测试ASR服务...
✅ ASR服务
   详情: {
      "text": "你好世界",
      "language": "zh"
    }
  2. 测试NMT服务...
✅ NMT服务
   详情: {
      "translated": "Hello World"
    }
  3. 测试TTS服务...
✅ TTS服务
   详情: {
      "audio_length": 12345
    }
  4. 验证结果...
✅ 完整Pipeline测试
   详情: {
      "asr_text": "你好世界",
      "translated_text": "Hello World"
    }

============================================================
测试总结
============================================================
总计: 4 个测试
通过: 4 个
失败: 0 个

============================================================
✅ 所有测试通过！Pipeline工作正常。
```

### 失败示例
```
❌ ASR服务测试: Request failed with status code 404
   详情: {
     "status": 404,
     "data": {...}
   }
```

---

## 注意事项

1. **测试音频数据**：
   - 当前测试使用模拟的Opus数据
   - 实际测试中应使用真实的Opus编码音频文件
   - 音频格式必须符合Plan A规范（length-prefixed packets）

2. **服务端点**：
   - ASR: `http://127.0.0.1:6007/utterance`
   - NMT: `http://127.0.0.1:5008/v1/translate` ✅ (已修复)
   - TTS: `http://127.0.0.1:5006/synthesize`

3. **超时设置**：
   - ASR: 30秒
   - NMT: 30秒

4. **错误处理**：
   - 如果服务不可用，测试会立即失败
   - 详细的错误信息会显示在测试输出中

---

## 相关文件

- `electron_node/electron-node/tests/pipeline-e2e-test.ts` - 测试脚本
- `electron_node/electron-node/main/src/task-router/task-router.ts` - 任务路由（已修复NMT端点）
- `electron_node/services/faster_whisper_vad/docs/NMT_404_FIX_SUMMARY.md` - NMT端点修复说明

---

## 下一步

1. ✅ 修复NMT端点路径（已完成）
2. ✅ 创建端到端测试脚本（已完成）
3. ⏳ 运行测试验证修复
4. ⏳ 如果测试通过，验证数据能正确返回给调度服务器



---

## PIPELINE_TEST_FINAL_REPORT.md

# 节点端Pipeline测试最终报告

**日期**: 2025-12-25  
**状态**: ✅ **所有修复已完成，等待实际请求验证**

---

## 测试结果总结

### ✅ 已完成的工作

1. **修复NMT端点路径** ✅
   - 源代码: `/v1/nmt/translate` → `/v1/translate`
   - 编译文件: 已更新并验证
   - 文件路径: `main/electron-node/main/src/task-router/task-router.js`

2. **清理缓存** ✅
   - TypeScript编译输出: 已清理并重新编译
   - Electron应用数据缓存: 已清理
   - 日志文件: 已清理195个文件
   - 编译文件验证: 包含正确的NMT端点 `/v1/translate`

3. **创建测试工具** ✅
   - 端到端测试脚本: `tests/pipeline-e2e-test-simple.js`
   - 缓存清理脚本: `scripts/clear-cache.ps1`
   - npm命令: `npm run test:pipeline` 和 `npm run clear-cache`

4. **更新文档** ✅
   - Pipeline流程说明
   - 测试报告和验证文档
   - 缓存清理总结

---

## 完整Pipeline流程

```
音频输入 (Opus Plan A)
    ↓
[ASR] faster-whisper-vad (端口 6007)
    ↓
识别文本
    ↓
[NMT] nmt-m2m100 (端口 5008) - 端点: /v1/translate ✅
    ↓
翻译文本
    ↓
[TTS] piper-tts (端口 5006)
    ↓
语音输出 (base64 PCM16)
    ↓
job_result → 调度服务器
```

---

## 验证方法

### 当前状态
- ✅ 编译文件已更新
- ✅ 缓存已清理
- ⏳ 等待实际请求验证

### 验证步骤

#### 1. 通过Web客户端发送音频
- 启动Web客户端
- 发送音频数据
- 观察Pipeline处理过程

#### 2. 检查节点端日志

```powershell
# 检查NMT请求路径（应该看到 /v1/translate，不是 /v1/nmt/translate）
cd electron_node/electron-node
Get-Content "logs\electron-main.log" | Select-String -Pattern "url.*translate" | Select-Object -Last 5

# 检查Pipeline完成情况
Get-Content "logs\electron-main.log" | Select-String -Pattern "NMT task completed|TTS task completed|Pipeline orchestration completed" | Select-Object -Last 10

# 检查job_result
Get-Content "logs\electron-main.log" | Select-String -Pattern "Sending job_result|job_result.*success" | Select-Object -Last 10
```

#### 3. 检查调度服务器日志

```powershell
# 检查成功的Pipeline案例
cd central_server/scheduler
Get-Content "logs\scheduler.log" | Select-String -Pattern "text_translated.*[A-Za-z]|tts_audio_len.*[1-9]" | Select-Object -Last 10
```

---

## 预期结果

### 成功的Pipeline日志应该显示：

**节点端日志**:
```
✅ ASR: faster-whisper-vad request succeeded (200 OK)
✅ NMT: url="/v1/translate" (不是 /v1/nmt/translate)
✅ NMT: NMT task completed
✅ TTS: TTS task completed
✅ Pipeline: Pipeline orchestration completed
✅ job_result: Sending job_result to scheduler (success: true)
```

**调度服务器日志**:
```
✅ job_result: success: true
✅ text_asr: "识别文本"
✅ text_translated: "Translated text"
✅ tts_audio_len: 12345 (非零)
```

---

## 关键修复点

### NMT端点路径修复
- **旧路径**: `/v1/nmt/translate` ❌
- **新路径**: `/v1/translate` ✅
- **文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`
- **状态**: 已修复并重新编译

### 编译文件验证
```javascript
// 文件: main/electron-node/main/src/task-router/task-router.js
// 第516行
const response = await httpClient.post('/v1/translate', {
    text: task.text,
    src_lang: task.src_lang,
    tgt_lang: task.tgt_lang,
    context_text: task.context_text,
});
```

---

## 相关文件

### 源代码
- `electron_node/electron-node/main/src/task-router/task-router.ts` - 已修复

### 编译文件
- `electron_node/electron-node/main/electron-node/main/src/task-router/task-router.js` - 已更新

### 测试脚本
- `electron_node/electron-node/tests/pipeline-e2e-test-simple.js` - 端到端测试
- `electron_node/electron-node/scripts/clear-cache.ps1` - 缓存清理脚本

### 文档
- `electron_node/services/faster_whisper_vad/docs/PIPELINE_COMPLETE_SUMMARY.md` - Pipeline流程说明
