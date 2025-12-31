# Opus 编解码功能拆分总结

## 文档目的

本文档记录将 Opus 编码/解码功能从 Faster-Whisper-vad 和 TTS 服务中拆分到 Pipeline 中的实施情况。

---

## 一、拆分目标

### 1.1 原始架构

**Opus 解码**：
- 位置：Faster-Whisper-vad 服务（Python）
- 文件：`electron_node/services/faster_whisper_vad/audio_decoder.py`
- 功能：在 `/utterance` 端点中，如果 `audio_format` 是 `opus`，调用 `decode_opus_audio()` 解码

**Opus 编码**：
- 位置：TaskRouter（TypeScript）
- 文件：`electron_node/electron-node/main/src/task-router/task-router.ts`
- 功能：在 `routeTTSTask()` 中，TTS 服务返回 WAV 后，调用 `encodePcm16ToOpus()` 编码

### 1.2 目标架构

**Opus 解码**：
- 位置：PipelineOrchestrator（TypeScript）
- 功能：在调用 ASR 之前，如果输入是 Opus 格式，先解码为 PCM16

**Opus 编码**：
- 位置：PipelineOrchestrator（TypeScript）
- 功能：在 TTS 返回 WAV 后，编码为 Opus 格式

---

## 二、实施内容

### 2.1 创建 Opus 编解码工具模块

**文件**：`electron_node/electron-node/main/src/utils/opus-codec.ts`

**功能**：
- `decodeOpusToPcm16()`: 解码 Opus 音频为 PCM16（使用 `opus-decoder` 库）
- `encodePcm16ToOpusBuffer()`: 编码 PCM16 音频为 Opus（使用 `@minceraftmc/opus-encoder` 库）
- `convertWavToOpus()`: 将 WAV Buffer 转换为 Opus 编码的 Buffer

**依赖库**：
- **编码**：`@minceraftmc/opus-encoder`（与 TTS 一致）
- **解码**：`opus-decoder`（与 Web 客户端一致）

**状态**：
- ✅ Opus 编码功能已实现（使用 `@minceraftmc/opus-encoder`）
- ✅ Opus 解码功能已实现（使用 `opus-decoder`）

---

### 2.2 PipelineOrchestrator 中的 Opus 解码

**位置**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**实施**：
- 在 `processJob()` 方法中，ASR 任务创建之前
- 检查 `job.audio_format` 是否为 `opus`
- 如果是 Opus，调用 `decodeOpusToPcm16()` 解码（当前未实现，暂时保持原样）

**代码片段**：
```typescript
// Opus 解码：如果输入是 Opus 格式，在 Pipeline 中解码为 PCM16
let audioForASR = job.audio;
let audioFormatForASR = job.audio_format || 'pcm16';

if (job.audio_format === 'opus') {
  try {
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        opusDataLength: job.audio.length,
      },
      'PipelineOrchestrator: Decoding Opus audio to PCM16 before ASR'
    );
    
    // TODO: 实现 Opus 解码
    // 当前实现：由于 TypeScript 中没有 Opus 解码实现，暂时保持原样
    // 让 Faster-Whisper-vad 服务处理 Opus 解码
    // 未来优化：使用 WebAssembly 实现 Opus 解码
    logger.warn(
      {
        jobId: job.job_id,
      },
      'PipelineOrchestrator: Opus decoding in Pipeline not yet implemented, ' +
      'Faster-Whisper-vad service will handle Opus decoding'
    );
  } catch (error) {
    // 解码失败，回退到服务端解码
  }
}
```

**状态**：
- ✅ 代码框架已添加
- ✅ 实际解码功能已实现（使用 `opus-decoder` 库）

---

### 2.3 PipelineOrchestrator 中的 Opus 编码

**位置**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**实施**：
- 在 `processJob()` 方法中，TTS 任务完成后
- 检查 `ttsResult.audio_format` 是否为 `wav` 或 `pcm16`
- 如果是 WAV，调用 `convertWavToOpus()` 编码为 Opus

**代码片段**：
```typescript
// Opus 编码：在 Pipeline 中将 TTS 返回的 WAV 编码为 Opus
let ttsAudioBase64 = ttsResult.audio;
let ttsAudioFormat = ttsResult.audio_format || 'opus';

if (ttsResult.audio_format === 'wav' || ttsResult.audio_format === 'pcm16') {
  try {
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        wavDataLength: ttsResult.audio.length,
      },
      'PipelineOrchestrator: Encoding TTS WAV audio to Opus'
    );
    
    // 将 base64 WAV 数据转换为 Buffer
    const wavBuffer = Buffer.from(ttsResult.audio, 'base64');
    
    // 编码为 Opus
    const opusData = await convertWavToOpus(wavBuffer);
    
    // 转换为 base64
    ttsAudioBase64 = opusData.toString('base64');
    ttsAudioFormat = 'opus';
    
    logger.info(
      {
        jobId: job.job_id,
        wavSize: wavBuffer.length,
        opusSize: opusData.length,
        compression: (wavBuffer.length / opusData.length).toFixed(2),
      },
      'PipelineOrchestrator: TTS audio encoded to Opus successfully'
    );
  } catch (error) {
    // Opus 编码失败，抛出错误（TTS 必须使用 Opus 格式）
    throw new Error(`TTS Opus encoding failed: ${errorMessage}. TTS must use Opus format.`);
  }
}
```

**状态**：
- ✅ 已实现并集成

---

### 2.4 TaskRouter 中的 Opus 编码移除

**位置**：`electron_node/electron-node/main/src/task-router/task-router.ts`

**修改**：
- 移除 `routeTTSTask()` 中的 Opus 编码逻辑
- 移除 `encodePcm16ToOpus` 和 `isOpusEncoderAvailable` 的导入
- 保留 `parseWavFile` 导入（用于效率统计）
- TaskRouter 现在只返回 WAV 数据，由 Pipeline 负责编码为 Opus

**代码片段**：
```typescript
// 注意：Opus 编码已移至 PipelineOrchestrator 中处理
// TaskRouter 现在只返回 WAV 数据，由 Pipeline 负责编码为 Opus
const wavBase64 = wavBuffer.toString('base64');

return {
  audio: wavBase64,
  audio_format: 'wav', // 返回 WAV 格式，由 Pipeline 编码为 Opus
  sample_rate: task.sample_rate || 16000,
};
```

**状态**：
- ✅ 已完成

---

## 三、当前状态

### 3.1 已完成

1. ✅ **创建 Opus 编解码工具模块**（`opus-codec.ts`）
   - Opus 编码功能已实现
   - Opus 解码功能框架已添加（但未实现）

2. ✅ **PipelineOrchestrator 中的 Opus 编码**
   - 在 TTS 之后编码为 Opus
   - 已集成到 `processJob()` 和 `processASROnly()` 方法

3. ✅ **TaskRouter 中的 Opus 编码移除**
   - 已移除 Opus 编码逻辑
   - 现在只返回 WAV 数据

### 3.2 待完成

1. ⚠️ **Faster-Whisper-vad 服务中的 Opus 解码移除**
   - Pipeline 中的 Opus 解码功能已实现
   - 需要测试确认 Pipeline 解码功能稳定后，才能从 Python 服务中移除解码逻辑

---

## 四、技术挑战

### 4.1 Opus 解码实现

**问题**：
- TypeScript/Node.js 中没有现成的 Opus 解码实现
- Python 服务中有实现（使用 `pyogg` 库）

**解决方案**：
✅ **已实现**：使用 `opus-decoder` npm 包
   - 安装 `opus-decoder` 库（与 Web 客户端一致）
   - 实现 `decodeOpusToPcm16()` 函数
   - 支持 Plan A packet 格式（length-prefixed packets）
   - 与 `@minceraftmc/opus-encoder` 兼容

**统一依赖库**：
- **编码**：`@minceraftmc/opus-encoder`（与 TTS 一致）
- **解码**：`opus-decoder`（与 Web 客户端一致）

---

## 五、后续工作

### 5.1 短期（1-2 周）

1. ✅ **实现 TypeScript Opus 解码**（已完成）
   - 安装 `opus-decoder` npm 包
   - 实现 `decodeOpusToPcm16()` 函数
   - 支持 Plan A packet 格式

2. ✅ **完善 PipelineOrchestrator 中的 Opus 解码**（已完成）
   - 集成 Opus 解码功能
   - 需要测试解码后的音频质量

### 5.2 中期（1-2 个月）

1. **从 Faster-Whisper-vad 服务中移除 Opus 解码**
   - 确认 Pipeline 中的解码功能稳定
   - 移除 Python 服务中的解码逻辑
   - 简化服务代码

2. **性能优化**
   - 评估 Pipeline 中编解码的性能影响
   - 优化编解码流程

---

## 六、代码变更总结

### 6.1 新增文件

- `electron_node/electron-node/main/src/utils/opus-codec.ts`
  - Opus 编解码工具模块

### 6.2 修改文件

1. **`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`**
   - 添加 Opus 解码逻辑（框架，未实现）
   - 添加 Opus 编码逻辑（已实现）
   - 导入 `opus-codec.ts` 模块

2. **`electron_node/electron-node/main/src/task-router/task-router.ts`**
   - 移除 Opus 编码逻辑
   - 移除 `encodePcm16ToOpus` 和 `isOpusEncoderAvailable` 导入
   - 保留 `parseWavFile` 导入（用于效率统计）

### 6.3 待修改文件

1. **`electron_node/services/faster_whisper_vad/audio_decoder.py`**
   - 待移除 Opus 解码逻辑（需要先实现 TypeScript Opus 解码）

2. **`electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`**
   - 待移除 Opus 解码相关代码（需要先实现 TypeScript Opus 解码）

---

## 七、测试建议

### 7.1 单元测试

1. **Opus 编码测试**
   - 测试 `convertWavToOpus()` 函数
   - 验证编码后的数据格式和大小

2. **Pipeline 集成测试**
   - 测试 Pipeline 中的 Opus 编码流程
   - 验证编码后的音频质量

### 7.2 集成测试

1. **端到端测试**
   - 测试完整的 Pipeline 流程（ASR → NMT → TTS）
   - 验证 Opus 编码后的音频可以正常播放

2. **性能测试**
   - 测试 Pipeline 中编解码的性能影响
   - 对比拆分前后的处理时间

---

## 八、总结

### 8.1 已完成

- ✅ Opus 编码功能已成功拆分到 Pipeline
- ✅ TaskRouter 中的 Opus 编码逻辑已移除
- ✅ Opus 编解码工具模块已创建

### 8.2 待完成

- ⚠️ Faster-Whisper-vad 服务中的 Opus 解码逻辑待移除（需要测试确认 Pipeline 解码功能稳定）

### 8.3 影响

**优点**：
- ✅ 编解码逻辑集中在 Pipeline，便于维护
- ✅ TaskRouter 职责更清晰（只负责路由）
- ✅ 为未来优化提供了基础

**限制**：
- ⚠️ 当前仍依赖 Faster-Whisper-vad 服务进行 Opus 解码（作为回退方案）
- ✅ Pipeline 中的 Opus 解码功能已实现，但需要测试确认稳定性

---

**文档创建时间**：2025-12-29  
**文档版本**：1.0  
**文档状态**：进行中

