# Error Analysis (Part 1/4)

# Error Analysis

本文档合并了所有相关文档。

---

## ERROR_404_ANALYSIS.md

# 404错误分析报告

**日期**: 2025-12-24  
**问题**: job-556E716C返回404错误，但服务端返回200 OK  
**状态**: 🔍 **问题已定位**

---

## 错误现象

### 调度服务器日志

```
{"timestamp":"2025-12-24T15:12:23.7117437Z","level":"INFO","fields":{"message":"Received node message (length: 308): {\"type\":\"job_result\",\"job_id\":\"job-556E716C\",\"attempt_id\":1,\"node_id\":\"node-6D149F8E\",\"session_id\":\"s-BAFEA97F\",\"utterance_index\":1,\"success\":false,\"processing_time_ms\":1243,\"error\":{\"code\":\"PROCESSING_ERROR\",\"message\":\"Request failed with status code 404\"},\"trace_id\":\"dff4fb04-7c98-4b61-a983-faa35f6f9842\"}"}
```

**关键信息**:
- job_id: `job-556E716C`
- 错误: `Request failed with status code 404`
- 处理时间: 1243ms

### 服务端日志

```
2025-12-24T15:12:21.590Z [INFO] INFO:__main__:[job-556E716C] Received utterance request: job_id=job-556E716C, audio_format=opus, sample_rate=16000
2025-12-24T15:12:21.590Z [INFO] INFO:audio_decoder:[job-556E716C] Detected Opus packet format (Plan A): packet_len=47, total_bytes=8978
2025-12-24T15:12:21.628Z [INFO] INFO:audio_decoder:[job-556E716C] Successfully decoded Opus packets: 3840 samples at 16000Hz
2025-12-24T15:12:22.790Z [INFO] INFO:     127.0.0.1:64175 - "POST /utterance HTTP/1.1" 200 OK
```

**关键信息**:
- 服务端成功接收请求
- 成功检测到packet格式
- 成功解码
- **返回200 OK** ✅

---

## 问题分析

### 矛盾点

1. **服务端返回200 OK**，但**节点端报告404错误**
2. 这说明问题出在**节点端和服务端之间的通信**，而不是服务端处理

### 可能的原因

1. **节点端请求URL错误**：
   - 节点端可能请求了错误的端点
   - 例如：`/utterance` vs `/utterances` vs `/api/utterance`

2. **节点端处理响应时出错**：
   - 服务端返回200 OK，但响应体格式不正确
   - 节点端解析响应时出错，误报404

3. **HTTP客户端配置问题**：
   - Axios配置错误
   - baseURL设置不正确
   - 请求路径拼接错误

---

## 需要检查

### 1. 节点端task-router代码

**文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`

**检查点**:
- `routeASRTask()`方法中的URL构建
- `httpClient.post()`的URL参数
- baseURL和requestUrl的拼接

### 2. 节点端日志

**需要查看**:
- 节点端的HTTP请求日志
- 请求的完整URL
- 响应的状态码和内容

### 3. 服务端端点定义

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**检查点**:
- `/utterance`端点的定义
- FastAPI路由配置

---

## 下一步行动

1. **检查节点端task-router代码**，确认URL构建逻辑
2. **查看节点端日志**，确认实际请求的URL
3. **检查服务端端点定义**，确认端点路径
4. **对比URL**，找出不匹配的地方

---

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - 节点端路由逻辑
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 服务端端点定义
- `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log` - 服务端日志
- `central_server/scheduler/logs/scheduler.log` - 调度服务器日志



---

## ERROR_ANALYSIS_404_400.md

# 404/400错误分析报告

**日期**: 2025-12-24  
**问题**: 调度服务器报告404错误，服务端报告400错误  
**状态**: 🔍 **问题已定位，需要修复**

---

## 错误现象

### 调度服务器日志
```
job-62962106: 第一次返回404错误，第二次返回400错误
job-249A0BF0: 返回400错误
job-FDC19742: 返回400错误
```

### 服务端日志

#### 第一个请求（job-62962106）- 成功 ✅
```
[INFO] Detected Opus packet format: packet_len=73, total_bytes=8352
[INFO] Using Plan A: Opus packet decoding pipeline
[INFO] Successfully decoded Opus packets: 3840 samples at 16000Hz
[INFO] POST /utterance HTTP/1.1" 200 OK
```

#### 第一个请求（job-62962106）- 第二次请求（同一个job_id）- 失败 ❌
```
[WARN] Opus data is not in packet format
[ERROR] Failed to decode Opus audio (continuous byte stream method)
[INFO] POST /utterance HTTP/1.1" 400 Bad Request
```

#### 后续请求 - 失败 ❌
```
job-249A0BF0: Opus data is not in packet format → 400错误
job-FDC19742: Opus data is not in packet format → 400错误
```

---

## 问题分析

### 1. 数据格式不一致

**现象**：
- 第一个请求的数据格式正确（packet格式）
- 后续请求的数据格式不正确（非packet格式）

**可能原因**：
1. **Web端发送逻辑问题**：第一次发送时使用了`encodePackets()`，后续发送时可能使用了`encode()`方法
2. **数据在传输过程中被修改**：调度服务器或节点端在转发数据时可能修改了数据格式
3. **Base64编码/解码问题**：Base64编码/解码可能导致数据格式变化

### 2. 404错误的原因

**现象**：
- 服务端返回200 OK
- 但调度服务器报告404错误

**可能原因**：
1. **节点端返回结果给调度服务器时出错**：节点端成功处理请求，但在返回结果时出现问题
2. **调度服务器等待超时**：节点端处理时间过长，调度服务器在等待结果时超时
3. **HTTP请求路径错误**：节点端在返回结果时使用了错误的URL

---

## 解决方案

### 方案1: 修复Web端发送逻辑（优先）

**问题**：Web端可能在某些情况下没有使用`encodePackets()`方法

**检查点**：
1. 确认`sendUtterance()`方法始终使用`encodePackets()`
2. 确认`encodePackets()`方法在所有情况下都可用
3. 添加日志记录每次发送时使用的编码方法

**修复建议**：
```typescript
// 在 sendUtterance() 中添加日志
if (encoder.encodePackets && typeof encoder.encodePackets === 'function') {
  console.log('Using encodePackets() for Plan A format');
  opusPackets = await encoder.encodePackets(audioData);
} else {
  console.error('encodePackets() not available, falling back to encode()');
  // 应该抛出错误，而不是回退
  throw new Error('Opus encoder does not support encodePackets. Plan A format requires encodePackets().');
}
```

### 方案2: 增强数据格式检测

**问题**：当前的数据格式检测可能不够严格

**修复建议**：
1. 在服务端添加更严格的数据格式验证
2. 如果检测到非packet格式，直接返回明确的错误信息，而不是尝试连续字节流解码
3. 添加数据格式的详细日志

### 方案3: 修复节点端返回结果逻辑

**问题**：节点端可能没有正确返回结果给调度服务器

**检查点**：
1. 检查节点端的`task-router.ts`中的错误处理逻辑
2. 确认节点端在成功处理请求后正确返回结果
3. 添加日志记录节点端返回结果的过程

---

## 立即行动

### 1. 检查Web端发送逻辑

**文件**: `webapp/web-client/src/websocket_client.ts`

**检查**：
- `sendUtterance()`方法是否始终使用`encodePackets()`
- 是否有回退逻辑导致使用`encode()`方法
- 添加日志记录每次发送时使用的编码方法

### 2. 增强服务端日志

**文件**: `electron_node/services/faster_whisper_vad/audio_decoder.py`

**添加**：
- 记录接收到的数据的前几个字节（用于调试）
- 记录数据格式检测的详细过程
- 记录Base64解码后的数据大小

### 3. 检查节点端返回结果逻辑

**文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`

**检查**：
- 确认在成功处理请求后正确返回结果
- 添加日志记录返回结果的过程
- 检查错误处理逻辑

---

## 调试步骤

### 步骤1: 检查Web端日志

在浏览器控制台中查看：
- 每次发送utterance时使用的编码方法
- 发送的数据大小和格式

### 步骤2: 检查服务端日志

查看`faster-whisper-vad-service.log`：
- 每次请求的数据格式检测结果
- 接收到的数据的前几个字节（用于验证格式）

### 步骤3: 检查节点端日志

查看节点端的控制台输出：
- 服务端点刷新日志
- HTTP请求和响应日志
- 错误处理日志

---

## 预期修复后的行为

1. **所有请求都使用packet格式**：Web端始终使用`encodePackets()`方法
2. **服务端正确检测格式**：所有请求都能检测到packet格式
3. **节点端正确返回结果**：节点端在成功处理请求后正确返回结果给调度服务器
4. **调度服务器不再报告404错误**：所有请求都能正确完成

---

## 相关文件

- `webapp/web-client/src/websocket_client.ts` - Web端发送逻辑
- `electron_node/services/faster_whisper_vad/audio_decoder.py` - 服务端解码逻辑
- `electron_node/electron-node/main/src/task-router/task-router.ts` - 节点端路由逻辑
- `central_server/scheduler/src/websocket/session_message_handler/utterance.rs` - 调度服务器处理逻辑



---

## ERROR_ANALYSIS_INTEGRATION_TEST.md

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



---

## ERROR_ROOT_CAUSE_ANALYSIS.md

# 报错根本原因分析

**日期**: 2025-12-24  
**问题**: 为什么报错原因是收到了utterance和audio_chunk两种格式的数据流？  
**状态**: ✅ **已澄清**

---

## 关键澄清

### 节点端实际接收的消息

✅ **节点端只接收`JobAssignMessage`**，不会直接接收`utterance`或`audio_chunk`消息。

但是，**`JobAssignMessage`中的数据可能来自两个不同的来源**：
1. **`utterance`消息**（Web端手动发送）
2. **`audio_chunk`消息合并**（Web端流式发送，调度服务器finalize）

---

## 问题根源

### 数据流路径

#### 路径1: Utterance消息 → JobAssignMessage

```
Web端
  → sendUtterance() [使用encodePackets() + Plan A格式] ✅
  → utterance消息（packet格式）
  
调度服务器
  → handle_utterance()
  → 直接创建job（packet格式）
  → JobAssignMessage（packet格式）
  
节点端
  → 接收JobAssignMessage（packet格式）✅
  → 服务端检测到packet格式 ✅
```

#### 路径2: AudioChunk消息 → JobAssignMessage（修复前）

```
Web端
  → sendAudioChunk() [使用encode()方法] ❌
  → audio_chunk消息（连续字节流）
  
调度服务器
  → handle_audio_chunk()
  → audio_buffer.add_chunk()（连续字节流）
  → finalize（合并所有chunk）
  → 创建job（连续字节流）
  → JobAssignMessage（连续字节流）
  
节点端
  → 接收JobAssignMessage（连续字节流）❌
  → 服务端检测不到packet格式 ❌
```

---