# AudioAggregator vs UtteranceAggregator 诊断报告

## 执行时间
2026-01-26

## 测试场景
用户朗读了一段长文本（约200字），测试语音识别稳定性。

## 问题现象
返回结果中：
- 某些job的文本丢失（[2], [6], [8]缺失）
- 某些job的文本不完整（如"那就说明我"处截断）
- 某些job的文本为空

## 诊断结果

### 1. AudioAggregator层面 ✅ 正常

**发现：**
- AudioAggregator的originalJobIds分配正常
- 所有job都被正确分配到originalJobIds
- MaxDuration finalize后的剩余音频被正确合并到后续job

**证据：**
- 找到11个AudioAggregator分配事件
- 所有MaxDuration finalize的剩余音频都在后续job中正确合并
- 没有发现originalJobIds分配错误

### 2. Dispatcher层面 ⚠️ 部分问题

**发现：**
- 有2个job的ASR结果为空（job-ae39f384, job-bcf2b65c）
- 这些job有AudioAggregator分配，但没有ASR输入输出记录

**可能原因：**
1. 音频太短，被AudioAggregator丢弃（shouldReturnEmpty=true）
2. ASR处理失败，没有返回结果
3. 空容器检测逻辑发送了空结果（NO_TEXT_ASSIGNED）

### 3. UtteranceAggregator层面 ✅ 正常

**发现：**
- UtteranceAggregator的处理正常
- 没有发现文本被误丢弃或误去重的情况

### 4. MaxDuration Finalize ⚠️ 需要关注

**发现：**
- 有4个MaxDuration finalize事件有剩余音频
- 所有剩余音频都在后续job中正确合并
- 但合并后的文本可能仍然不完整（如job-8290122b在"那就说明我"处截断）

**分析：**
- MaxDuration finalize时，音频被切分成多个批次
- 前5秒（及以上）的音频被立即处理
- 剩余部分（<5秒）被缓存到pendingMaxDurationAudio
- 后续job会合并这些剩余音频
- **问题：** 合并后的音频可能仍然<5秒，导致文本不完整

## 根本原因

### 主要问题：MaxDuration finalize后的文本截断

**问题流程：**
1. 长音频（>10秒）触发MaxDuration finalize
2. 音频被切分成多个批次，前5秒（及以上）立即处理
3. 剩余部分（<5秒）被缓存到pendingMaxDurationAudio
4. 后续job合并剩余音频，但合并后的音频可能仍然<5秒
5. 这些短音频被发送给ASR，但识别结果可能不完整

**证据：**
- job-8290122b的文本在"那就说明我"处截断
- 这正是MaxDuration finalize后的剩余音频（1380ms）
- 合并后的音频（3200ms）仍然较短，可能导致识别不完整

### 次要问题：空文本job

**问题流程：**
1. 某些job的音频太短，被AudioAggregator丢弃
2. 或者ASR处理失败，没有返回结果
3. 空容器检测逻辑发送了空结果（NO_TEXT_ASSIGNED）

## 建议修复方向

### 1. 修复MaxDuration finalize后的文本截断

**问题：** 剩余音频合并后仍然<5秒，导致识别不完整

**建议：**
- 检查合并后的音频时长
- 如果合并后仍然<5秒，考虑继续等待下一个job
- 或者调整MIN_ACCUMULATED_DURATION_FOR_ASR_MS阈值

### 2. 修复空文本job

**问题：** 某些job的ASR结果为空

**建议：**
- 检查AudioAggregator的shouldReturnEmpty逻辑
- 检查ASR失败处理
- 检查空容器检测逻辑，确保只在真正空容器时发送空结果

### 3. 增强日志记录

**建议：**
- 在AudioAggregator中记录每个job的音频时长
- 在Dispatcher中记录每个batch的ASR结果
- 在UtteranceAggregator中记录文本过滤的原因

## 结论

**问题主要出在AudioAggregator层面：**
- MaxDuration finalize后的剩余音频处理逻辑需要优化
- 剩余音频合并后仍然<5秒，导致识别不完整

**UtteranceAggregator层面正常：**
- 没有发现文本被误丢弃或误去重的情况

**建议优先修复：**
1. MaxDuration finalize后的剩余音频处理逻辑
2. 空文本job的处理逻辑
