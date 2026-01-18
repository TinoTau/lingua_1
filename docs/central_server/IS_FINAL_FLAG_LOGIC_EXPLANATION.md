# is_final标签处理逻辑说明

**日期**: 2026-01-16  
**问题**: 
1. `is_final`标签会触发什么逻辑？
2. 为什么pause不会发送`is_final`标签？

---

## 一、is_final标签的触发逻辑

### 1.1 处理流程

当调度服务器收到`is_final=true`的`audio_chunk`消息时，会触发以下逻辑：

```
Web端发送 is_final=true 的 audio_chunk
    ↓
handle_audio_chunk() 接收消息
    ↓
SessionActor.handle_audio_chunk() 处理音频块
    ↓
检测到 is_final = true
    ↓
设置 finalize_reason = "IsFinal"
    ↓
调用 try_finalize(utterance_index, "IsFinal")
    ↓
执行 do_finalize()
    ├─ 清除timeout_node_id映射（手动finalize）
    ├─ 创建翻译任务
    └─ 派发任务到节点
```

### 1.2 代码位置

#### 接收is_final消息
```rust
// central_server/scheduler/src/websocket/session_message_handler/audio.rs
pub(super) async fn handle_audio_chunk(
    state: &AppState,
    sess_id: String,
    is_final: bool,  // ✅ 接收is_final标志
    payload: Option<String>,
    client_timestamp_ms: Option<i64>,
) -> Result<(), anyhow::Error> {
    // 发送音频块事件到 Actor
    actor_handle.send(SessionEvent::AudioChunkReceived {
        chunk,
        is_final,  // ✅ 传递is_final标志
        timestamp_ms: now_ms,
        client_timestamp_ms,
    })
}
```

#### 处理is_final触发finalize
```rust
// central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs
pub(crate) async fn handle_audio_chunk(
    &mut self,
    chunk: Vec<u8>,
    is_final: bool,
    timestamp_ms: i64,
    client_timestamp_ms: Option<i64>,
) -> Result<(), anyhow::Error> {
    // ... 添加音频块到缓冲区 ...
    
    // 检查 is_final
    if is_final {
        should_finalize = true;
        finalize_reason = "IsFinal";  // ✅ 设置为IsFinal
    }
    
    // 如果需要finalize，调用try_finalize
    if should_finalize {
        let finalized = self.try_finalize(utterance_index, finalize_reason).await?;
    }
}
```

### 1.3 is_final触发的最终行为

当`is_final=true`时，最终会触发：

1. **设置finalize_reason为"IsFinal"**
   - `is_manual_cut = true`
   - `is_pause_triggered = false`
   - `is_timeout_triggered = false`

2. **清除Session Affinity映射**
   - 在jobs创建之前清除`timeout_node_id`
   - 允许后续job随机分配节点

3. **立即创建翻译任务**
   - 不需要等待pause或timeout
   - 立即处理当前累积的音频

4. **指标统计**
   - 调用`on_web_task_finalized_by_send()`
   - 用于统计用户主动发送的次数

---

## 二、为什么pause不会发送is_final标签？

### 2.1 核心原因：Pause是调度服务器端检测，不是Web端发送

**关键点**：
- **Pause检测发生在调度服务器端**，通过比较相邻`audio_chunk`的时间间隔
- **Web端不需要发送`is_final`**，因为调度服务器会自动检测pause

### 2.2 Pause检测机制

#### 触发逻辑
```
用户说话 → 音频chunk持续到达（间隔<3秒）
    ↓
用户停顿超过3秒 → 下一个chunk到达（时间间隔>3秒）
    ↓
调度服务器检测到 pause_exceeded = true
    ↓
自动触发 finalize，设置 finalize_reason = "Pause"
    ↓
（Web端没有发送is_final，pause是服务器端检测的）
```

#### 代码实现
```rust
// central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs
pub(crate) async fn handle_audio_chunk(...) {
    // 检查pause是否超过阈值（只有实际音频内容才用于pause检测）
    let pause_exceeded = if chunk_size > 0 {
        self.state
            .audio_buffer
            .record_chunk_and_check_pause(&self.session_id, timestamp_ms, self.pause_ms)
            .await
    } else {
        false  // 空的is_final消息不触发pause检测
    };
    
    // 如果pause超过阈值，触发finalize
    if pause_exceeded {
        should_finalize = true;
        finalize_reason = "Pause";  // ✅ 服务器端自动检测，不是Web端发送
    }
}
```

#### Pause检测的实现细节
```rust
// central_server/scheduler/src/managers/audio_buffer.rs
pub async fn record_chunk_and_check_pause(
    &self, 
    session_id: &str, 
    now_ms: i64, 
    pause_ms: u64
) -> bool {
    let mut map = self.last_chunk_at_ms.write().await;
    let exceeded = map
        .get(session_id)
        .map(|prev| now_ms.saturating_sub(*prev) > pause_ms as i64)  // ✅ 比较时间间隔
        .unwrap_or(false);
    map.insert(session_id.to_string(), now_ms);  // 更新最后收到chunk的时间
    exceeded  // 返回是否超过pause阈值
}
```

### 2.3 为什么这样设计？

#### 优势1：分离关注点
- **Web端**：专注于音频采集和发送，不需要复杂的pause检测逻辑
- **调度服务器**：统一管理pause检测，保证一致性

#### 优势2：避免重复检测
- 如果Web端和服务器端都做pause检测，可能导致：
  - Web端发送`is_final` → 服务器也检测到pause → 重复finalize
  - 或者逻辑不一致，导致行为不可预测

#### 优势3：灵活性
- 调度服务器可以根据不同配置调整`pause_ms`阈值
- 不需要修改Web端代码

### 2.4 Web端何时发送is_final？

**Web端只在以下情况发送`is_final=true`**：

#### 情况1：用户手动点击发送按钮
```typescript
// webapp/web-client/src/app/session_manager.ts
async sendCurrentUtterance(): Promise<void> {
    // ...发送剩余音频数据...
    
    // 用户点击发送按钮时，调用sendFinal()
    this.wsClient.sendFinal();  // ✅ 发送is_final=true
}
```

#### 情况2：sendFinal()实现
```typescript
// webapp/web-client/src/websocket/audio_sender.ts
async sendFinal(): Promise<void> {
    // JSON模式：发送一个空的audio_chunk消息，is_final=true
    const message = {
        type: 'audio_chunk',
        session_id: this.sessionId,
        timestamp: Date.now(),
        is_final: true,  // ✅ 设置is_final=true
        payload: ''
    };
    this.sendCallback(JSON.stringify(message));
}
```

**关键点**：Web端**不会**在pause场景下自动发送`is_final`。

---

## 三、两种Finalize触发方式对比

| 触发方式 | Web端行为 | 调度服务器行为 | finalize_reason |
|---------|----------|--------------|----------------|
| **用户点击发送** | 调用`sendFinal()`发送`is_final=true` | 检测到`is_final=true` | `"IsFinal"` |
| **静音超过3秒** | 继续发送正常的`audio_chunk`（`is_final=false`） | 检测到`pause_exceeded=true` | `"Pause"` |
| **10秒无新chunk** | 不发送任何消息 | 定时器触发`TimeoutFired`事件 | `"Timeout"` |
| **音频超过20秒** | 继续发送正常的`audio_chunk` | 检测到`accumulated_audio_duration_ms > max_duration_ms` | `"MaxDuration"` |

---

## 四、总结

### 4.1 is_final标签触发什么逻辑？

1. **立即触发finalize**，设置`finalize_reason = "IsFinal"`
2. **清除Session Affinity映射**（`timeout_node_id`）
3. **立即创建翻译任务**，不需要等待pause或timeout
4. **指标统计**：记录为"用户主动发送"

### 4.2 为什么pause不会发送is_final标签？

1. **Pause是调度服务器端检测**，通过比较相邻`audio_chunk`的时间间隔
2. **Web端不需要发送`is_final`**，因为调度服务器会自动检测
3. **设计优势**：
   - 分离关注点（Web端专注采集，服务器端统一检测）
   - 避免重复检测和逻辑冲突
   - 灵活性（服务器端可调整阈值）

### 4.3 核心区别

- **`is_final=true`** → 用户主动触发 → `finalize_reason = "IsFinal"`
- **Pause检测** → 服务器端自动检测 → `finalize_reason = "Pause"`

两者是**不同的触发机制**，不需要Web端在pause场景下发送`is_final`。

---

**参考代码**：
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - `handle_audio_chunk()`
- `central_server/scheduler/src/managers/audio_buffer.rs` - `record_chunk_and_check_pause()`
- `webapp/web-client/src/websocket/audio_sender.ts` - `sendFinal()`
