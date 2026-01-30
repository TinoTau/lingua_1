# Job 处理流程详细分析

**日期**: 2026-01-24  
**目的**: 详细分析 Job 处理流程，诊断前半句丢失问题

---

## 一、问题描述

用户反馈：**每句话都只有后半句被识别**，怀疑 AudioAggregator 或 UtteranceAggregator 没有正确合并 job。

## 二、日志分析结果

### 2.1 关键发现

从节点端日志分析，发现以下关键问题：

1. **每个 job 都创建新的 buffer**
   - 所有 job 都显示：`"Buffer not found, creating new buffer"`
   - `hasMergedPendingAudio: false`（所有 job 都没有合并 pending 音频）

2. **音频时长都很短**
   - `utterance_index=0`: `inputAudioDurationMs=2860ms` (2.86秒)
   - `utterance_index=1`: `inputAudioDurationMs=9100ms` (9.1秒) ✅ 完整
   - `utterance_index=2`: `inputAudioDurationMs=1560ms` (1.56秒) ❌ 只有后半句
   - `utterance_index=3`: `inputAudioDurationMs=9100ms` (9.1秒) ✅ 完整
   - `utterance_index=4`: `inputAudioDurationMs=8580ms` (8.58秒) ✅ 完整
   - `utterance_index=5`: `inputAudioDurationMs=4940ms` (4.94秒) ❌ 只有后半句
   - `utterance_index=8`: `inputAudioDurationMs=1560ms` (1.56秒) ❌ 只有后半句

3. **ASR segments 时间戳都从 0 开始**
   - `utterance_index=0`: `start=0, end=2.88`
   - `utterance_index=2`: `start=0, end=1.84`
   - `utterance_index=5`: `start=0, end=5.22`
   - 说明 ASR 服务认为每个音频都是独立的，没有上下文

### 2.2 各 Job 处理详情

#### Job 0 (utterance_index=0)
- **音频时长**: 2860ms
- **ASR 输出**: "開始進行一次語音識別穩定性測試"
- **ASR segments**: `start=0, end=2.88`
- **问题**: 音频被提前 finalize，只识别了前半句

#### Job 1 (utterance_index=1)
- **音频时长**: 9100ms ✅
- **ASR 输出**: "我會先讀一兩句比較短的話用來確認系統會不會在句子之間隨意地把語音切斷或者在沒有必要的時候"
- **ASR segments**: `start=0, end=9.1`
- **状态**: ✅ 完整识别

#### Job 2 (utterance_index=2)
- **音频时长**: 1560ms ❌
- **ASR 输出**: "提前結束本次識別"
- **ASR segments**: `start=0, end=1.84`
- **问题**: 只有后半句，前半句丢失

---

## 三、可能原因

### 3.1 调度服务器过早 finalize

**现象**: 
- `utterance_index=0`: `accumulated_audio_duration_ms=3360` (3.36秒)，但用户说的完整句子应该更长
- `utterance_index=2`: `inputAudioDurationMs=1560` (1.56秒)，明显太短

**可能原因**:
1. 用户手动截断（`reason="IsFinal"`）过早触发
2. 或者 pause 检测过早触发 finalize

### 3.2 AudioAggregator 无法合并

**现象**: 
- 每个 job 都显示 "Buffer not found, creating new buffer"
- 说明每个 job 都是独立的，没有合并之前的音频

**可能原因**:
1. AudioAggregator 没有正确合并多个 job 的音频
2. 或者 Buffer 被提前删除

### 3.3 ASR 模型识别问题

**现象**: 
- ASR segments 显示 `start=0, end=2.88`，说明 ASR 模型只识别了音频的前 2.88 秒
- 但音频总长度是 2.86 秒（节点端）或 3.36 秒（调度服务器）

**可能原因**:
1. ASR 模型在音频开头有静音或噪音，导致只识别了后半部分
2. 或者 ASR 模型的 `no_speech_threshold` 设置过高，导致前半部分被跳过

---

## 四、需要检查的内容

### 4.1 调度服务器 finalize 逻辑

1. **检查 finalize 触发时机**:
   - 是否过早触发 finalize？
   - `accumulated_audio_duration_ms` 是否完整？
   - `audio_size_bytes` 是否完整？

2. **检查 pause 检测**:
   - pause 检测是否过早触发 finalize？
   - pause 阈值是否设置合理？

### 4.2 AudioAggregator 逻辑

1. **检查音频合并**:
   - AudioAggregator 是否正确合并了多个 job 的音频？
   - 是否有音频丢失？

2. **检查 Buffer 清除**:
   - Buffer 是否被提前删除？
   - `pendingTimeoutAudio` 是否被正确保留？

### 4.3 ASR 模型配置

1. **检查 ASR 模型参数**:
   - `no_speech_threshold` 是否设置过高？
   - `initial_prompt` 是否设置正确？
   - `condition_on_previous_text` 是否启用？

---

## 五、关键发现

从日志分析，**最关键的问题是每个 job 都创建新的 buffer，无法合并之前的音频**。这说明：

1. **Buffer 被提前删除**（修复 Buffer 清除逻辑后应该解决）
2. **调度服务器过早 finalize**（需要检查 finalize 逻辑）
3. **ASR 模型只识别了部分音频**（需要检查 ASR 配置）

**建议优先检查**:
1. Buffer 清除逻辑（已修复）
2. 调度服务器的 finalize 逻辑，确认是否过早触发
3. ASR 模型的 `no_speech_threshold` 参数，确认是否设置过高

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
