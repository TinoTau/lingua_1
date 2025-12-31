# TTS 音频缺失日志分析指南

## 问题描述

TTS 没有生成语音，需要查看日志定位问题，特别是 Opus 压缩是否出错。

## 日志检查步骤

### 1. 检查 TTS 任务是否启动

**搜索关键字**：
```
TTSStage: Starting TTS task
```

**期望看到**：
```json
{
  "jobId": "job-xxx",
  "sessionId": "session-xxx",
  "textLength": 10,
  "tgtLang": "en"
}
```

**如果没有看到**：
- 可能翻译文本为空
- 可能 `tgt_lang` 缺失
- 可能 `TaskRouter` 不可用

### 2. 检查 TTS 服务调用

**搜索关键字**：
```
TTS task failed
```

**期望看到**：
- 如果没有错误，应该看到 `TTS audio encoded to Opus successfully`

**如果看到错误**：
```json
{
  "error": "...",
  "serviceId": "tts-service-xxx",
  "errorMessage": "...",
  "status": 500,
  "statusText": "Internal Server Error"
}
```

**可能原因**：
- TTS 服务不可用
- TTS 服务返回错误
- 网络超时

### 3. 检查 Opus 编码器是否可用

**搜索关键字**：
```
Opus encoder is not available
```

**如果看到**：
```json
{
  "serviceId": "tts-service-xxx",
  "reason": "not_initialized" | "disabled_by_env",
  "opusEncodingEnabled": true
}
```

**可能原因**：
- Opus 编码器初始化失败
- `@minceraftmc/opus-encoder` 模块加载失败
- WASM 编译失败

**检查初始化日志**：
```
Opus encoder initialized: sampleRate=16000, channels=1
Failed to initialize Opus encoder
```

### 4. 检查 WAV 文件解析

**搜索关键字**：
```
Invalid WAV file
parseWavFile
```

**如果看到错误**：
```
Invalid WAV file: too short
Invalid WAV file: missing RIFF header
Invalid WAV file: missing WAVE header
Invalid WAV file: fmt chunk not found
Invalid WAV file: data chunk not found
Unsupported audio format: X (only PCM format 1 is supported)
```

**可能原因**：
- TTS 服务返回的不是有效的 WAV 文件
- WAV 文件格式不正确
- WAV 文件损坏

### 5. 检查 Opus 编码过程

**搜索关键字**：
```
TTS: Opus encoding failed
Failed to encode PCM16 to Opus
```

**如果看到错误**：
```json
{
  "error": "...",
  "serviceId": "tts-service-xxx",
  "wavSize": 12345,
  "errorMessage": "...",
  "errorStack": "..."
}
```

**可能原因**：
- Opus 编码器实例为 null
- 编码过程中抛出异常
- 内存不足
- WASM 运行时错误

**检查编码成功日志**：
```
TTS audio encoded to Opus successfully
{
  "serviceId": "tts-service-xxx",
  "wavSize": 12345,
  "opusSize": 1234,
  "compression": "10.00",
  "audioDurationMs": 500
}
```

### 6. 检查 TTSStage 错误处理

**搜索关键字**：
```
TTSStage: TTS task failed (Opus encoding or other error), returning empty audio
```

**如果看到**：
```json
{
  "error": "...",
  "jobId": "job-xxx",
  "sessionId": "session-xxx",
  "translatedText": "...",
  "errorMessage": "..."
}
```

**说明**：
- TTS 生成失败，但返回了空音频（确保任务仍然返回结果）
- 需要查看 `errorMessage` 了解具体错误

### 7. 检查 PostProcessCoordinator 错误处理

**搜索关键字**：
```
PostProcessCoordinator: TTS generation failed, continuing with empty audio
```

**如果看到**：
```json
{
  "error": "...",
  "jobId": "job-xxx",
  "sessionId": "session-xxx",
  "translatedText": "..."
}
```

**说明**：
- PostProcessCoordinator 捕获了 TTS 错误
- 返回了空音频，但任务仍然返回结果

### 8. 检查格式验证

**搜索关键字**：
```
TTSStage: TaskRouter must return Opus format, but received non-Opus format
```

**如果看到**：
```json
{
  "jobId": "job-xxx",
  "sessionId": "session-xxx",
  "receivedFormat": "pcm16" | "wav" | null
}
```

**说明**：
- TaskRouter 返回的格式不是 Opus
- 这不应该发生（因为代码强制使用 Opus）

## 常见错误场景

### 场景 1: Opus 编码器初始化失败

**日志特征**：
```
Failed to initialize Opus encoder
{
  "error": "Cannot find module '@minceraftmc/opus-encoder'"
}
```

**可能原因**：
- `@minceraftmc/opus-encoder` 未安装
- 模块路径错误
- WASM 文件缺失

**解决方案**：
1. 检查 `package.json` 是否包含 `@minceraftmc/opus-encoder`
2. 运行 `npm install`
3. 检查 `node_modules/@minceraftmc/opus-encoder` 是否存在

### 场景 2: WAV 文件解析失败

**日志特征**：
```
Invalid WAV file: too short
TTS: Opus encoding failed
```

**可能原因**：
- TTS 服务返回空响应
- TTS 服务返回错误响应（HTML 错误页面）
- 网络问题导致数据不完整

**解决方案**：
1. 检查 TTS 服务是否正常运行
2. 检查 TTS 服务日志
3. 检查网络连接

### 场景 3: Opus 编码过程失败

**日志特征**：
```
Failed to encode PCM16 to Opus
{
  "error": "encoderInstance is null"
}
```

**可能原因**：
- 编码器实例未正确初始化
- 编码器被释放
- 并发访问导致竞态条件

**解决方案**：
1. 检查编码器初始化日志
2. 检查是否有并发访问
3. 检查内存使用情况

### 场景 4: TTS 服务调用失败

**日志特征**：
```
TTS task failed
{
  "error": "Request failed with status code 500",
  "status": 500,
  "statusText": "Internal Server Error"
}
```

**可能原因**：
- TTS 服务内部错误
- TTS 服务超时
- TTS 服务不可用

**解决方案**：
1. 检查 TTS 服务日志
2. 检查 TTS 服务状态
3. 检查服务配置

## 日志搜索命令

### PowerShell (Windows)
```powershell
# 搜索 TTS 相关错误
Select-String -Path "*.log" -Pattern "TTS.*fail|Opus.*fail|TTS.*error" -Context 5

# 搜索 Opus 编码错误
Select-String -Path "*.log" -Pattern "Opus encoding failed|Failed to encode" -Context 10

# 搜索 TTS 任务启动
Select-String -Path "*.log" -Pattern "TTSStage: Starting TTS task" -Context 3
```

### Bash (Linux/Mac)
```bash
# 搜索 TTS 相关错误
grep -i "TTS.*fail\|Opus.*fail\|TTS.*error" *.log -A 5 -B 5

# 搜索 Opus 编码错误
grep -i "Opus encoding failed\|Failed to encode" *.log -A 10 -B 5

# 搜索 TTS 任务启动
grep -i "TTSStage: Starting TTS task" *.log -A 3 -B 3
```

## 检查清单

- [ ] TTS 任务是否启动？（搜索 `TTSStage: Starting TTS task`）
- [ ] TTS 服务调用是否成功？（搜索 `TTS task failed`）
- [ ] Opus 编码器是否可用？（搜索 `Opus encoder is not available`）
- [ ] WAV 文件解析是否成功？（搜索 `Invalid WAV file`）
- [ ] Opus 编码是否成功？（搜索 `TTS audio encoded to Opus successfully`）
- [ ] TTSStage 是否捕获错误？（搜索 `TTSStage: TTS task failed`）
- [ ] PostProcessCoordinator 是否捕获错误？（搜索 `PostProcessCoordinator: TTS generation failed`）
- [ ] 格式验证是否通过？（搜索 `TaskRouter must return Opus format`）

## 下一步

根据日志分析结果：
1. **如果是 Opus 编码器问题**：检查模块安装和初始化
2. **如果是 WAV 解析问题**：检查 TTS 服务返回的数据
3. **如果是 TTS 服务问题**：检查 TTS 服务状态和日志
4. **如果是其他问题**：查看完整的错误堆栈信息

