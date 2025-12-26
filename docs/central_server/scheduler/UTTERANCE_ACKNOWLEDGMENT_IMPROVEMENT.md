# Utterance 核销机制改进方案（补位机制）

## 问题分析

### 当前 Gap Timeout 机制的问题

1. **固定超时放大延迟**：
   - 无论任务是否真的在处理，只要超过 5 秒就创建 `MissingResult`
   - 如果任务实际需要 6 秒，但 5 秒就标记为 Missing，用户会看到错误的结果
   - 这会导致用户体验差，因为用户会看到很多 Missing 结果

2. **阻塞其他 utterance**：
   - 如果 `expected_index=10` 的结果未到，即使 `utterance_index=11, 12, 13` 的结果都到了，也会被阻塞
   - 这会导致整体流程变慢

3. **网络延迟导致的误判**：
   - 如果因为网络延迟等原因，`utterance_index=10` 的结果延迟到达，但 `utterance_index=11` 先到了
   - 立即核销 `utterance_index=10` 会导致丢失关键信息

## 改进方案

### 核心思想

**节点端是单进程顺序处理**，因此：
- 如果 `utterance_index=11` 的结果返回了，说明 `utterance_index=10` 已经处理完了（要么返回结果，要么被丢弃）
- 但是，由于网络延迟等原因，`utterance_index=10` 的结果可能还在路上
- **给丢失的 index 一个 5 秒的补位窗口**：如果 5 秒内收到了结果，就按顺序插入；如果超时，才核销

### 实现逻辑

1. **节点端主动返回空结果**（已实现）：
   - 当 ASR 结果为空时，节点端会返回空的 `job_result`（`text_asr: ""`, `text_translated: ""`）
   - 这已经实现了"节点端主动返回被丢弃的 utterance_index"

2. **调度服务器补位机制（先到先发）**：
   - 当收到后续 index（如 `utterance_index=11`）时，将前面的缺失 index（如 `utterance_index=10`）标记为**等待补位**状态
   - **先到先发**：即使 `utterance_index=10` 在等待补位，`utterance_index=11` 的结果也会**立即发送**，不阻塞，不用等5秒
   - 等待补位状态保留 5 秒：
     - 如果 5 秒内收到了结果，**也立即发送**（先到先发），但会在已发送的结果之后（因为它们已经先发送了）
     - 如果超过 5 秒才收到结果，**直接丢弃**，不再发送
     - 如果 5 秒内没收到，**直接跳过**（不创建 Missing result），只递增 `expected`
   - **基于单进程顺序处理的特性**：如果后续 index 已到达，说明前面的 index 已经处理完了（要么返回结果，要么被丢弃）
   - **不再使用 gap_timeout**：如果后续 index 没来，说明可能真的没有任务，直接停止等待

### 代码实现

#### 数据结构

```rust
// 等待补位的索引状态
struct PendingAcknowledgment {
    wait_start_ms: i64,      // 开始等待的时间戳
    ack_timeout_ms: i64,     // 补位超时时间（5秒）
}

struct SessionQueueState {
    // ... 其他字段 ...
    pending_acknowledgments: HashMap<u64, PendingAcknowledgment>,  // 等待补位的索引
    ack_timeout_ms: i64,  // 补位超时时间（5秒）
}
```

#### 收到结果时的处理

```rust
pub async fn add_result(&self, session_id: &str, utterance_index: u64, result: SessionMessage) {
    // 检查这个 index 是否在等待补位列表中
    if state.pending_acknowledgments.remove(&utterance_index).is_some() {
        info!("Received result for pending acknowledgment index, will be inserted in order");
    }
    
    // 检查是否有后续 index 已到达，如果有，将前面的 index 标记为等待补位
    if utterance_index > state.expected {
        for missing_index in state.expected..utterance_index {
            if !state.pending.contains_key(&missing_index) && 
               !state.pending_acknowledgments.contains_key(&missing_index) {
                state.pending_acknowledgments.insert(missing_index, PendingAcknowledgment {
                    wait_start_ms: now_ms,
                    ack_timeout_ms: 5 * 1000,  // 5秒
                });
            }
        }
    }
    
    // 插入结果
    state.pending.insert(utterance_index, result);
}
```

#### 获取就绪结果时的处理

```rust
// 3) expected 未到且队列中没有更小的索引：检查 expected 的等待补位状态是否超时
if let Some(ack_state) = state.pending_acknowledgments.get(&state.expected) {
    let elapsed_ms = now_ms - ack_state.wait_start_ms;
    if elapsed_ms >= ack_state.ack_timeout_ms {
        // 等待补位超时，核销 expected
        // 创建 Missing 占位结果
        // ...
        state.expected += 1;
        continue;
    } else {
        // 还在等待补位，不核销，继续等待
        break;
    }
}
```

## 预期效果

1. **减少信息丢失**：给延迟到达的结果一个 5 秒的补位窗口，避免因网络延迟导致的误判
2. **不阻塞其他 utterance**：即使 `expected` 在等待补位，后续的结果也可以继续处理（存储在 pending 中）
3. **按顺序插入**：如果 5 秒内收到了等待补位的结果，会按顺序插入，保证信息完整性
4. **语序混乱可接受**：如果补位结果延迟到达，可能会在后续结果之后插入，导致语序混乱，但比丢失关键信息要好

## 配置参数

- `ack_timeout_ms`: 5 秒（等待补位的超时时间）
- `gap_timeout_ms`: 已废弃，不再使用（基于单进程顺序处理和补位机制）

## 验证方法

1. **测试场景 1**：节点端返回 `utterance_index=11` 的结果，但 `utterance_index=10` 未返回
   - **预期**：
     - 调度服务器将 `utterance_index=10` 标记为等待补位
     - **`utterance_index=11` 的结果立即发送**（先到先发，不阻塞）
     - 如果 5 秒内收到 `utterance_index=10` 的结果，按顺序插入（在 11 之前）
     - 如果 5 秒内没收到，**直接跳过**（不创建 Missing result），只递增 `expected`

2. **测试场景 2**：节点端返回 `utterance_index=10, 12, 13` 的结果，但 `utterance_index=11` 未返回
   - **预期**：
     - 调度服务器将 `utterance_index=11` 标记为等待补位
     - **`utterance_index=12, 13` 的结果立即发送**（先到先发，不阻塞，不用等5秒）
     - 如果 5 秒内收到 `utterance_index=11` 的结果，**也立即发送**（先到先发），但会在 `index=12, 13` 之后（因为它们已经先发送了）
     - 如果超过 5 秒才收到 `utterance_index=11` 的结果，**直接丢弃**，不再发送
     - 如果 5 秒内没收到，**直接跳过**（不创建 Missing result），只递增 `expected`

4. **测试场景 4**：节点端返回 `utterance_index=11` 的结果，`utterance_index=10` 的结果在 3 秒后到达
   - **预期**：
     - `utterance_index=11` 的结果**立即发送**（先到先发）
     - `utterance_index=10` 的结果在 3 秒后到达（在5秒内），**也立即发送**（先到先发），但会在 `index=11` 之后（因为它已经先发送了）
     - 不会丢失 `utterance_index=10` 的结果

3. **测试场景 3**：节点端返回 `utterance_index=10` 的结果，但 `utterance_index=11` 未返回，且没有后续索引
   - **预期**：调度服务器**直接停止等待**（不创建 Missing result），让后续的结果自然触发处理

4. **测试场景 4**：节点端返回 `utterance_index=11` 的结果，`utterance_index=10` 的结果在 3 秒后到达
   - **预期**：`utterance_index=10` 的结果按顺序插入（在 11 之前），不会丢失

