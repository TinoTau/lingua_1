# 去重结果返回修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

虽然去重功能在 Step 9.2 中正确执行，但返回给Web端的文本仍然使用了去重前的原始文本。

**问题代码**:
```python
# Step 13: 返回结果
response = UtteranceResponse(
    text=full_text,  # ❌ 使用去重前的原始文本
    segments=segment_texts,  # ❌ segments也是基于原始文本生成的
    ...
)
```

**影响**:
- Web端收到的文本仍然是重复的
- 去重功能虽然执行了，但结果没有返回给Web端

---

## 修复内容

### 1. 修复返回文本使用去重后的结果

**文件**: `faster_whisper_vad_service.py`

**修改**:
```python
# Step 13: 返回结果
# 关键修复：返回去重后的文本，而不是原始文本
response = UtteranceResponse(
    text=full_text_trimmed,  # ✅ 使用去重后的文本
    segments=segment_texts,  # ✅ segments也在去重后重新生成
    ...
)
```

### 2. 修复 segments 使用去重后的文本

**修改**:
```python
# 在去重后（Step 9.2之后），重新生成 segment_texts
# 这样返回的 segments 也是去重后的
segment_texts = [s.strip() for s in full_text_trimmed.split() if s.strip()]
if not segment_texts:
    segment_texts = [full_text_trimmed] if full_text_trimmed else []
```

---

## 去重流程总结

### 完整的去重流程

1. **Step 9.1**: 文本trim处理
   ```python
   full_text_trimmed = full_text.strip()
   ```

2. **Step 9.2**: 去重处理
   ```python
   full_text_trimmed = deduplicate_text(full_text_trimmed, trace_id=trace_id)
   ```

3. **Step 9.3**: 重新生成 segments（使用去重后的文本）
   ```python
   segment_texts = [s.strip() for s in full_text_trimmed.split() if s.strip()]
   ```

4. **Step 11**: 更新文本上下文缓存（使用去重后的文本）
   ```python
   update_text_context(full_text_trimmed)  # ✅ 使用去重后的文本
   ```

5. **Step 13**: 返回结果（使用去重后的文本）
   ```python
   response = UtteranceResponse(
       text=full_text_trimmed,  # ✅ 使用去重后的文本
       segments=segment_texts,  # ✅ 使用去重后的segments
       ...
   )
   ```

---

## 验证

### 测试用例

1. **单个utterance内的重复**
   - 输入: `"上下温功能有没有生效? 上下温功能有没有生效?"`
   - 输出: `"上下温功能有没有生效?"` ✅

2. **开头和结尾的重复**
   - 输入: `"导致没有办法播 那些问题 导致没有办法播"`
   - 输出: `"导致没有办法播 那些问题"` ✅

3. **相邻重复**
   - 输入: `"我还会报错崩溃了 我还会报错崩溃了"`
   - 输出: `"我还会报错崩溃了"` ✅

### 日志验证

去重后的文本会在日志中显示：
```
Step 9.2: Deduplication applied, original_len=23, deduplicated_len=11
original_text="上下温功能有没有生效? 上下温功能有没有生效?"
deduplicated_text="上下温功能有没有生效?"
```

返回结果时也会记录：
```
Step 13: Response constructed successfully, returning deduplicated text (len=11)
```

---

## 架构原则

### 去重逻辑完全在服务端完成 ✅

- **不在Web端添加去重逻辑**
- 服务端负责所有去重处理
- Web端只负责显示服务端返回的结果

---

## 相关文档

- [文本去重功能增强](./DEDUPLICATION_ENHANCEMENT.md)
- [ASR重复文本问题分析](./ASR_DUPLICATE_TEXT_ANALYSIS.md)

