# Job7和Job8去重问题日志分析

## 关键发现

### Job7 (utteranceIndex 7, job-4B9EA37B)

**ASR文本**: "所以要这个语音阶段正常来我们就可以继续使用" (21字符)

**处理流程**:
1. ✅ ASR识别成功
2. ✅ 聚合完成（NEW_STREAM）
3. ⚠️ 语义修复服务未运行：`"reasonCodes":["SERVICE_NOT_RUNNING"]`
4. ✅ 翻译完成：`"So we can continue to use this sound stage as normal."`
5. ✅ 发送结果

**关键信息**:
- `action: "NEW_STREAM"` - 新流，没有与之前的utterance合并
- `shouldCommit: true` - 已提交
- 文本已添加到`recentCommittedText`

---

### Job8 (utteranceIndex 8, job-98EE94AF)

**ASR文本**: "这个语音阶段正常来我们就可以使用这个语音阶段正常来我们可以使用" (31字符)

**处理流程**:
1. ✅ ASR识别成功（但文本本身有重复）
2. ✅ 聚合完成（MERGE）
3. ⚠️ 语义修复服务未运行：`"reasonCodes":["SERVICE_NOT_RUNNING"]`
4. ✅ 翻译完成：`"This sound stage is normal so we can use this sound phase normal so that we can"`
5. ✅ 发送结果

**关键信息**:
- `action: "MERGE"` - 合并操作
- `shouldCommit: true` - 已提交
- `contextText: "所以要这个语音阶段正常来我们就可以继续使用"` - 使用了Job7的文本作为context

**问题**:
1. ❌ **没有与Job7去重**：Job8的开头"这个语音阶段正常来我们就可以使用"与Job7的结尾"我们就可以继续使用"有重叠，但没有被去重
2. ❌ **内部重复未检测到**：Job8的ASR文本本身就有重复（"这个语音阶段正常来我们就可以使用"出现了两次），但`detectInternalRepetition`没有检测到

---

## 问题分析

### 问题1: Job8没有与Job7去重

**原因分析**:

1. **`getLastCommittedText`返回了Job7的文本**：
   - 日志显示Job8使用了`contextText: "所以要这个语音阶段正常来我们就可以继续使用"`（Job7的文本）
   - 说明`getLastCommittedText`成功返回了Job7的文本

2. **`TextForwardMergeManager.processText`应该被调用**：
   - 在`AggregationStage.process`中，会调用`TextForwardMergeManager.processText`
   - 但日志中没有看到`TextForwardMergeManager`的去重日志

3. **可能的原因**：
   - `TextForwardMergeManager.processText`没有被调用（代码路径问题）
   - `dedupMergePrecise`没有检测到重叠（"继续使用" vs "使用"）
   - 去重日志级别太低，没有记录

**需要确认**:
- 查看`AggregationStage`的完整日志，确认`TextForwardMergeManager.processText`是否被调用
- 查看`dedupMergePrecise`的调用日志，确认是否检测到重叠

---

### 问题2: Job8内部重复未检测到

**原因分析**:

1. **ASR文本本身有重复**：
   - Job8的ASR文本："这个语音阶段正常来我们就可以使用这个语音阶段正常来我们可以使用"
   - 重复部分："这个语音阶段正常来我们就可以使用"（出现了两次）

2. **`detectInternalRepetition`应该被调用**：
   - 在`PostProcessCoordinator.process`中，会在语义修复之前调用`detectInternalRepetition`
   - 但日志中没有看到`detectInternalRepetition`的日志

3. **可能的原因**：
   - `detectInternalRepetition`没有被调用（代码路径问题）
   - `detectInternalRepetition`没有检测到重复（算法问题）
   - 检测日志级别太低，没有记录

**需要确认**:
- 查看`PostProcessCoordinator`的完整日志，确认`detectInternalRepetition`是否被调用
- 查看`detectInternalRepetition`的返回值，确认是否检测到重复

---

## 改进建议

### 1. 增加去重日志

在以下位置增加详细日志：
- `TextForwardMergeManager.processText`：记录`previousText`、`currentText`、`dedupResult`
- `dedupMergePrecise`：记录重叠检测的详细过程
- `detectInternalRepetition`：记录重复检测的详细过程

### 2. 检查代码路径

确认：
- `AggregationStage.process`是否调用了`TextForwardMergeManager.processText`
- `PostProcessCoordinator.process`是否调用了`detectInternalRepetition`

### 3. 改进去重算法

根据日志分析：
- `dedupMergePrecise`需要支持部分匹配（"继续使用"包含"使用"）
- `detectInternalRepetition`需要支持相似度匹配（允许少量差异）

---

## 下一步

1. **查看完整的处理流程日志**，确认每个步骤是否执行
2. **增加详细的去重日志**，便于调试
3. **测试改进后的去重算法**，确认是否能正确检测重叠和重复
