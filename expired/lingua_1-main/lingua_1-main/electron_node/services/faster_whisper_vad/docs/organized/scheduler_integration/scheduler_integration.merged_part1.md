# Scheduler Integration (Part 1/2)

# Scheduler Integration

本文档合并了所有相关文档。

---

## SCHEDULER_AUDIO_CHUNK_FINALIZE_MECHANISM.md

# 调度服务器Audio Chunk Finalize机制

**日期**: 2025-12-24  
**问题**: 调度服务器如何拼装utterance？是否保存2秒等待手动send？  
**状态**: ✅ **已分析**

---

## 核心机制

### 您的理解（需要修正）

❌ **错误理解**:
- "所有的audio_chunk都会在调度服务器保存2秒等待手动send"
- "如果等不到手动send，就会将2秒之前的音频内容以audio_chunk的形式发送给节点端"

✅ **正确理解**:
- 调度服务器**不会等待手动send**
- 调度服务器有**自动finalize机制**，基于pause检测和超时
- 如果pause_ms（默认2000ms）时间内没有收到新的audio_chunk，**自动finalize**
- 手动send（utterance消息）是**独立的路径**，不经过audio_buffer

---

## 调度服务器的Finalize触发条件

### 1. 立即Finalize（IsFinal）

**触发条件**: 收到`is_final=true`的audio_chunk

```rust
// actor.rs:236
if is_final {
    self.try_finalize(utterance_index, "IsFinal").await?;
}
```

**场景**: Web端静音检测后发送`sendFinal()`

---

### 2. Pause检测Finalize（Pause）

**触发条件**: 本次chunk与上次chunk的时间间隔 > pause_ms（默认2000ms）

```rust
// actor.rs:207-220
let pause_exceeded = self.state
    .audio_buffer
    .record_chunk_and_check_pause(&self.session_id, timestamp_ms, self.pause_ms)
    .await;

if pause_exceeded {
    // 先 finalize 当前 utterance
    let finalized = self.try_finalize(utterance_index, "Pause").await?;
    if finalized {
        utterance_index = self.internal_state.current_utterance_index;
    }
}
```

**场景**: 用户说话停顿超过2秒，然后继续说话

**逻辑**:
- 检测到pause_exceeded → 先finalize上一个utterance
- 然后开始新的utterance（新的utterance_index）

---

### 3. 超时Finalize（Timeout）

**触发条件**: pause_ms时间内没有收到新的audio_chunk

```rust
// actor.rs:254-256
else if self.pause_ms > 0 {
    // 启动/重置超时计时器
    self.reset_timers().await?;
}
```

**场景**: 用户说话后停止，超过2秒没有新的audio_chunk

**逻辑**:
- 每次收到audio_chunk后，重置超时计时器
- 如果pause_ms时间内没有收到新的chunk，超时计时器触发
- 自动finalize当前utterance

---

### 4. 异常保护Finalize（MaxLength）

**触发条件**: 累积音频超过500KB（异常保护）

```rust
// actor.rs:238-253
else if should_finalize_due_to_length {
    // 异常保护：音频长度超过异常保护限制（500KB），自动触发 finalize
    warn!("Audio buffer exceeded异常保护限制 (500KB), auto-finalizing");
    let finalized = self.try_finalize(utterance_index, "MaxLength").await?;
}
```

**场景**: 极端情况下（VAD失效、超时机制失效）音频无限累积

**说明**: 正常情况下不应该触发，因为pause_ms会先触发

---

## 完整数据流

### 场景1: 自动Finalize（纯audio_chunk）

```
Web端录音3秒
  → T=0.0s: sendAudioChunk(chunk0, false)
    → 调度服务器: add_chunk(chunk0) → audio_buffer
    → 启动超时计时器（2秒）
  
  → T=0.1s: sendAudioChunk(chunk1, false)
    → 调度服务器: add_chunk(chunk1) → audio_buffer
    → 重置超时计时器（2秒）
  
  → ... (持续每100ms发送)
  
  → T=2.9s: sendAudioChunk(chunk29, false)
    → 调度服务器: add_chunk(chunk29) → audio_buffer
    → 重置超时计时器（2秒）
  
  → T=3.0s: 静音检测，sendFinal()
    → 调度服务器: 收到is_final=true
    → 立即finalize → take_combined() → 合并所有chunk
    → 创建job → 发送给节点端
```

### 场景2: 超时Finalize

```
Web端录音2秒后停止
  → T=0.0s-2.0s: 每100ms发送audio_chunk
    → 调度服务器: 持续累积，重置计时器
  
  → T=2.0s: 最后一次sendAudioChunk(chunk20, false)
    → 调度服务器: add_chunk(chunk20) → audio_buffer
    → 重置超时计时器（2秒）
  
  → T=4.0s: 超时计时器触发
    → 调度服务器: handle_timeout_fired()
    → 自动finalize → take_combined() → 合并所有chunk
    → 创建job → 发送给节点端
```

### 场景3: Pause检测Finalize

```
Web端说话，停顿，继续说话
  → T=0.0s-1.0s: 说话，每100ms发送audio_chunk
    → 调度服务器: 持续累积，重置计时器
  
  → T=1.0s: 最后一次sendAudioChunk(chunk10, false)
    → 调度服务器: add_chunk(chunk10) → audio_buffer
    → 重置超时计时器（2秒）
  
  → T=3.5s: 用户继续说话，sendAudioChunk(chunk11, false)
    → 调度服务器: record_chunk_and_check_pause()
      → 检测到: 3.5s - 1.0s = 2.5s > 2.0s (pause_ms)
      → pause_exceeded = true
      → 先finalize上一个utterance（chunk0-10）
      → 然后开始新的utterance（chunk11）
```

### 场景4: 手动Send（utterance消息）

```
Web端录音，用户点击发送按钮
  → T=0.0s-2.0s: 每100ms发送audio_chunk
    → 调度服务器: 持续累积到audio_buffer
  
  → T=2.5s: 用户点击发送按钮
    → Web端: sendCurrentUtterance()
    → Web端: sendUtterance(audioData, ...) ✅ 直接发送utterance消息
    → 调度服务器: handle_utterance()
      → 直接创建job ✅ 不经过audio_buffer
      → 发送给节点端
  
  → 注意: audio_buffer中的数据仍然保留
    → 如果后续有超时或pause检测，可能会再次finalize
    → 这可能导致重复job（需要去重机制）
```

---

## 关键代码分析

### 1. Audio Buffer累积

```rust
// audio_buffer.rs:82-99
pub async fn add_chunk(&self, session_id: &str, utterance_index: u64, chunk: Vec<u8>) -> (bool, usize) {
    let key = format!("{}:{}", session_id, utterance_index);
    let mut buffers = self.buffers.write().await;
    let buffer = buffers.entry(key).or_insert_with(AudioBuffer::new);
    buffer.add_chunk(chunk); // ✅ 累积到buffer
    
    // 异常保护检查
    let should_finalize = buffer.total_size > MAX_AUDIO_SIZE_BYTES;
    (should_finalize, buffer.total_size)
}
```

**关键点**:
- 按`session_id:utterance_index`组织buffer
- 每个chunk都累积到同一个buffer
- 返回是否应该finalize（异常保护）

### 2. Finalize执行

```rust
// actor.rs:363-412
async fn do_finalize(&self, utterance_index: u64, reason: &str) -> Result<bool, anyhow::Error> {
    // 获取累积的音频数据
    let audio_data_opt = self.state
        .audio_buffer
        .take_combined(&self.session_id, utterance_index)
        .await; // ✅ 合并所有chunk并移除buffer
    
    let audio_data = match audio_data_opt {
        Some(data) if !data.is_empty() => data,
        _ => return Ok(false),
    };
    
    // 创建job
    create_translation_jobs(...);
}
```

**关键点**:
- `take_combined()`会**合并所有chunk**并**移除buffer**
- 避免重复finalize（buffer已被移除）

### 3. Pause检测

```rust
// audio_buffer.rs:61-69
pub async fn record_chunk_and_check_pause(&self, session_id: &str, now_ms: i64, pause_ms: u64) -> bool {
    let mut map = self.last_chunk_at_ms.write().await;
    let exceeded = map
        .get(session_id)
        .map(|prev| now_ms.saturating_sub(*prev) > pause_ms as i64)
        .unwrap_or(false);
    map.insert(session_id.to_string(), now_ms); // ✅ 更新最后时间戳
    exceeded
}
```

**关键点**:
- 检查本次chunk与上次chunk的时间间隔
- 如果间隔 > pause_ms，返回true
- 更新最后时间戳

### 4. 超时机制

```rust
// actor.rs:254-256
else if self.pause_ms > 0 {
    // 启动/重置超时计时器
    self.reset_timers().await?;
}
```

**关键点**:
- 每次收到audio_chunk后，重置超时计时器
- 如果pause_ms时间内没有收到新的chunk，超时触发finalize

---

## 回答您的问题

### 问题1: 调度服务器如何拼装utterance？

**答案**: 通过`take_combined()`方法合并所有累积的audio_chunk

```rust
// 合并所有chunk
let audio_data = audio_buffer.take_combined(session_id, utterance_index);
// take_combined内部：
// 1. 获取所有chunk: buffer.chunks
// 2. 合并: combined.extend_from_slice(chunk)
// 3. 移除buffer: buffers.remove(&key)
```

### 问题2: 所有的audio_chunk都会在调度服务器保存2秒等待手动send吗？

**答案**: ❌ **不是**

- 调度服务器**不会等待手动send**
- 调度服务器有**自动finalize机制**：
  - 如果pause_ms（默认2000ms）时间内没有收到新的audio_chunk，**自动finalize**
  - 如果收到`is_final=true`，**立即finalize**
  - 如果检测到pause_exceeded，**先finalize上一个，然后开始新的**

### 问题3: 如果等不到手动send，就会将2秒之前的音频内容以audio_chunk的形式发送给节点端？

**答案**: ❌ **不是**

- 不是"2秒之前的音频内容"
- 而是：**所有累积的audio_chunk**（从当前utterance开始到现在的所有chunk）
- 不是"以audio_chunk的形式发送"
- 而是：**合并所有chunk后，创建job，以utterance的形式发送给节点端**

---

## 正确理解

### Web端机制

1. **audio_chunk**: 每100ms自动发送，累积到调度服务器的audio_buffer
2. **utterance**: 手动发送，直接创建job，**不经过audio_buffer**

### 调度服务器机制

1. **audio_buffer累积**: 所有audio_chunk都累积到同一个utterance_index的buffer
2. **自动finalize触发条件**:
   - `is_final=true` → 立即finalize
   - pause_exceeded → 先finalize上一个，然后开始新的
   - 超时（pause_ms时间内没有新chunk） → 自动finalize
   - 异常保护（超过500KB） → 自动finalize
3. **finalize执行**: 合并所有chunk，创建job，发送给节点端
4. **utterance消息**: 直接创建job，不经过audio_buffer

---

## 潜在问题

### 问题：如果同时使用audio_chunk和utterance会怎样？

**场景**:
1. Web端通过audio_chunk发送部分数据（累积到audio_buffer）
2. Web端通过utterance发送剩余数据（直接创建job）
3. 调度服务器可能创建两个job

**结果**:
- audio_chunk → audio_buffer → finalize → job1
- utterance → 直接创建job → job2
- **可能创建两个job，导致重复处理**

**解决方案**:
- 确保Web端逻辑正确：如果使用audio_chunk，就不要使用utterance
- 或者：统一使用一种方式

---

## 总结

### 您的理解需要修正的地方

1. ❌ "保存2秒等待手动send" → ✅ "自动finalize，不等待手动send"
2. ❌ "2秒之前的音频内容" → ✅ "所有累积的audio_chunk"
3. ❌ "以audio_chunk的形式发送" → ✅ "合并后以utterance的形式发送"

### 正确的机制

1. **audio_chunk**: 累积到audio_buffer，等待自动finalize
2. **自动finalize**: 基于pause检测、超时、is_final等条件
3. **手动send（utterance）**: 直接创建job，不经过audio_buffer
4. **finalize执行**: 合并所有chunk，创建job，发送给节点端

---

## 相关文件

- `central_server/scheduler/src/managers/audio_buffer.rs` - 音频缓冲区管理
- `central_server/scheduler/src/websocket/session_actor/actor.rs` - Session Actor处理逻辑
- `central_server/scheduler/src/websocket/session_message_handler/utterance.rs` - Utterance消息处理



---

## SCHEDULER_TIMEOUT_ANALYSIS.md

# 调度服务器超时错误分析

**日期**: 2025-12-24  
**问题**: 调度服务器出现ERROR，任务超时  
**相关Job**: `job-F2803265`, `job-8E68394C`, `job-B6BD3FB8`, `job-05980598`

---

## 错误现象

### 1. 连接重置错误 (ECONNRESET)

**Job**: `job-F2803265`
```
"error":{"code":"PROCESSING_ERROR","message":"read ECONNRESET"}
"processing_time_ms":4313
```

**分析**：
- 节点端在处理Opus请求时连接被重置
- 这很可能是因为`faster_whisper_vad`服务在处理Opus解码时崩溃
- 与之前发现的Opus解码崩溃问题一致

### 2. 404错误

**Jobs**: `job-8E68394C`, `job-B6BD3FB8`, `job-05980598`
```
"error":{"code":"PROCESSING_ERROR","message":"Request failed with status code 404"}
```

**分析**：
- 节点端无法找到对应的服务端点
- 可能原因：
  1. `faster_whisper_vad`服务已崩溃，无法响应请求
  2. 服务端点路径不正确
  3. 服务未正确启动

### 3. 无可用ASR服务

```
"error":{"code":"PROCESSING_ERROR","message":"No available ASR service"}
```

**分析**：
- 节点端检测到没有可用的ASR服务
- 这可能是因为`faster_whisper_vad`服务崩溃后，节点端将其标记为不可用

### 4. Job Pending超时

```
"Job pending 超时，标记失败"
"pending_timeout_seconds":10
```

**分析**：
- 任务在10秒内没有被成功派发到节点
- 可能原因：
  1. 节点端服务不可用
  2. 节点端资源不足
  3. 节点端服务崩溃

### 5. Result超时

```
"Result timeout, skipping utterance_index"
```

**分析**：
- 结果队列中的结果超时
- 可能原因：
  1. 节点端处理时间过长
  2. 节点端服务崩溃，无法返回结果

---

## 根本原因

**最可能的原因**：`faster_whisper_vad`服务在处理Opus请求时崩溃

**证据**：
1. `job-F2803265`返回`ECONNRESET`，说明连接在处理过程中被重置
2. 后续任务返回404，说明服务已不可用
3. 节点端报告"No available ASR service"
4. 与之前发现的Opus解码崩溃问题一致

---

## 超时配置

从`config.toml`：
- `job_timeout_seconds = 30` - 任务派发后30秒超时
- `pending_timeout_seconds = 10` - 任务pending状态10秒超时

---

## 解决方案

### 1. 立即修复

**已实施**：
- ✅ 增强Opus解码的错误处理
- ✅ 添加数据验证
- ✅ 添加详细日志

**待验证**：
- ⚠️ 重启节点端服务，验证修复是否有效

### 2. 长期改进

1. **进程隔离**：将Opus解码放在独立子进程中，避免崩溃影响主服务
2. **健康检查**：增强节点端对`faster_whisper_vad`服务的健康检查