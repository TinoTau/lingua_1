# 超时切割去重问题分析

## 问题描述

在语音识别稳定性测试中，发现以下问题：

1. **Job 5和6的ASR结果不完整**：
   - Job 5: "这一句我会尽量连续地说得长一些中间保持有自然的呼吸节奏不做刻意的停顿看看在超过10秒钟之后系统会不会因为超时或者判定而断掉从而到之前"
   - Job 6: "这出现语异让不完整獨起来前后不连贯的情况"
   - 这两个job应该是同一个长句，但被超时切割分成了两部分

2. **翻译结果重复**：
   - Job 5的翻译："This sentence I will try as long as possible on continuously saying some medium keeps natural breathing rhythm not do intentional stops and see if after more than 10 seconds the system won't break because of overtime or judgment so before."
   - Job 6的翻译："This phrase I will try to say as long as possible in the middle to keep a natural breathing rhythm not do intentional stops and see if after more than 10 seconds the system would not be broken because of overtime or judgment so before it occurred."
   - Job 6的翻译似乎包含了Job 5的内容，导致重复

## 问题根源分析

### 1. 超时切割机制

当音频超过10秒时，系统会在最长停顿处切割：
- 前半句（job 5）使用hangover机制，额外保留部分音频
- 后半句（job 6）保存在`pendingSecondHalf`中，等待下一个job合并

### 2. Hangover重叠

由于hangover机制，job 5和job 6的ASR结果有重叠部分：
- Job 5的ASR结果包含了hangover部分的音频识别
- Job 6的ASR结果从hangover结束位置开始
- 两个结果在hangover区域有重叠

### 3. 去重逻辑问题

当前的去重逻辑（`dedupMergePrecise`）应该能够处理这种hangover重叠，但可能存在以下问题：
- 去重阈值可能不够敏感，无法检测到hangover重叠
- 去重逻辑可能没有正确处理不完整句子的情况
- 去重可能发生在错误的阶段（应该在聚合阶段，而不是在语义修复之后）

### 4. 语义修复重复

语义修复可能对两个不完整的句子都进行了修复：
- Job 5的语义修复结果可能包含了hangover部分的内容
- Job 6的语义修复结果可能也包含了hangover部分的内容
- 由于上下文重叠，修复后的文本有重复

### 5. 翻译上下文错误

翻译时可能使用了错误的上下文：
- Job 6的翻译可能使用了Job 5的修复结果作为上下文
- 导致Job 6的翻译包含了Job 5的内容

## 修复方案

### 1. 增强去重逻辑

在`TextForwardMergeManager`中，当检测到`hasPendingSecondHalfMerged`标志时，应该：
- 更积极地检测hangover重叠
- 使用更宽松的去重阈值（因为hangover重叠可能较长）
- 确保去重发生在语义修复之前

### 2. 优化语义修复

对于不完整句子（被超时切割的句子），应该：
- 检测句子是否不完整（不以标点符号结尾）
- 对于不完整句子，语义修复应该更加保守
- 避免对hangover重叠部分进行重复修复

### 3. 修复翻译上下文

翻译时应该：
- 检查上下文文本是否与当前文本有重叠
- 如果上下文文本与当前文本重叠，应该清空上下文
- 确保翻译不会重复翻译hangover重叠部分

### 4. 改进超时切割策略

考虑：
- 增加hangover长度，提高ASR准确性
- 改进切割点选择算法，避免在不合适的位置切割
- 对于超长句子，考虑使用更智能的切割策略

## 实施步骤

1. 修复`TextForwardMergeManager`的去重逻辑，增强对hangover重叠的检测
2. 修复`SemanticRepairStageZH`，避免对不完整句子进行重复修复
3. 修复`TranslationStage`，确保翻译上下文正确
4. 添加日志，便于调试和监控
