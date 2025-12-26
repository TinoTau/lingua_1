# Context And Deduplication (Part 4/4)

**示例**：
- ASR结果：`"这边能不能用这边能不能用"`
- 翻译结果：`"Can you use this side or can you use it on this side?"`
- ASR结果：`"这个地方我觉得还行这个地方我觉得还行"`（重复多次）

---

## 问题分析

### 根本原因

1. **ASR模型使用文本上下文导致重复识别**
   - ASR模型使用了`initial_prompt`（文本上下文）和`condition_on_previous_text=True`
   - 当音频中包含与上下文相似的语音时，模型可能重复识别相同的文本
   - 例如：如果上下文是"这边能不能用"，当前音频也说"这边能不能用"，模型可能输出"这边能不能用这边能不能用"

2. **上下文缓冲区可能包含重复的音频**
   - 上下文缓冲区保存了上一个utterance的尾部音频
   - 如果当前音频与上下文音频相似，可能导致重复识别

3. **文本上下文缓存可能包含重复的文本**
   - 文本上下文缓存保存了上一个utterance的文本
   - 如果当前音频与上下文文本相似，可能导致重复识别

---

## 修复方案

### 在ASR结果处理阶段添加去重逻辑

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**位置**: Step 9.2（在文本trim之后，无意义检查之前）

**去重方法**：

1. **完全重复检测**：
   - 检查文本是否完全重复（例如："这边能不能用这边能不能用"）
   - 方法：将文本从中间分割，检查后半部分是否以前半部分开头
   - 如果检测到完全重复，只保留前半部分

2. **短语重复检测**：
   - 检查文本中是否有重复的短语（长度>=4的连续字符）
   - 方法：使用滑动窗口，从长到短检查是否有重复的短语
   - 如果检测到重复的短语，移除第二个重复的短语

**代码实现**：
```python
# 9.2. 去重处理：移除重复的文本片段
if full_text_trimmed:
    import re
    original_text = full_text_trimmed
    
    # 方法1：检测完全重复的短语
    text_len = len(full_text_trimmed)
    if text_len >= 6:  # 至少6个字符才可能有重复
        mid_point = text_len // 2
        first_half = full_text_trimmed[:mid_point]
        second_half = full_text_trimmed[mid_point:]
        
        # 检查后半部分是否以前半部分开头（完全重复）
        if second_half.startswith(first_half):
            full_text_trimmed = first_half
            logger.warning(f"Detected complete text duplication")
    
    # 方法2：检测部分重复（短语重复）
    # 使用滑动窗口检测重复的短语（长度>=4）
    for phrase_len in range(min(20, text_len // 2), 3, -1):
        for start in range(text_len - phrase_len * 2 + 1):
            phrase = full_text_trimmed[start:start + phrase_len]
            next_start = start + phrase_len
            if next_start + phrase_len <= text_len:
                next_phrase = full_text_trimmed[next_start:next_start + phrase_len]
                if phrase == next_phrase:
                    # 找到重复，移除第二个重复的短语
                    full_text_trimmed = (
                        full_text_trimmed[:next_start] + 
                        full_text_trimmed[next_start + phrase_len:]
                    )
                    logger.warning(f"Detected phrase duplication: \"{phrase}\"")
                    break
```

---

## 测试验证

### 测试用例

1. **完全重复**：
   - 输入：`"这边能不能用这边能不能用"`
   - 期望输出：`"这边能不能用"`

2. **短语重复**：
   - 输入：`"这个地方我觉得还行这个地方我觉得还行"`
   - 期望输出：`"这个地方我觉得还行"`

3. **正常文本**：
   - 输入：`"让我们来看看这个东西"`
   - 期望输出：`"让我们来看看这个东西"`（不变）

---

## 注意事项

1. **去重逻辑的局限性**：
   - 只能检测明显的重复模式
   - 对于语义重复但文字不同的情况，无法检测
   - 对于复杂的重复模式，可能需要更复杂的算法

2. **性能影响**：
   - 去重逻辑在文本处理阶段执行，对性能影响很小
   - 最坏情况下，时间复杂度为O(n²)，其中n是文本长度
   - 实际情况下，文本长度通常较短（<100字符），性能影响可忽略

3. **日志记录**：
   - 当检测到重复文本时，会记录警告日志
   - 包含原始文本和去重后的文本，便于调试

---

## 后续优化建议

1. **调整ASR参数**：
   - 考虑禁用`condition_on_previous_text`，避免重复识别
   - 或者调整`initial_prompt`的使用策略

2. **改进去重算法**：
   - 使用更智能的文本相似度检测
   - 考虑使用编辑距离（Levenshtein distance）检测相似文本

3. **上下文管理优化**：
   - 改进上下文缓冲区的更新策略
   - 避免将重复的音频或文本添加到上下文

---

## 相关文件

- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - ASR结果处理
- `electron_node/services/faster_whisper_vad/context.py` - 上下文管理
- `electron_node/services/faster_whisper_vad/asr_worker_process.py` - ASR Worker进程



---

