# 三端之间强制使用 Opus 格式传输

## 文档目的

本文档记录三端之间强制使用 Opus 格式传输的架构变更。

---

## 一、架构变更

### 1.1 强制使用 Opus 格式

**变更前**：
- Pipeline 支持 Opus 解码，但解码失败时会回退到 Faster-Whisper-vad 服务解码
- 支持多种音频格式（Opus、PCM16 等）

**变更后**：
- **强制要求**：三端之间的传输只使用 Opus 格式
- **无回退机制**：Pipeline Opus 解码失败时直接抛出错误，不再回退
- **格式验证**：如果输入不是 Opus 格式，直接抛出错误

---

## 二、实施内容

### 2.1 PipelineOrchestrator（TypeScript）

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**变更**：

1. **强制格式验证**：
   ```typescript
   const audioFormat = job.audio_format || 'opus';
   
   if (audioFormat !== 'opus') {
     throw new Error(`Audio format must be 'opus', but received '${audioFormat}'. Three-end communication only uses Opus format.`);
   }
   ```

2. **移除回退逻辑**：
   ```typescript
   // 变更前：解码失败时回退到服务端解码
   catch (error) {
     logger.error('Failed to decode Opus audio, falling back to service decoding');
     // 保持原样，回退到服务端解码
   }
   
   // 变更后：解码失败时直接抛出错误
   catch (error) {
     logger.error('Failed to decode Opus audio. Opus decoding is required, no fallback available.');
     throw new Error(`Opus decoding failed: ${errorMessage}. Three-end communication only uses Opus format, decoding is required.`);
   }
   ```

3. **processASROnly 方法**：
   - 同样强制要求 Opus 格式
   - 解码失败时直接抛出错误

**代码位置**：
- 第 175-224 行：`processJob()` 中的 Opus 解码逻辑
- 第 749-789 行：`processASROnly()` 中的 Opus 解码逻辑

---

### 2.2 Faster-Whisper-vad 服务（Python）

**文件**：
- `electron_node/services/faster_whisper_vad/audio_decoder.py`
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**变更**：

1. **标记为废弃**：
   - 在模块文档和函数文档中添加废弃说明
   - 如果收到 Opus 格式，记录警告日志

2. **废弃警告**：
   ```python
   if audio_format == "opus":
       # 警告：Opus 解码应该由 Pipeline 完成，这里保留仅用于向后兼容
       logger.warning(
           f"[{trace_id}] ⚠️  DEPRECATED: Received Opus format audio. "
           f"Opus decoding should be handled by Pipeline. "
           f"This is a fallback and may be removed in the future."
       )
       audio, sr = decode_opus_audio(audio_bytes, sample_rate, trace_id)
   ```

**代码位置**：
- `audio_decoder.py` 第 1-7 行：模块文档说明
- `audio_decoder.py` 第 42-49 行：函数文档说明
- `audio_decoder.py` 第 65-68 行：废弃警告
- `faster_whisper_vad_service.py` 第 129 行：参数注释

---

## 三、数据流

### 3.1 正常流程

```
Web 客户端 (Opus) 
  → 调度服务器 (Opus)
    → Pipeline (Opus → PCM16)
      → Faster-Whisper-vad 服务 (PCM16)
        → ASR 识别
          → Pipeline (文本聚合)
            → NMT 翻译
              → TTS 生成 (WAV)
                → Pipeline (WAV → Opus)
                  → 调度服务器 (Opus)
                    → Web 客户端 (Opus)
```

### 3.2 错误处理

1. **输入格式不是 Opus**：
   - Pipeline 直接抛出错误
   - 不再尝试处理其他格式

2. **Opus 解码失败**：
   - Pipeline 直接抛出错误
   - 不再回退到 Faster-Whisper-vad 服务解码

3. **Opus 编码失败**：
   - Pipeline 直接抛出错误
   - TTS 必须使用 Opus 格式

---

## 四、优势

1. **架构简化**：
   - 移除回退逻辑，代码更简洁
   - 减少错误处理的复杂性

2. **一致性**：
   - 三端之间统一使用 Opus 格式
   - 减少格式转换的开销

3. **可维护性**：
   - 明确的错误处理路径
   - 更容易调试和定位问题

---

## 五、注意事项

1. **Pipeline Opus 解码必须稳定**：
   - 解码失败会导致整个任务失败
   - 需要确保 `opus-decoder` 库的稳定性

2. **错误处理**：
   - 所有 Opus 编解码错误都会直接抛出
   - 调用方需要正确处理这些错误

3. **向后兼容**：
   - Faster-Whisper-vad 服务中的 Opus 解码代码保留但已废弃
   - 如果收到 Opus 格式会记录警告，但仍能处理（向后兼容）

---

## 六、测试

### 6.1 单元测试

- ✅ PipelineOrchestrator 测试已更新，强制使用 Opus 格式
- ✅ 测试验证了格式验证和错误处理

### 6.2 集成测试

- ⚠️ 需要验证 Pipeline Opus 解码的稳定性
- ⚠️ 需要验证错误处理是否正确

---

**最后更新**：2025-12-29

