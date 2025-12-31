# Opus 编解码代码清理状态

## 文档目的

本文档记录 Opus 编解码功能从各服务中抽离后的代码残留情况。

---

## 一、已完成的抽离

### 1.1 TaskRouter（TypeScript）

**状态**：✅ **已完全移除**

**文件**：`electron_node/electron-node/main/src/task-router/task-router.ts`

**变更**：
- ✅ 移除了 `encodePcm16ToOpus()` 调用
- ✅ 移除了 `parseWavFile()` 和 `encodePcm16ToOpus()` 的导入（除了 `parseWavFile` 用于统计）
- ✅ TTS 任务现在返回 WAV 格式，由 Pipeline 负责编码为 Opus

**代码位置**：
- 第 19-20 行：只保留 `parseWavFile` 用于效率统计
- 第 1362-1395 行：注释说明 Opus 编码已移至 PipelineOrchestrator

---

### 1.2 PipelineOrchestrator（TypeScript）

**状态**：✅ **已实现**

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**功能**：
- ✅ Opus 解码：在 ASR 之前，如果输入是 Opus 格式，解码为 PCM16
- ✅ Opus 编码：在 TTS 之后，如果输出是 WAV 格式，编码为 Opus

**代码位置**：
- 第 178-224 行：Opus 解码逻辑（ASR 之前）
- 第 600-640 行：Opus 编码逻辑（TTS 之后）

---

### 1.3 Opus Codec 工具模块（TypeScript）

**状态**：✅ **已创建**

**文件**：`electron_node/electron-node/main/src/utils/opus-codec.ts`

**功能**：
- ✅ `decodeOpusToPcm16()`: 使用 `opus-decoder` 库解码
- ✅ `encodePcm16ToOpusBuffer()`: 使用 `@minceraftmc/opus-encoder` 库编码
- ✅ `convertWavToOpus()`: WAV 转 Opus

---

## 二、代码残留情况

### 2.1 Faster-Whisper-vad 服务（Python）

**状态**：⚠️ **已标记为废弃，保留仅用于向后兼容**

**文件**：
- `electron_node/services/faster_whisper_vad/audio_decoder.py`
- `electron_node/services/faster_whisper_vad/opus_packet_decoder.py`

**功能**：
- `decode_opus_audio()`: Opus 音频解码（已废弃）
- `decode_opus_packet_format()`: Opus packet 格式解码（已废弃）
- `decode_opus_continuous_stream()`: Opus 连续流解码（已废弃）

**当前状态**：
1. **已标记为废弃**：代码中添加了废弃警告，说明 Opus 解码应该由 Pipeline 完成
2. **保留原因**：仅用于向后兼容，如果 Pipeline 解码失败（不应该发生），仍能处理
3. **预期行为**：Pipeline 负责 Opus 解码，Faster-Whisper-vad 服务只接收 PCM16 格式

**代码位置**：
- `audio_decoder.py` 第 1-7 行：模块文档说明已废弃
- `audio_decoder.py` 第 38-49 行：函数文档说明已废弃
- `audio_decoder.py` 第 61-68 行：Opus 解码时记录废弃警告
- `faster_whisper_vad_service.py` 第 129 行：参数注释说明 Opus 已废弃

**建议**：
- ✅ 已添加废弃警告，如果收到 Opus 格式会记录警告日志
- ⚠️ 未来可以考虑完全移除 Opus 解码代码（需要确保 Pipeline 解码足够稳定）

---

### 2.2 TTS Stage（TypeScript）

**状态**：✅ **无残留（仅格式检查）**

**文件**：`electron_node/electron-node/main/src/agent/postprocess/tts-stage.ts`

**说明**：
- TTS Stage 只检查返回的音频格式是否为 `opus`
- 没有 Opus 编码逻辑（编码在 PipelineOrchestrator 中完成）
- 这是合理的，因为 TTS Stage 期望接收 Opus 格式的音频

**代码位置**：
- 第 37, 49, 60, 73, 112-126 行：格式检查和验证

---

## 三、总结

### 3.1 已完全抽离

- ✅ TaskRouter：Opus 编码已移除
- ✅ PipelineOrchestrator：Opus 编解码已实现
- ✅ Opus Codec 工具模块：已创建

### 3.2 已标记为废弃

- ⚠️ Faster-Whisper-vad 服务：Opus 解码代码已标记为废弃，保留仅用于向后兼容

### 3.3 当前架构

1. **强制使用 Opus**：
   - Pipeline 强制要求输入格式必须是 Opus
   - 如果输入不是 Opus 格式，直接抛出错误（不再回退）
   - Opus 解码失败时，直接抛出错误（不再回退）

2. **Faster-Whisper-vad 服务**：
   - 通常只接收 PCM16 格式（Pipeline 解码后的格式）
   - Opus 解码代码已标记为废弃，保留仅用于向后兼容
   - 如果收到 Opus 格式，会记录警告日志

3. **未来计划**：
   - 监控 Pipeline Opus 解码的成功率
   - 如果 Pipeline 解码足够稳定（> 99.9%），可以考虑完全移除 Faster-Whisper-vad 服务中的 Opus 解码代码

---

## 四、代码残留检查清单

- [x] TaskRouter 中的 Opus 编码代码已移除
- [x] PipelineOrchestrator 中的 Opus 编解码已实现
- [x] Opus Codec 工具模块已创建
- [x] TTS Stage 中无 Opus 编码残留（仅格式检查）
- [x] Faster-Whisper-vad 服务中的 Opus 解码代码已标记为废弃（保留仅用于向后兼容）
- [x] Pipeline 强制要求输入格式必须是 Opus（不再支持回退）
- [ ] 确认 Pipeline 解码稳定性后，完全移除 Faster-Whisper-vad 服务中的 Opus 解码代码（待完成）

---

---

## 五、强制使用 Opus 格式（最新变更）

### 5.1 变更内容

**日期**：2025-12-29

**变更**：移除回退方案，强制三端之间只使用 Opus 格式传输

**实施**：
1. ✅ PipelineOrchestrator 强制要求输入格式必须是 Opus
2. ✅ Opus 解码失败时直接抛出错误（不再回退）
3. ✅ Faster-Whisper-vad 服务中的 Opus 解码代码已标记为废弃
4. ✅ 所有测试已更新，强制使用 Opus 格式

**详细文档**：参见 `OPUS_ONLY_TRANSMISSION.md`

---

**最后更新**：2025-12-29

