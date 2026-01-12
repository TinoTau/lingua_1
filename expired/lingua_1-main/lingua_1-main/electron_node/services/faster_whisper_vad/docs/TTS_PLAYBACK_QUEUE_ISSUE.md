# TTS播放问题诊断报告

**日期**: 2025-12-25  
**问题**: 调度服务器收到了节点端返回的结果，但 `get_ready_results` 返回了空列表，导致结果没有发送到web端

---

## 问题总结

### 1. 调度服务器日志

**收到了有效的结果**:
```json
{
  "text_asr": "我继续说的话",
  "text_translated": "What I continue to say.",
  "tts_audio": "...很长的base64字符串...",
  "utterance_index": 28
}
```

**但是 `get_ready_results` 返回了空列表**:
```
Getting ready results from queue, ready_results_count=0
```

**因此没有发送到web端**:
- 没有看到 `"Sending translation result to session"` 或 `"Successfully sent translation result to session"` 的日志
- Web端没有收到任何结果

### 2. 问题根因

**结果队列要求按顺序返回结果**:
- `get_ready_results` 的逻辑要求结果必须按 `utterance_index` 顺序返回
- 如果队列中第一个结果的 `utterance_index` 不等于 `expected_index`，就会等待，不会返回任何结果

**可能的原因**:
1. 之前的 `utterance_index` 的结果还没有到达，导致 `expected_index` 还在等待更早的结果
2. 结果队列的 `expected_index` 初始化有问题（应该从0开始，但可能不是）
3. 某些 `utterance_index` 的结果丢失了，导致队列卡住

### 3. 代码逻辑

```rust
// central_server/scheduler/src/managers/result_queue.rs
pub async fn get_ready_results(&self, session_id: &str) -> Vec<SessionMessage> {
    if let Some((expected_index, queue, deadlines)) = queues.get_mut(session_id) {
        // 从队列开头取出连续的结果
        while let Some(first) = queue.first() {
            if first.utterance_index == *expected_index {
                let result = queue.remove(0);
                ready.push(result.result);
                *expected_index += 1;
            } else {
                // 如果 utterance_index 不匹配，就等待，不返回任何结果
                break;
            }
        }
        ready
    }
}
```

---

## 解决方案

### 方案1: 添加调试日志

在 `get_ready_results` 中添加更详细的日志，记录 `expected_index` 和队列中的 `utterance_index`：

```rust
debug!(
    session_id = %session_id,
    expected_index = *expected_index,
    queue_size = queue.len(),
    queue_indices = ?queue.iter().map(|r| r.utterance_index).collect::<Vec<_>>(),
    "Checking ready results"
);
```

### 方案2: 检查结果队列初始化

确认 `initialize_session` 是否在会话创建时被正确调用，并且 `expected_index` 被初始化为0。

### 方案3: 检查是否有结果丢失

检查是否有更早的 `utterance_index` 的结果丢失了，导致队列卡住。

---

## 下一步

1. 添加调试日志，查看 `expected_index` 和队列中的 `utterance_index` 的具体值
2. 检查结果队列的初始化逻辑
3. 检查是否有结果丢失的情况

