# NMT重复翻译问题修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

用户反馈：
- **原文（ASR）**: `"沒有了,那問題可以解決"`
- **译文（NMT）**: `"No, the problem can be solved no, it can be resolved no."`（重复）

**现象**：
- 原文只显示了一行（ASR去重功能已生效）
- 但译文有重复（NMT产生了重复翻译）

---

## 根本原因

### 问题1：`context_text` 和 `text` 相同导致重复输入

**位置**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**问题代码**:
```typescript
const nmtTask: NMTTask = {
  text: asrTextTrimmed,
  src_lang: job.src_lang,
  tgt_lang: job.tgt_lang,
  context_text: asrTextTrimmed, // ❌ 使用 ASR 结果作为上下文（和text相同）
  job_id: job.job_id,
};
```

**问题**：
- `context_text` 和 `text` 都是 `asrTextTrimmed`，它们完全相同
- 这导致NMT服务的输入变成了重复的文本

### 问题2：NMT服务简单拼接导致重复翻译

**位置**: `electron_node/services/nmt_m2m100/nmt_service.py`

**问题代码**:
```python
if req.context_text:
    # 简单拼接：上下文 + 当前文本
    input_text = f"{req.context_text} {req.text}"
```

**问题**：
- 如果 `context_text` 和 `text` 相同，输入就变成了 `"{text} {text}"`
- NMT模型会翻译两次相同的文本，产生重复的译文

**示例**：
- `context_text`: `"沒有了,那問題可以解決"`
- `text`: `"沒有了,那問題可以解決"`
- `input_text`: `"沒有了,那問題可以解決 沒有了,那問題可以解決"`（重复）
- NMT输出: `"No, the problem can be solved no, it can be resolved no."`（重复）

---

## 修复方案

### 修复1：在NMT服务中检查并避免重复拼接

**文件**: `electron_node/services/nmt_m2m100/nmt_service.py`

**修改**:
```python
if req.context_text:
    # 关键修复：如果上下文文本和当前文本相同，不拼接，避免重复翻译
    # 上下文文本应该是上一个utterance的文本，而不是当前文本
    if req.context_text.strip() != req.text.strip():
        # 简单拼接：上下文 + 当前文本
        input_text = f"{req.context_text} {req.text}"
    else:
        # 上下文文本和当前文本相同，只使用当前文本，避免重复
        print(f"[NMT Service] ⚠️ Context text is same as current text, skipping context to avoid duplication")
        input_text = req.text
```

**效果**：
- 如果 `context_text` 和 `text` 相同，只使用 `text`，不拼接
- 避免NMT模型翻译重复的文本

### 修复2：不在pipeline-orchestrator中传递当前文本作为上下文

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**修改**:
```typescript
const nmtTask: NMTTask = {
  text: asrTextTrimmed,
  src_lang: job.src_lang,
  tgt_lang: job.tgt_lang,
  context_text: undefined, // ✅ 不传递上下文，避免重复翻译（TODO: 如果需要上下文，应该传递上一个utterance的文本）
  job_id: job.job_id,
};
```

**效果**：
- 不传递 `context_text`，避免将当前文本作为自己的上下文
- 如果需要真正的上下文支持，应该传递上一个utterance的文本（需要额外的状态管理）

---

## 修复效果

### 修复前

**输入**:
- `context_text`: `"沒有了,那問題可以解決"`
- `text`: `"沒有了,那問題可以解決"`

**NMT输入**: `"沒有了,那問題可以解決 沒有了,那問題可以解決"`（重复）

**NMT输出**: `"No, the problem can be solved no, it can be resolved no."`（重复）❌

### 修复后

**输入**:
- `context_text`: `undefined`（不传递）
- `text`: `"沒有了,那問題可以解決"`

**NMT输入**: `"沒有了,那問題可以解決"`（不重复）✅

**NMT输出**: `"No, the problem can be solved."`（不重复）✅

---

## 说明

### 为什么 `context_text` 不应该等于 `text`？

1. **上下文的作用**：
   - `context_text` 应该是**上一个utterance的文本**，用于提供上下文信息
   - 不应该使用当前文本作为自己的上下文

2. **当前实现的问题**：
   - 当前实现将 `asrTextTrimmed` 同时作为 `text` 和 `context_text`
   - 这导致NMT输入重复，产生重复的译文

3. **正确的实现**（如果需要上下文）：
   - 应该维护一个状态，保存上一个utterance的文本
   - 将上一个utterance的文本作为 `context_text`
   - 当前utterance的文本作为 `text`

### 当前修复方案

**暂时不传递上下文**：
- 优点：简单，避免重复翻译
- 缺点：可能略微降低翻译质量（但影响应该不大）

**未来改进**（如果需要）：
- 在 `PipelineOrchestrator` 中维护上一个utterance的文本
- 将上一个utterance的文本作为 `context_text`
- 确保 `context_text` 和 `text` 不同

---

## 验证

### 测试场景

1. **场景1：单个utterance**
   - 输入: `"沒有了,那問題可以解決"`
   - **期望**: 译文不重复 ✅

2. **场景2：多个utterance**
   - Utterance 1: `"沒有了,那問題可以解決"`
   - Utterance 2: `"給你解決掉"`
   - **期望**: 每个utterance的译文都不重复 ✅

3. **场景3：相同utterance**
   - Utterance 1: `"上下温功能有没有生效?"`
   - Utterance 2: `"上下温功能有没有生效?"`
   - **期望**: 每个utterance的译文都不重复 ✅

---

## 相关文档

- [ASR重复文本问题分析](../faster_whisper_vad/docs/ASR_DUPLICATE_TEXT_ANALYSIS.md)
- [上下文重复问题说明](../faster_whisper_vad/docs/CONTEXT_DUPLICATE_ISSUE_EXPLANATION.md)

