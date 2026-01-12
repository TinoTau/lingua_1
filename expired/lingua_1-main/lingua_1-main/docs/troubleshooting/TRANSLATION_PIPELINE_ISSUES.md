# 翻译管道问题诊断

## 问题描述

用户报告：
1. **半句话被丢弃**：某些音频片段没有被翻译
2. **最后一句话无法及时返回**：需要继续说才能把之前的结果顶上来

## 日志分析发现

从调度服务器日志中发现：
- 大量空结果（静音检测）：utterance_index 38, 40, 42, 44, 46
- 这些空结果被标记为 "Empty translation result (silence detected)"
- utterance_index 不连续，说明某些音频块可能被跳过

## 潜在问题分析

### 1. Finalize 时机问题

**问题位置**：`central_server/scheduler/src/websocket/session_actor/actor.rs`

**问题描述**：
- 当 `pause_exceeded` 或 `MaxDuration` 触发时，会先 `finalize` 当前 utterance
- 如果此时音频缓冲区为空（可能因为之前的音频块已经被处理），会递增 `utterance_index` 但不创建 job
- 新的音频块会被添加到新的 `utterance_index`，但之前的音频块可能已经被丢弃

**相关代码**：
```rust
// 在 handle_audio_chunk 中
if pause_exceeded {
    let finalized = self.try_finalize(utterance_index, "Pause").await?;
    if finalized {
        utterance_index = self.internal_state.current_utterance_index;
    }
}
// 然后才添加新的音频块
self.state.audio_buffer.add_chunk(&self.session_id, utterance_index, chunk).await;
```

### 2. 音频缓冲区为空时的处理

**问题位置**：`central_server/scheduler/src/websocket/session_actor/actor.rs:567-581`

**问题描述**：
- 当 `do_finalize` 时，如果音频缓冲区为空，仍然会 finalize（递增 utterance_index）
- 这会导致 utterance_index 递增，但没有创建 job
- 后续的音频块会被添加到新的 utterance_index，但之前的音频块可能已经被丢弃

**相关代码**：
```rust
let audio_data = match audio_data_opt {
    Some(data) if !data.is_empty() => data,
    _ => {
        warn!("Audio buffer empty, but still finalizing to increment utterance_index");
        return Ok(true); // 递增 utterance_index，但不创建 job
    }
};
```

### 3. Short-merge 逻辑可能导致音频块丢失

**问题位置**：`central_server/scheduler/src/websocket/session_actor/actor.rs:288-348`

**问题描述**：
- 如果音频块 < `short_merge_threshold_ms` 且不是 `is_final`，会被标记为 pending
- 如果后续没有正常片段，这些短片段可能永远不会被 finalize
- 如果 pause 或 MaxDuration 触发，可能会跳过这些短片段

## 建议的修复方案

### 方案1：确保音频块在 finalize 前被添加

**修改位置**：`handle_audio_chunk` 方法

**修改内容**：
- 在检查 pause_exceeded 和 MaxDuration 之前，先添加当前音频块
- 这样可以确保音频块不会被丢弃

### 方案2：改进 finalize 逻辑

**修改位置**：`do_finalize` 方法

**修改内容**：
- 如果音频缓冲区为空，不应该 finalize（不递增 utterance_index）
- 或者，应该等待音频块到达后再 finalize

### 方案3：改进 Short-merge 逻辑

**修改位置**：`handle_audio_chunk` 方法中的 Short-merge 部分

**修改内容**：
- 当 pause 或 MaxDuration 触发时，应该 finalize 包括 pending 的短片段
- 确保所有音频块都被处理

## 检查清单

请检查以下日志以确认问题：

1. **调度服务器日志**：
   - 查找 "Audio buffer empty, but still finalizing" 警告
   - 查找 utterance_index 不连续的情况
   - 查找 "Short audio chunk detected, merging to next segment" 日志

2. **节点端日志**：
   - 检查是否有 job_assign 但没有对应的 job_result
   - 检查 job_result 中的 utterance_index 是否连续

3. **Web端日志**（浏览器控制台）：
   - 检查是否收到所有 translation_result
   - 检查是否有音频块被丢弃的警告

## 下一步

1. 添加更详细的日志，记录音频块的添加和 finalize 过程
2. 修复 finalize 逻辑，确保音频块不会被丢弃
3. 测试修复后的行为，确保所有音频块都被翻译

