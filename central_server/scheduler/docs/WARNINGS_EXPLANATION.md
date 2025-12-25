# 调度服务器警告信息说明

## 1. Session Idle Timeout（会话空闲超时）

### 警告信息
```
WARN Session idle timeout, closing actor session_id=s-A04EF556 idle_secs=70
```

### 含义
- **触发条件**: 会话（Session）在 **60秒** 内没有任何活动（没有收到音频数据、心跳等）
- **当前状态**: 会话已空闲 **70秒**，超过了默认的 60秒超时阈值
- **系统行为**: 调度服务器自动关闭该会话的 Actor，释放相关资源

### 代码位置
- **文件**: `src/websocket/session_actor/actor.rs`
- **默认超时**: 60秒（第73行）
- **检查间隔**: 每10秒检查一次（第142行）

```rust
// 默认配置
idle_timeout_secs: 60, // 默认 60 秒空闲超时

// 检查逻辑（每10秒执行一次）
_ = sleep(Duration::from_secs(10)) => {
    if self.last_activity.elapsed().as_secs() > self.idle_timeout_secs {
        warn!("Session idle timeout, closing actor");
        break; // 退出 Actor 循环
    }
}
```

### 影响

#### ✅ 正常情况（预期行为）
1. **资源清理**: 自动释放长时间不活跃的会话资源
2. **内存管理**: 防止内存泄漏，清理音频缓冲区
3. **系统稳定性**: 避免僵尸会话占用系统资源

#### ⚠️ 可能的问题
1. **用户长时间不说话**: 如果用户暂停说话超过60秒，会话会被关闭
   - **影响**: 用户再次说话时，需要重新建立会话
   - **表现**: Web端可能需要重新连接或重新开始会话

2. **网络延迟**: 如果网络延迟导致心跳包丢失，可能误判为空闲
   - **影响**: 活跃会话被错误关闭
   - **表现**: 用户正在使用但会话被关闭

### 清理操作
当会话超时关闭时，会执行以下清理：
```rust
async fn cleanup(&mut self) {
    // 1. 取消所有定时器
    self.cancel_timers();
    
    // 2. 清理音频缓冲区（所有 utterance_index）
    for i in 0..=current_index {
        self.state.audio_buffer.take_combined(&self.session_id, i).await;
    }
    
    // 3. 使所有 timer 失效
    self.internal_state.timer_generation = u64::MAX;
}
```

### 解决方案

#### 1. 调整超时时间（如果60秒太短）
- 修改 `src/websocket/session_actor/actor.rs` 第73行
- 将 `idle_timeout_secs: 60` 改为更大的值（如 120 或 300）

#### 2. 确保心跳机制正常工作
- 检查 Web 端是否正常发送 `client_heartbeat`
- 检查心跳间隔是否合理（建议 < 30秒）

#### 3. 在 Web 端处理会话关闭
- 监听 `session_close` 消息
- 自动重新建立会话或提示用户

---

## 2. Gap Timeout（结果间隔超时）

### 警告信息
```
WARN Gap timeout, creating Missing result session_id=s-A04EF556 utterance_index=20 elapsed_ms=9992 gap_timeout_ms=5000
```

### 含义
- **触发条件**: 等待某个 `utterance_index` 的翻译结果超过 **5秒**（默认）
- **当前状态**: 
  - 正在等待 `utterance_index=20` 的结果
  - 已经等待了 **9992毫秒**（约10秒）
  - 超过了 **5000毫秒**（5秒）的超时阈值
- **系统行为**: 创建一个 `MissingResult` 占位结果，防止结果队列锁死

### 代码位置
- **文件**: `src/managers/result_queue.rs`
- **默认超时**: 5秒（5000毫秒，第42行）

```rust
// 默认配置
gap_timeout_ms: 5 * 1000, // 默认 5 秒

// 检查逻辑
let elapsed_ms = now_ms - state.gap_wait_start_ms;
if elapsed_ms >= state.gap_timeout_ms {
    warn!("Gap timeout, creating Missing result");
    
    // 创建 Missing 占位结果
    let missing_result = SessionMessage::MissingResult {
        session_id: session_id.to_string(),
        utterance_index: state.expected,
        reason: "gap_timeout".to_string(),
        created_at_ms: now_ms,
        trace_id: None,
    };
    ready.push(missing_result);
    
    // 继续等待下一个 utterance_index
    state.expected += 1;
    state.consecutive_missing += 1;
}
```

### 影响

#### ✅ 正常情况（保护机制）
1. **防止队列锁死**: 如果某个结果永远不返回，系统会继续处理后续结果
2. **保证顺序**: 确保结果按 `utterance_index` 顺序发送给客户端
3. **容错性**: 即使某个任务失败或丢失，不影响整体流程

#### ⚠️ 可能的问题
1. **节点处理慢**: 节点端处理任务超过5秒
   - **影响**: 会创建 Missing 结果，客户端收到空结果
   - **表现**: Web端显示空白文本或跳过该 utterance

2. **任务丢失**: 节点端任务失败但未返回错误
   - **影响**: 结果永远无法到达，会一直创建 Missing 结果
   - **表现**: 连续出现多个 Missing 结果

3. **网络问题**: 节点返回结果但网络传输丢失
   - **影响**: 调度服务器未收到结果，创建 Missing 结果
   - **表现**: 节点端显示成功，但客户端收到 Missing

### MissingResult 消息格式
```rust
SessionMessage::MissingResult {
    session_id: String,
    utterance_index: u64,
    reason: "gap_timeout",  // 或 "pending_overflow_evict"
    created_at_ms: i64,
    trace_id: Option<String>,
}
```

### 连续 Missing 处理
系统会跟踪连续 Missing 的数量：
- **默认阈值**: 20个连续 Missing（第44行）
- **行为**: 如果连续 Missing 超过阈值，可能触发会话重置

```rust
// 检查是否应该重置会话
pub async fn should_reset_session(&self, session_id: &str) -> bool {
    // 如果连续 Missing 超过阈值，返回 true
    state.consecutive_missing >= state.missing_reset_threshold
}
```

### 解决方案

#### 1. 调整超时时间（如果5秒太短）
- 修改 `src/managers/result_queue.rs` 第42行
- 将 `gap_timeout_ms: 5 * 1000` 改为更大的值（如 10秒或15秒）

#### 2. 检查节点端性能
- 检查节点端任务处理时间
- 优化节点端处理逻辑，确保在5秒内返回结果
- 检查节点端是否有任务堆积

#### 3. 检查网络连接
- 检查调度服务器与节点之间的网络延迟
- 检查是否有网络丢包情况

#### 4. 在 Web 端处理 Missing 结果
- 监听 `missing_result` 消息
- 显示占位文本或提示用户
- 记录日志用于问题排查

---

## 两个警告的关系

### 场景分析
1. **用户停止说话** → 触发 Session Idle Timeout（60秒后）
2. **节点处理慢** → 触发 Gap Timeout（5秒后）
3. **两者可能同时发生** → 会话关闭 + 多个 Missing 结果

### 典型场景
```
时间线：
0s:  用户发送 utterance_index=20 的音频
5s:  节点仍在处理，触发 Gap Timeout，创建 MissingResult
10s: 节点返回结果（但已创建 MissingResult）
60s: 用户未继续说话，触发 Session Idle Timeout
70s: 会话关闭，清理资源
```

### 建议
1. **监控这两个指标**:
   - Session Idle Timeout 频率 → 判断用户使用模式
   - Gap Timeout 频率 → 判断节点性能问题

2. **调整配置**:
   - 根据实际使用场景调整超时时间
   - 平衡用户体验和系统资源

3. **日志分析**:
   - 记录 `trace_id` 用于全链路追踪
   - 分析 Missing 结果的原因（节点慢 vs 网络问题）

---

## 配置建议

### 开发环境
```toml
# 更宽松的超时，便于调试
session_idle_timeout_secs = 300  # 5分钟
gap_timeout_ms = 10000           # 10秒
```

### 生产环境
```toml
# 平衡用户体验和资源
session_idle_timeout_secs = 120  # 2分钟
gap_timeout_ms = 5000            # 5秒（默认）
```

### 高负载环境
```toml
# 更激进的资源回收
session_idle_timeout_secs = 60    # 1分钟（默认）
gap_timeout_ms = 3000            # 3秒
```

---

## 相关文件

- `src/websocket/session_actor/actor.rs` - Session Actor 实现
- `src/managers/result_queue.rs` - 结果队列管理
- `src/messages/session.rs` - MissingResult 消息定义

