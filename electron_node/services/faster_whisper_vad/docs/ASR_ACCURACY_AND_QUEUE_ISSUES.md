# ASR识别准确度和结果队列问题诊断报告

**日期**: 2025-12-25  
**问题**: 
1. ASR识别准确度非常差，出现乱码
2. 有重复内容
3. 结果无法传回Web端

---

## 问题总结

### 1. ASR识别准确度问题

**日志显示乱码**:
```
transcript_preview='濂?璇煶寮€濮嬭繑鍥炰簡鎴戜滑'
text_len=11
```

**可能的原因**:
1. **编码问题**: Faster Whisper返回的文本在传递过程中编码损坏
2. **音频质量问题**: 虽然音频质量检查通过，但质量仍然不足以让Faster Whisper准确识别
3. **模型配置问题**: `large-v3`模型可能没有正确加载或配置
4. **日志输出问题**: 日志系统本身的问题，实际文本可能是正确的

**需要检查**:
- ASR worker返回的原始文本是什么
- 文本在pickle序列化/反序列化过程中是否损坏
- 日志文件的编码设置

### 2. 重复内容问题

**去重功能在工作**:
```
Step 9.2: Deduplication applied, original_len=5, deduplicated_len=3
original_text="璇曡瘯璇曡瘯璇?"
deduplicated_text="璇曡瘯璇?"
```

**但是**:
- 去重后的文本仍然是乱码
- 用户报告仍然看到重复内容（可能是多个utterance的重复，而不是单个utterance内的重复）

**可能的原因**:
1. 去重逻辑只处理单个utterance内的重复，不处理多个utterance之间的重复
2. 调度服务器的结果队列可能发送了重复的结果

### 3. 结果无法传回Web端

**调度服务器日志**:
```
Received JobResult, adding to result queue
翻译结果详情 - 原文(ASR): "我继续说的话", 译文(NMT): "What I continue to say."
Getting ready results from queue, ready_results_count=0
```

**问题**:
- 调度服务器收到了结果（`text_asr="我继续说的话"`, `text_translated="What I continue to say."`）
- 但是 `get_ready_results` 返回了空列表（`ready_results_count=0`）
- 因此没有发送到web端

**根本原因**:
- 结果队列要求按顺序返回结果（`utterance_index` 必须连续）
- 如果队列中第一个结果的 `utterance_index` 不等于 `expected_index`，就会等待，不会返回任何结果
- 从日志看，`utterance_index=28` 的结果被添加到了队列，但是 `expected_index` 可能不是 28

**可能的原因**:
1. 之前的 `utterance_index` 的结果还没有到达，导致 `expected_index` 还在等待更早的结果
2. 某些 `utterance_index` 的结果丢失了，导致队列卡住
3. 结果队列的 `expected_index` 初始化有问题

---

## 建议的修复方案

### 1. ASR识别准确度

**立即检查**:
1. 检查ASR worker返回的原始文本（在pickle序列化之前）
2. 检查文本在pickle序列化/反序列化过程中的编码
3. 检查日志文件的编码设置（应该使用UTF-8）

**可能的修复**:
1. 确保所有文本处理都使用UTF-8编码
2. 在pickle序列化/反序列化时显式指定编码
3. 检查Faster Whisper模型的配置和加载

### 2. 重复内容

**检查**:
1. 确认去重逻辑是否处理了所有类型的重复
2. 检查调度服务器是否发送了重复的结果

**可能的修复**:
1. 增强去重逻辑，处理多个utterance之间的重复
2. 在调度服务器端添加去重检查

### 3. 结果队列

**立即检查**:
1. 检查 `expected_index` 的初始值
2. 检查是否有 `utterance_index` 的结果丢失
3. 添加超时机制，如果等待时间过长，跳过缺失的结果

**可能的修复**:
1. 添加结果队列的调试日志，显示 `expected_index` 和队列中的 `utterance_index`
2. 实现超时机制，如果等待时间过长（例如5秒），跳过缺失的结果并继续处理下一个
3. 实现结果队列的重置机制，如果检测到队列卡住，重置 `expected_index`

---

## 下一步行动

1. **立即**: 添加结果队列的调试日志，显示 `expected_index` 和队列状态
2. **立即**: 检查ASR worker返回的原始文本编码
3. **短期**: 实现结果队列的超时机制
4. **短期**: 增强去重逻辑，处理多个utterance之间的重复
5. **长期**: 优化ASR识别准确度（可能需要调整模型配置或音频质量阈值）

