# Embedding 与 YourTTS 的关系说明

## 当前实现情况

### 1. Embedding 步骤提取了什么

**位置**：`embedding-step.ts`

```typescript
// 调用 speaker-embedding 服务提取 embedding
const response = await axios.post(`${endpoint.baseUrl}/extract`, {
  audio: audioF32,  // PCM16 → f32
});

// 存储到 JobContext
(ctx as any).voiceEmbedding = embeddingBase64;  // base64 编码的 embedding
(ctx as any).speakerId = job.job_id;
```

**提取结果**：
- `voiceEmbedding`：192 维特征向量（base64 编码）
- `speakerId`：使用 `job_id`

---

### 2. YourTTS 步骤如何使用音色

**位置**：`yourtts-step.ts`

```typescript
// 从 JobContext 获取 PCM16 音频
const audioF32 = convertPcm16ToF32(ctx.audio);

// 调用 YourTTS 服务
const response = await axios.post(`${endpoint.baseUrl}/synthesize`, {
  text: textToTts,
  language: job.tgt_lang || 'zh',
  reference_audio: audioF32,  // 直接传递原始音频（f32 格式）
  reference_sample_rate: job.sample_rate || 16000,
});
```

**注意**：
- ✅ 传递了 `reference_audio`（原始音频的 f32 格式）
- ❌ **没有传递 `voice_embedding`**（虽然提取了，但没有使用）

---

### 3. YourTTS 服务的实际处理

**位置**：`yourtts_service.py` 第 377-382 行

```python
# 合成语音
if speaker_wav:  # speaker_wav 是从 reference_audio 生成的临时文件
    wav = tts_model.tts(
        text=text,
        speaker_wav=speaker_wav,  # 使用参考音频文件
        language=language
    )
```

**YourTTS 模型的工作方式**：
- YourTTS 模型接受 `speaker_wav`（参考音频文件）
- **YourTTS 模型内部会从 `speaker_wav` 中提取 embedding**，用于音色克隆
- YourTTS 模型**不支持直接使用 `voice_embedding` 参数**

---

## 问题分析

### 当前情况

1. **Embedding 步骤提取了 embedding**，存储到 `ctx.voiceEmbedding`
2. **YourTTS 步骤没有使用 embedding**，只传递了 `reference_audio`
3. **YourTTS 服务接受 `voice_embedding` 参数**，但在 `/synthesize` 端点中：
   - 只在 `/register_speaker` 时保存 `voice_embedding` 到缓存
   - 在 `/synthesize` 时**不使用 `voice_embedding`**，只使用 `reference_audio`

### 结论

**Embedding 步骤提取的 embedding 当前没有被 YourTTS 使用**。

YourTTS 的工作流程：
1. 接收 `reference_audio`（f32 数组）
2. 将 `reference_audio` 转换为临时 WAV 文件（`speaker_wav`）
3. **YourTTS 模型内部从 `speaker_wav` 中提取 embedding**
4. 使用提取的 embedding 进行音色克隆

---

## 两种方案对比

### 方案1：当前实现（传递 reference_audio）

**流程**：
```
ASR → Embedding（提取，但不使用）→ YourTTS（传递 reference_audio）
```

**优点**：
- ✅ YourTTS 模型原生支持
- ✅ 简单直接

**缺点**：
- ❌ Embedding 步骤提取的 embedding 没有被使用（浪费计算）
- ❌ YourTTS 需要重新从 reference_audio 中提取 embedding（重复计算）

### 方案2：传递 voice_embedding（如果支持）

**流程**：
```
ASR → Embedding（提取）→ YourTTS（传递 voice_embedding）
```

**优点**：
- ✅ 避免重复计算（YourTTS 不需要重新提取 embedding）
- ✅ 更高效

**缺点**：
- ❌ YourTTS 模型可能不支持直接使用 embedding（需要检查）

---

## 建议

### 选项1：移除 Embedding 步骤（如果不需要）

如果 YourTTS 不支持直接使用 embedding，可以考虑：
- 移除 Embedding 步骤
- 直接传递 `reference_audio` 给 YourTTS

**流程**：
```
ASR → YourTTS（传递 reference_audio）
```

### 选项2：保留 Embedding 步骤（如果未来需要）

如果未来需要：
- 使用 embedding 进行说话人识别
- 缓存 embedding 用于后续任务
- YourTTS 支持直接使用 embedding

可以保留 Embedding 步骤，但目前不传递给 YourTTS。

### 选项3：检查 YourTTS 是否支持直接使用 embedding

检查 YourTTS 模型的 API，看是否支持：
```python
wav = tts_model.tts(
    text=text,
    speaker_embedding=voice_embedding,  # 直接使用 embedding
    language=language
)
```

如果支持，可以修改 YourTTS 步骤，传递 `voice_embedding` 而不是 `reference_audio`。

---

## 当前实现总结

1. **Embedding 步骤**：提取了 embedding，存储到 `ctx.voiceEmbedding`，但**没有被使用**
2. **YourTTS 步骤**：传递 `reference_audio`，YourTTS 模型内部从 `reference_audio` 中提取 embedding
3. **结果**：Embedding 步骤提取的 embedding 是多余的，YourTTS 会重新提取

**建议**：如果不需要 embedding 用于其他目的（如说话人识别），可以考虑移除 Embedding 步骤，直接传递 `reference_audio` 给 YourTTS。
