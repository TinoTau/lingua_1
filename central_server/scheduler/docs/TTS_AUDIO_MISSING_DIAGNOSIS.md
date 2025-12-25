# TTS 音频缺失问题诊断指南

**问题描述**: 测试时完全没有可以播放的音频，只有原文和译文的显示

---

## 诊断步骤

### 1. 检查调度服务器日志

查看调度服务器日志文件，搜索以下关键词：

#### 1.1 检查节点返回的 TTS 音频

```bash
# 搜索 job_result 消息
grep "Received JobResult" logs/scheduler.log

# 检查 tts_audio_len（应该 > 0）
grep "tts_audio_len" logs/scheduler.log
```

**预期日志**:
```
INFO Received JobResult, adding to result queue job_id=xxx tts_audio_len=123624
INFO Sending translation result to session (single mode) tts_audio_len=123624
```

**问题日志**:
```
INFO Received JobResult, adding to result queue job_id=xxx tts_audio_len=0
WARN Skipping empty translation result (silence detected), not forwarding to web client
```

#### 1.2 检查是否跳过空结果

```bash
grep "Skipping empty translation result" logs/scheduler.log
```

如果看到这个警告，说明：
- 节点返回的 `tts_audio` 为空字符串
- 调度服务器正确过滤了空结果（这是预期行为）

---

### 2. 检查节点端日志

查看节点端日志，搜索以下关键词：

#### 2.1 检查 TTS 任务是否成功

```bash
# 搜索 TTS 任务完成日志
grep "TTS task completed" node.log

# 检查 Opus 编码日志
grep "TTS audio encoded to Opus format" node.log
grep "Failed to encode TTS audio to Opus" node.log
```

**预期日志**:
```
INFO TTS audio encoded to Opus format originalSize=64044 opusSize=6114 compressionRatio=10.47
```

**问题日志**:
```
WARN Failed to encode TTS audio to Opus, falling back to PCM16 error=...
ERROR TTS task failed error=...
```

#### 2.2 检查 WAV 解析是否成功

```bash
# 搜索 WAV 解析错误
grep "parseWavFile\|Invalid WAV\|WAV file" node.log
```

**可能的问题**:
- WAV 文件格式不正确
- WAV 文件为空
- WAV 解析函数抛出异常

#### 2.3 检查 TTS 服务响应

```bash
# 搜索 TTS 服务调用
grep "routeTTSTask\|TTS service" node.log
```

**可能的问题**:
- TTS 服务返回空响应
- TTS 服务返回错误
- HTTP 请求失败

---

### 3. 检查 Web 端控制台日志

打开浏览器开发者工具（F12），查看 Console 标签：

#### 3.1 检查是否收到 TTS 音频

**预期日志**:
```
[App] 🎵 准备添加 TTS 音频到缓冲区: {utterance_index: 0, base64_length: 8152, ...}
[App] 🎧 单会话模式：添加到 TtsPlayer
TtsPlayer: 添加音频块，当前状态: idle base64长度: 8152 utteranceIndex: 0 format: opus
TtsPlayer: 音频块已添加到缓冲区，缓冲区大小: 1
[App] ✅ TTS 音频块已成功添加到缓冲区
```

**问题日志**:
```
[App] ⚠️ 翻译结果中没有 TTS 音频: {utterance_index: 0, has_tts_audio: false, tts_audio_length: 0}
```

#### 3.2 检查音频解码错误

**问题日志**:
```
TtsPlayer: 添加音频块时出错: Error: Opus decoder not initialized
TtsPlayer: 添加音频块时出错: Error: Invalid audio format
[App] ❌ 添加 TTS 音频块失败: {error: ...}
```

---

## 常见问题及解决方案

### 问题 1: 节点端 Opus 编码失败

**症状**:
- 节点日志显示: `WARN Failed to encode TTS audio to Opus, falling back to PCM16`
- 但最终返回的 `tts_audio` 仍为空

**可能原因**:
1. WAV 解析失败，导致 `pcm16Data` 为空
2. Opus 编码器初始化失败
3. 编码过程中抛出异常，但异常被捕获后没有正确处理

**解决方案**:
1. 检查节点端是否安装了 `opusscript`: `npm list opusscript`
2. 检查 WAV 文件是否有效（查看 TTS 服务返回的原始数据）
3. 查看节点端完整错误堆栈

**检查代码位置**:
- `electron_node/electron-node/main/src/task-router/task-router.ts:652-694`
- `electron_node/electron-node/main/src/utils/opus-encoder.ts:130-210`

---

### 问题 2: TTS 服务返回空音频

**症状**:
- 节点日志显示 TTS 任务完成，但 `tts_audio` 为空
- 调度服务器日志显示 `tts_audio_len=0`

**可能原因**:
1. TTS 服务返回空的 WAV 文件
2. TTS 服务返回错误但被忽略
3. HTTP 响应为空

**解决方案**:
1. 检查 TTS 服务是否正常运行
2. 检查 TTS 服务日志
3. 验证 TTS 服务返回的 HTTP 响应大小

**检查代码位置**:
- `electron_node/electron-node/main/src/task-router/task-router.ts:635-642`

---

### 问题 3: WAV 文件解析失败

**症状**:
- 节点日志显示 WAV 解析错误
- `parseWavFile` 抛出异常

**可能原因**:
1. WAV 文件格式不正确（不是标准的 RIFF/WAVE 格式）
2. WAV 文件损坏
3. WAV 文件头信息缺失

**解决方案**:
1. 检查 TTS 服务返回的 WAV 文件格式
2. 验证 WAV 文件头（前 44 字节）
3. 添加更详细的错误日志

**检查代码位置**:
- `electron_node/electron-node/main/src/utils/opus-encoder.ts:25-121`

---

### 问题 4: 调度服务器过滤空音频

**症状**:
- 调度服务器日志显示: `WARN Skipping empty translation result (silence detected)`
- Web 端没有收到 `translation_result` 消息

**说明**:
这是**预期行为**。如果 ASR、NMT 和 TTS 都为空，调度服务器会跳过转发，避免发送无意义的结果。

**但如果只有 TTS 为空，而 ASR 和 NMT 有内容**，应该仍然转发。

**检查代码位置**:
- `central_server/scheduler/src/websocket/node_handler/message/job_result.rs:358-382`

---

### 问题 5: Web 端音频解码失败

**症状**:
- Web 端收到 `translation_result`，但控制台显示解码错误
- `TtsPlayer` 无法添加音频块

**可能原因**:
1. Opus 解码器未正确初始化
2. Base64 解码失败
3. 音频格式不匹配

**解决方案**:
1. 检查 `tts_format` 字段是否正确（应该是 `opus` 或 `pcm16`）
2. 检查 `audio_codec.ts` 中的解码器实现
3. 验证 Base64 数据是否有效

**检查代码位置**:
- `webapp/web-client/src/tts_player.ts:278-343`
- `webapp/web-client/src/audio_codec.ts`

---

## 快速诊断命令

### 调度服务器端

```bash
# 检查最近的 job_result 消息
tail -100 logs/scheduler.log | grep -E "job_result|tts_audio_len|Skipping empty"

# 检查是否有 TTS 音频发送
tail -100 logs/scheduler.log | grep -E "Sending translation result|tts_audio_len"
```

### 节点端

```bash
# 检查 TTS 任务和 Opus 编码
tail -100 node.log | grep -E "TTS|Opus|encodePcm16ToOpus|parseWavFile"

# 检查错误
tail -100 node.log | grep -E "ERROR|WARN.*TTS|WARN.*Opus"
```

### Web 端

在浏览器控制台运行：

```javascript
// 检查 TtsPlayer 状态
console.log('TtsPlayer state:', window.app?.ttsPlayer?.audioBuffers?.length);
console.log('Has pending audio:', window.app?.ttsPlayer?.hasPendingAudio());
```

---

## 调试建议

1. **启用详细日志**:
   - 节点端: 设置日志级别为 `debug`
   - 调度服务器: 检查日志级别配置

2. **添加临时日志**:
   - 在 `task-router.ts` 的 `routeTTSTask` 中添加日志，记录 WAV 文件大小
   - 在 `opus-encoder.ts` 中添加日志，记录编码前后的数据大小

3. **验证数据流**:
   - 节点端: 验证 TTS 服务返回的原始 WAV 数据
   - 调度服务器: 验证收到的 `job_result` 中的 `tts_audio` 字段
   - Web 端: 验证收到的 `translation_result` 中的 `tts_audio` 字段

---

## 相关文件

- **节点端 TTS 路由**: `electron_node/electron-node/main/src/task-router/task-router.ts`
- **Opus 编码器**: `electron_node/electron-node/main/src/utils/opus-encoder.ts`
- **调度服务器结果处理**: `central_server/scheduler/src/websocket/node_handler/message/job_result.rs`
- **Web 端音频播放**: `webapp/web-client/src/tts_player.ts`
- **Web 端消息处理**: `webapp/web-client/src/app.ts`

