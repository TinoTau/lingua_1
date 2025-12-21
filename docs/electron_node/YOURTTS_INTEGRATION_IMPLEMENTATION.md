# YourTTS 集成实现总结

## 实现概述

已成功实现 YourTTS 服务集成到节点推理任务链中，支持根据 `features.voice_cloning` 动态选择使用 YourTTS 或 Piper TTS。

## 实现内容

### 1. 创建 YourTTS HTTP 客户端模块

**文件**: `electron_node/services/node-inference/src/yourtts.rs`

**功能**:
- ✅ 实现 `YourTTSEngine` 结构体，封装 YourTTS HTTP 服务调用
- ✅ 支持通过 HTTP POST 请求调用 YourTTS 服务（端口 5004）
- ✅ 自动处理音频格式转换（f32 → PCM16）
- ✅ 支持音频重采样（从 22050Hz 到 16000Hz）
- ✅ 错误处理和日志记录

**关键方法**:
- `YourTTSEngine::new()` - 创建引擎实例
- `YourTTSEngine::synthesize()` - 语音合成（支持 speaker_id 音色克隆）

### 2. 实现 VoiceCloner 调用 YourTTS

**文件**: `electron_node/services/node-inference/src/speaker.rs`

**修改内容**:
- ✅ 在 `VoiceCloner` 结构体中添加 `yourtts_engine` 字段
- ✅ 实现 `VoiceCloner::initialize()` 方法，初始化 YourTTS 引擎
- ✅ 实现 `VoiceCloner::clone_voice()` 方法，调用 YourTTS 服务
- ✅ 在 `enable()` 方法中自动初始化 YourTTS 引擎

**关键方法**:
```rust
pub async fn clone_voice(
    &self,
    text: &str,
    speaker_id: &str,
    lang: Option<&str>,
) -> Result<Vec<u8>>
```

### 3. 修改推理流程支持动态 TTS 选择

**文件**: `electron_node/services/node-inference/src/inference.rs`

**修改内容**:
- ✅ 在 `InferenceService::new()` 中初始化 `VoiceCloner` 实例
- ✅ 修改 TTS 合成逻辑，根据 `features.voice_cloning` 选择服务：
  - 如果启用 `voice_cloning` 且有 `speaker_id` → 使用 YourTTS
  - 否则 → 使用 Piper TTS
- ✅ 实现优雅降级：YourTTS 失败时自动降级到 Piper TTS

**关键逻辑**:
```rust
// 5. TTS: 语音合成
let use_voice_cloning = features.map(|f| f.voice_cloning).unwrap_or(false);
let mut audio = if use_voice_cloning {
    // 尝试使用 YourTTS
    if let Some(ref speaker_id) = ctx.speaker_id {
        // ... 调用 VoiceCloner::clone_voice()
    } else {
        // 降级到 Piper TTS
        self.tts_engine.synthesize(&translation, &tgt_lang).await?
    }
} else {
    // 标准流程，使用 Piper TTS
    self.tts_engine.synthesize(&translation, &tgt_lang).await?
};
```

### 4. 模块注册

**文件**: `electron_node/services/node-inference/src/lib.rs`

**修改内容**:
- ✅ 添加 `pub mod yourtts;` 模块声明
- ✅ 导出 `YourTTSEngine` 和 `YourTTSHttpConfig` 类型

## 任务链流程

### 标准任务链（无音色克隆）

```
调度服务器 → Node Agent → Inference Service
    ↓
1. ASR (Whisper, 本地)
    ↓
2. NMT (HTTP 5008)
    ↓
3. TTS (HTTP 5006, Piper TTS)
    ↓
返回音频文件
```

### 音色克隆任务链（启用 voice_cloning）

```
调度服务器 → Node Agent → Inference Service
    ↓
1. ASR (Whisper, 本地)
    ↓
2. NMT (HTTP 5008)
    ↓
3. 音色识别（可选，如果启用 speaker_identification）
    ↓
4. TTS 选择：
   - 如果 features.voice_cloning == true && speaker_id 存在
     → YourTTS (HTTP 5004)
   - 否则
     → Piper TTS (HTTP 5006)
    ↓
返回音频文件
```

## 使用方式

### 1. 启动 YourTTS 服务

YourTTS 服务可以通过 PythonServiceManager 启动：

```typescript
await pythonServiceManager.startService('yourtts');
```

### 2. 在任务请求中启用音色克隆

```json
{
  "job_id": "job-123",
  "src_lang": "zh",
  "tgt_lang": "en",
  "audio": "<base64_audio>",
  "features": {
    "voice_cloning": true,
    "speaker_identification": true  // 可选，用于识别说话人
  }
}
```

### 3. 服务自动选择

- 如果 `features.voice_cloning == true` 且有 `speaker_id`，系统会自动使用 YourTTS
- 如果 YourTTS 服务不可用或失败，会自动降级到 Piper TTS
- 如果没有 `speaker_id`，会使用 Piper TTS

## 错误处理

### 优雅降级机制

1. **YourTTS 服务不可用**: 自动降级到 Piper TTS，记录警告日志
2. **VoiceCloner 未初始化**: 使用 Piper TTS，记录警告日志
3. **没有 speaker_id**: 使用 Piper TTS，记录警告日志
4. **YourTTS 调用失败**: 捕获错误，降级到 Piper TTS

### 日志记录

所有关键操作都有详细的日志记录：
- `info!` - 正常操作（服务选择、合成完成等）
- `warn!` - 降级操作（YourTTS 不可用，使用 Piper TTS）
- `error!` - 错误情况（服务调用失败等）

## 配置

### YourTTS 服务配置

可以通过环境变量配置：

- `YOURTTS_SERVICE_URL` - YourTTS 服务端点（默认: `http://127.0.0.1:5004/synthesize`）
- `YOURTTS_TIMEOUT_MS` - 请求超时时间（默认: 30000ms）

### 服务端口

- **YourTTS 服务**: 端口 5004
- **Piper TTS 服务**: 端口 5006
- **NMT 服务**: 端口 5008

## 测试建议

### 1. 测试标准流程（Piper TTS）

```bash
# 确保 Piper TTS 服务运行
# 发送任务请求，不启用 voice_cloning
# 验证使用 Piper TTS
```

### 2. 测试音色克隆流程（YourTTS）

```bash
# 确保 YourTTS 服务运行
# 发送任务请求，启用 voice_cloning 和 speaker_identification
# 验证使用 YourTTS
```

### 3. 测试降级机制

```bash
# 停止 YourTTS 服务
# 发送任务请求，启用 voice_cloning
# 验证自动降级到 Piper TTS
```

## 注意事项

1. **服务依赖**: YourTTS 服务必须在端口 5004 运行才能使用音色克隆功能
2. **speaker_id**: 使用 YourTTS 时需要提供 `speaker_id`，这通常需要先启用 `speaker_identification` 模块
3. **性能**: YourTTS 的处理时间通常比 Piper TTS 长，超时时间设置为 30 秒
4. **音频格式**: YourTTS 返回 22050Hz 的音频，会自动重采样到 16000Hz

## 后续优化建议

1. **服务健康检查**: 在任务处理前检查 YourTTS 服务是否可用
2. **缓存优化**: 优化 speaker_id 到音色特征的缓存机制
3. **重采样优化**: 使用专业的重采样库（如 rubato）替代简单的线性重采样
4. **错误重试**: 实现 YourTTS 调用失败时的重试机制

---

**实现完成时间**: 2024-12-19  
**实现状态**: ✅ 已完成

