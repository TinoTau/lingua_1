# 服务崩溃和空文本问题分析报告

**日期**: 2025-12-25  
**状态**: 🔍 **分析完成，需要修复**

---

## 问题总结

### 1. 服务崩溃 ⚠️

**现象**:
- 服务在处理 Opus 音频时崩溃
- 日志在某个时间点后停止（最后一条日志：07:19:35）

**可能原因**:
- Opus 解码器的 access violation 错误（虽然已添加锁保护）
- 主进程崩溃（不是 Worker 进程）

### 2. 空文本和 "The" 语音问题 ⚠️

**现象**:
- Web 端收到空文本
- TTS 生成了大量 "The" 的语音

**根本原因**:
- **ASR 服务正确过滤了空文本**（日志显示 "skipping NMT and TTS"）
- **但节点端的 `pipeline-orchestrator.ts` 没有检查 ASR 结果是否为空**
- 即使 ASR 返回空文本，节点端仍然调用 NMT 和 TTS
- NMT 可能将空文本翻译为 "The"（默认值或错误处理）
- TTS 将 "The" 转换为语音

---

## 代码分析

### ASR 服务端（正确）✅

**位置**: `faster_whisper_vad_service.py`

**逻辑**:
```python
# Step 10: 检查文本是否为空或无意义
if not full_text_trimmed:
    logger.warning("ASR transcript is empty, skipping NMT and TTS")
    return UtteranceResponse(text="", ...)  # 返回空文本

if is_meaningless:
    logger.warning("ASR transcript is meaningless, skipping NMT and TTS")
    return UtteranceResponse(text="", ...)  # 返回空文本
```

**结论**: ASR 服务正确过滤了空文本，返回空响应。

### 节点端（问题）❌

**位置**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**当前逻辑**:
```typescript
// 1. ASR 任务
const asrResult = await this.taskRouter.routeASRTask(asrTask);

// 2. NMT 任务（没有检查 asrResult.text 是否为空）
const nmtTask: NMTTask = {
  text: asrResult.text,  // 可能是空字符串
  ...
};
const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);

// 3. TTS 任务（没有检查 nmtResult.text 是否为空）
const ttsTask: TTSTask = {
  text: nmtResult.text,  // 可能是 "The" 或其他默认值
  ...
};
const ttsResult = await this.taskRouter.routeTTSTask(ttsTask);
```

**问题**:
- ❌ 没有检查 `asrResult.text` 是否为空
- ❌ 即使 ASR 返回空文本，仍然调用 NMT
- ❌ 即使 NMT 返回无意义文本（如 "The"），仍然调用 TTS

---

## 修复方案

### 在节点端添加空文本检查

**修改文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**修复内容**:

1. **在 NMT 之前检查 ASR 结果**
   ```typescript
   // 检查 ASR 结果是否为空或无意义
   if (!asrResult.text || asrResult.text.trim().length === 0) {
     logger.warn({ jobId: job.job_id }, 'ASR result is empty, skipping NMT and TTS');
     return {
       text_asr: '',
       text_translated: '',
       tts_audio: '',
       tts_format: 'pcm16',
     };
   }
   ```

2. **在 TTS 之前检查 NMT 结果**
   ```typescript
   // 检查 NMT 结果是否为空或无意义
   if (!nmtResult.text || nmtResult.text.trim().length === 0) {
     logger.warn({ jobId: job.job_id }, 'NMT result is empty, skipping TTS');
     return {
       text_asr: asrResult.text,
       text_translated: '',
       tts_audio: '',
       tts_format: 'pcm16',
     };
   }
   ```

3. **添加无意义文本检查**（可选）
   - 可以添加类似 ASR 服务的 `is_meaningless_transcript` 检查
   - 过滤 "The", "A", "An" 等无意义单词

---

## 崩溃问题分析

### Opus 解码器问题

**日志显示**:
- 278 个 access violation 错误
- 错误发生在 `opus_decode_float` 调用时
- 虽然已添加全局锁，但问题仍然存在

**可能原因**:
1. **锁范围不够**
   - 虽然保护了 `opus_decode_float`，但可能还有其他并发问题
   - 多个 pipeline 实例同时创建/销毁 decoder

2. **内存管理问题**
   - `decoder_state` 的内存可能被错误释放
   - 多个 decoder 实例之间的内存冲突

3. **底层库问题**
   - `pyogg` 的底层 C 库可能不是完全线程安全的
   - 即使串行化所有操作，也可能有内部状态冲突

### 建议的进一步修复

1. **限制并发 decoder 数量**
   - 使用对象池管理 decoder 实例
   - 限制同时存在的 decoder 数量

2. **更严格的错误处理**
   - 检测到 access violation 时，立即重建 decoder
   - 添加重试机制

3. **考虑替代方案**
   - 如果问题持续，考虑使用其他 Opus 解码库
   - 或者使用进程隔离（类似 ASR Worker）

---

## 实施优先级

### 高优先级（立即修复）

1. ✅ **节点端空文本检查** - 防止空文本进入 NMT/TTS
   - 修复文件：`pipeline-orchestrator.ts`
   - 影响：解决 "The" 语音问题

### 中优先级（尽快修复）

2. ⚠️ **Opus 解码器稳定性** - 减少崩溃
   - 可能需要更深入的修复
   - 或者考虑进程隔离

### 低优先级（后续优化）

3. 📝 **无意义文本过滤** - 在节点端也添加过滤
   - 与 ASR 服务保持一致

---

**分析完成时间**: 2025-12-25  
**状态**: ✅ **问题已定位，需要修复节点端代码**
