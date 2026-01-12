# Opus 编码器修复验证指南

## 修复内容

**问题**：TTS 没有生成语音，因为 Opus 编码器初始化失败。

**原因**：
- `@minceraftmc/opus-encoder` 是 ES Module
- TypeScript 编译器（`module: "commonjs"`）将 `await import()` 转换成了 `require()`
- ES Module 不能使用 `require()` 导入，导致初始化失败

**修复**：
- 使用 `Function` 构造函数动态执行 `import()`，避免 TypeScript 编译器转换
- 修改文件：`electron_node/electron-node/main/src/utils/opus-encoder.ts`

## 验证步骤

### 1. 确认节点端已重新编译

```bash
cd electron_node/electron-node
npm run build:main
```

### 2. 启动节点端并连接调度服务器

确保：
- 节点端已启动
- 调度服务器正在运行（端口 5010）
- 节点端已成功连接到调度服务器

### 3. 进行实际测试

通过 Web 客户端或 API 发送语音输入，触发 TTS 任务。

### 4. 检查日志

#### 4.1 检查 Opus 编码器初始化

**搜索关键字**：
```
Opus encoder initialized
```

**期望看到**：
```json
{
  "level": 30,
  "msg": "Opus encoder initialized: sampleRate=16000, channels=1"
}
```

**如果看到错误**：
```json
{
  "level": 50,
  "error": "require() of ES Module ... not supported",
  "msg": "Failed to initialize Opus encoder"
}
```
说明修复未生效，需要重新编译。

#### 4.2 检查 TTS 任务执行

**搜索关键字**：
```
TTSStage: Starting TTS task
TTS audio encoded to Opus successfully
```

**期望看到**：
```json
{
  "level": 30,
  "msg": "TTSStage: Starting TTS task",
  "jobId": "job-xxx",
  "textLength": 10
}
```

```json
{
  "level": 30,
  "msg": "TTS audio encoded to Opus successfully",
  "originalSize": 66604,
  "opusSize": 12345,
  "compression": "5.39x"
}
```

#### 4.3 检查任务结果

**搜索关键字**：
```
Sending job_result
ttsAudioLength
```

**期望看到**：
```json
{
  "level": 30,
  "msg": "Sending job_result to scheduler",
  "jobId": "job-xxx",
  "ttsAudioLength": 12345  // 应该 > 0
}
```

**如果看到**：
```json
{
  "level": 30,
  "msg": "Sending job_result to scheduler",
  "ttsAudioLength": 0  // 为 0 说明没有音频
}
```
说明 TTS 音频生成失败。

#### 4.4 检查错误日志

**搜索关键字**：
```
Opus encoding failed
Opus encoder is not available
TTS task failed
```

**不应该看到**：
- `require() of ES Module ... not supported`
- `Opus encoder is not available (reason: not_initialized)`
- `TTS: Opus encoding failed`

## 验证脚本

### PowerShell 脚本

```powershell
# 检查 Opus 编码器初始化
Get-Content "logs\electron-main.log" | Select-String -Pattern "Opus encoder initialized" | Select-Object -Last 5

# 检查 TTS 任务执行
Get-Content "logs\electron-main.log" | Select-String -Pattern "TTSStage.*Starting|TTS audio encoded to Opus" | Select-Object -Last 10

# 检查任务结果中的音频长度
Get-Content "logs\electron-main.log" | Select-String -Pattern "ttsAudioLength" | Select-Object -Last 10

# 检查错误
Get-Content "logs\electron-main.log" | Select-String -Pattern "Opus.*fail|Opus.*error|require.*ES Module" | Select-Object -Last 10
```

### Bash 脚本

```bash
# 检查 Opus 编码器初始化
grep "Opus encoder initialized" logs/electron-main.log | tail -5

# 检查 TTS 任务执行
grep -E "TTSStage.*Starting|TTS audio encoded to Opus" logs/electron-main.log | tail -10

# 检查任务结果中的音频长度
grep "ttsAudioLength" logs/electron-main.log | tail -10

# 检查错误
grep -E "Opus.*fail|Opus.*error|require.*ES Module" logs/electron-main.log | tail -10
```

## 成功标准

✅ **修复成功的标志**：
1. 日志中出现 `Opus encoder initialized: sampleRate=16000, channels=1`
2. 日志中出现 `TTS audio encoded to Opus successfully`
3. `job_result` 中的 `ttsAudioLength > 0`
4. 没有 `require() of ES Module` 错误
5. 没有 `Opus encoder is not available` 错误

❌ **修复失败的标志**：
1. 日志中出现 `require() of ES Module ... not supported`
2. 日志中出现 `Opus encoder is not available (reason: not_initialized)`
3. 所有 TTS 任务的 `ttsAudioLength = 0`
4. 日志中出现 `TTS: Opus encoding failed`

## 常见问题

### Q1: 没有看到 "Opus encoder initialized" 日志

**可能原因**：
- 还没有触发 TTS 任务（Opus 编码器是延迟初始化的）
- 需要实际发送语音输入，触发 TTS 任务

**解决方法**：
- 通过 Web 客户端或 API 发送语音输入
- 等待 TTS 任务执行

### Q2: 仍然看到 "require() of ES Module" 错误

**可能原因**：
- 代码没有重新编译
- 编译后的代码没有更新

**解决方法**：
```bash
cd electron_node/electron-node
npm run build:main
# 然后重启节点端
```

### Q3: 看到 "Opus encoder initialized" 但 `ttsAudioLength = 0`

**可能原因**：
- TTS 服务调用失败
- WAV 文件解析失败
- 其他 TTS 相关错误

**解决方法**：
- 检查 TTS 服务是否正常运行
- 查看完整的错误日志
- 检查 `TTSStage: TTS task failed` 日志

## 相关文件

- `electron_node/electron-node/main/src/utils/opus-encoder.ts` - Opus 编码器实现
- `electron_node/electron-node/main/src/agent/postprocess/tts-stage.ts` - TTS 阶段处理
- `electron_node/electron-node/main/src/task-router/task-router.ts` - TTS 任务路由

