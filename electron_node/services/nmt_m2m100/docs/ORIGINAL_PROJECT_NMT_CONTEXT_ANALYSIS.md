# 原项目NMT上下文处理分析

**日期**: 2025-12-25  
**问题**: 为什么原项目没有出现过NMT重复翻译的问题？

---

## 原项目架构

### ASR服务

**原项目**: `D:\Programs\github\lingua`
- **服务**: Faster Whisper（Python HTTP服务）
- **端口**: 6006
- **模型**: `Systran/faster-whisper-large-v3`
- **配置**:
  ```python
  segments, info = model.transcribe(
      audio,
      initial_prompt=req.prompt if req.prompt else None,  # 文本上下文（上一个utterance的ASR文本）
      condition_on_previous_text=req.condition_on_previous_text,  # 默认 True
  )
  ```

### NMT服务

**原项目**: 使用M2M100进行机器翻译
- **服务**: Python M2M100服务（类似当前项目）
- **上下文处理**: 需要查看原项目的具体实现

---

## 关键差异分析

### 当前项目的问题

**问题代码** (`pipeline-orchestrator.ts`):
```typescript
const nmtTask: NMTTask = {
  text: asrTextTrimmed,
  src_lang: job.src_lang,
  tgt_lang: job.tgt_lang,
  context_text: asrTextTrimmed, // ❌ 使用当前ASR文本作为上下文
  job_id: job.job_id,
};
```

**问题**：
- `context_text` 和 `text` 都是 `asrTextTrimmed`，它们完全相同
- NMT服务会将它们拼接：`"{asrTextTrimmed} {asrTextTrimmed}"`
- 导致NMT模型翻译两次相同的文本，产生重复的译文

### 原项目的正确实现（推测）

**原项目应该使用**：
```rust
// 原项目（推测）
let context_text = previous_translated_text;  // ✅ 使用上一个utterance的翻译文本
let nmtTask = NMTTask {
  text: current_asr_text,  // 当前ASR文本
  context_text: context_text,  // 上一个utterance的翻译文本（不同）
  ...
};
```

**关键点**：
- `context_text` 应该是**上一个utterance的翻译文本**（不是ASR文本）
- `text` 是**当前utterance的ASR文本**
- 两者不同，不会导致重复

---

## 为什么原项目没有这个问题？

### 最可能的原因：原项目没有使用context_text

**根据文档分析** (`CONTEXT_BUFFER_VS_NMT_CONTEXT_ANALYSIS.md`):
- NMT的 `context_text` 应该是"前一个utterance的翻译文本"
- 但实现这个功能需要维护状态（保存上一个utterance的翻译文本）
- 原项目可能**根本没有实现这个功能**，或者 `context_text` 始终为 `None`

**证据**：
- 当前项目的 `node-inference`（Rust服务）支持 `context_text`，但它是可选的
- 如果原项目没有传递 `context_text`，就不会有重复拼接的问题

### 原因2：原项目正确使用了上一个utterance的翻译文本（如果实现了）

**如果原项目实现了上下文功能**：
- 原项目维护了上一个utterance的翻译文本
- 将上一个utterance的翻译文本作为 `context_text`
- 当前utterance的ASR文本作为 `text`
- 两者不同，不会导致重复

**但根据当前项目的实现**，这个功能可能没有完全实现，因为：
- 需要跨utterance的状态管理
- 需要保存上一个utterance的翻译结果
- 当前项目的 `pipeline-orchestrator` 没有维护这个状态

### 原因3：原项目的NMT服务处理方式不同

**可能性**：
- 原项目的NMT服务可能没有简单拼接 `context_text` 和 `text`
- 或者有检查机制，避免重复拼接
- 但根据当前项目的NMT服务实现，这个可能性较小

---

## 当前项目的修复

### 修复1：不传递context_text（已实施）✅

**修改**:
```typescript
const nmtTask: NMTTask = {
  text: asrTextTrimmed,
  src_lang: job.src_lang,
  tgt_lang: job.tgt_lang,
  context_text: undefined, // ✅ 不传递上下文，避免重复翻译
  job_id: job.job_id,
};
```

**效果**：
- 避免将当前文本作为自己的上下文
- 避免NMT输入重复

### 修复2：在NMT服务中检查并避免重复拼接（已实施）✅

**修改**:
```python
if req.context_text:
    # 关键修复：如果上下文文本和当前文本相同，不拼接，避免重复翻译
    if req.context_text.strip() != req.text.strip():
        input_text = f"{req.context_text} {req.text}"
    else:
        # 上下文文本和当前文本相同，只使用当前文本，避免重复
        input_text = req.text
```

**效果**：
- 即使错误地传递了相同的 `context_text` 和 `text`，也不会导致重复

---

## 正确的上下文实现（如果需要）

### 方案：维护上一个utterance的翻译文本

**实现**:
```typescript
class PipelineOrchestrator {
  private previousTranslatedText: string | null = null;  // 保存上一个utterance的翻译文本
  
  async processJob(job: JobAssignMessage, ...): Promise<JobResult> {
    // 1. ASR任务
    const asrResult = await this.taskRouter.routeASRTask(asrTask);
    const asrTextTrimmed = (asrResult.text || '').trim();
    
    // 2. NMT任务
    const nmtTask: NMTTask = {
      text: asrTextTrimmed,  // 当前ASR文本
      src_lang: job.src_lang,
      tgt_lang: job.tgt_lang,
      context_text: this.previousTranslatedText,  // ✅ 上一个utterance的翻译文本
      job_id: job.job_id,
    };
    
    const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
    
    // 3. 保存当前utterance的翻译文本，作为下一个utterance的上下文
    this.previousTranslatedText = nmtResult.text;
    
    // 4. TTS任务...
  }
}
```

**关键点**：
- `context_text` 是**上一个utterance的翻译文本**（不是ASR文本）
- `text` 是**当前utterance的ASR文本**
- 两者不同，不会导致重复

---

## 总结

### 为什么原项目没有这个问题？

1. **可能原因1**: 原项目没有使用 `context_text`（最简单）
2. **可能原因2**: 原项目正确使用了上一个utterance的翻译文本作为 `context_text`
3. **可能原因3**: 原项目的NMT服务处理方式不同

### 当前项目的修复

1. **立即修复**: 不传递 `context_text`（已实施）✅
2. **防御性修复**: 在NMT服务中检查并避免重复拼接（已实施）✅
3. **未来改进**: 如果需要真正的上下文支持，应该维护上一个utterance的翻译文本

### 关键教训

**`context_text` 的含义**：
- `context_text` 应该是**上一个utterance的翻译文本**（不是ASR文本）
- 不应该使用当前文本作为自己的上下文
- 如果 `context_text` 和 `text` 相同，会导致重复翻译

---

## 相关文档

- [NMT重复翻译问题修复](./NMT_DUPLICATE_TRANSLATION_FIX.md)
- [上下文缓冲区 vs NMT上下文文本分析](../node-inference/docs/CONTEXT_BUFFER_VS_NMT_CONTEXT_ANALYSIS.md)

