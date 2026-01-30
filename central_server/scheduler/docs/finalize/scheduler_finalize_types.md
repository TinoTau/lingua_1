# 调度服务器 Finalize 类型和触发条件

**日期**: 2026-01-24  
**代码位置**: `central_server/scheduler/src/websocket/session_actor/actor/`

---

## 一、Finalize 类型枚举

### 1.1 FinalizeType 定义

**代码位置**: `actor_types.rs:1-24`

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FinalizeType {
    /// 手动截断（is_final=true）
    Manual,
    /// 自动 finalize（timeout/MaxDuration）
    Auto,
    /// 异常保护（MaxLength）
    Exception,
}

impl FinalizeType {
    pub(crate) fn from_reason(reason: &str) -> Self {
        match reason {
            "IsFinal" => FinalizeType::Manual,
            "Timeout" => FinalizeType::Auto,
            "MaxDuration" => FinalizeType::Auto,
            "MaxLength" => FinalizeType::Exception,
            _ => FinalizeType::Auto,
        }
    }
}
```

### 1.2 Finalize 原因（Reason）

| Reason | FinalizeType | 说明 |
|--------|--------------|------|
| `"IsFinal"` | `Manual` | 用户手动发送（`is_final=true`） |
| `"Timeout"` | `Auto` | 长时间无新 chunk（超过 `pause_ms`，通过计时器触发） |
| `"MaxDuration"` | `Auto` | 音频时长超过最大限制（默认 10 秒），超长语音自动截断 |
| `"MaxLength"` | `Exception` | 音频缓冲区超过异常保护限制（500KB），正常情况下不应触发 |

---

## 二、触发条件和机制

### 2.1 IsFinal（手动截断）

**触发条件**:
- 客户端发送音频 chunk 时，`is_final=true`

**代码位置**: `actor_event_handling.rs:96-109`

```rust
// 检查 is_final
if is_final {
    should_finalize = true;
    finalize_reason = "IsFinal";
}
```

**特点**:
- ✅ 无条件触发（只要 `is_final=true` 就触发）
- ✅ 立即触发（在收到 chunk 时立即检查）
- ✅ 用户主动控制

**典型场景**:
- 用户说完一句话后，手动点击发送按钮
- 客户端检测到句子结束，发送 `is_final=true`

---

### 2.2 Timeout（超时检测）

**触发条件**:
- 长时间没有新的音频 chunk（超过 `pause_ms`，默认 3 秒）
- 通过计时器机制触发

**代码位置**: 
- 计时器重置: `actor_timers.rs:13-52`
- 超时处理: `actor_event_handling.rs:157-202`

**触发机制**:
1. 每次收到音频 chunk 后，调用 `reset_timers()` 重置计时器
2. 计时器等待 `pause_ms` 毫秒
3. 如果期间没有新 chunk，触发 `TimeoutFired` 事件
4. `handle_timeout_fired()` 调用 `try_finalize(utterance_index, "Timeout")`

**关键代码**:
```rust
// 重置计时器
pub(crate) async fn reset_timers(&mut self) -> Result<(), anyhow::Error> {
    // 取消旧计时器
    self.cancel_timers();
    
    // 启动新计时器
    let handle = tokio::spawn(async move {
        sleep(Duration::from_millis(pause_ms)).await;
        
        // 检查时间戳是否仍然匹配（防止新 chunk 到达后触发旧超时）
        if let Some(last_ts) = state.audio_buffer.get_last_chunk_at_ms(&session_id).await {
            if last_ts != timestamp_ms {
                return; // 时间戳已更新，忽略本次超时
            }
        }
        
        // 发送超时事件
        let _ = event_tx.send(SessionEvent::TimeoutFired {
            generation,
            timestamp_ms,
        });
    });
}

// 处理超时事件
pub(crate) async fn handle_timeout_fired(&mut self, generation: u64, timestamp_ms: i64) -> Result<(), anyhow::Error> {
    // 检查 generation 和时间戳是否有效
    // ...
    
    let utterance_index = self.internal_state.current_utterance_index;
    self.try_finalize(utterance_index, "Timeout").await?;
    Ok(())
}
```

**特点**:
- ✅ 被动触发（通过计时器，不需要新 chunk）
- ✅ 防止重复触发（通过 generation 和时间戳检查）
- ✅ 如果新 chunk 到达，计时器会被重置，不会触发 timeout

**典型场景**:
- 用户停止说话，长时间没有新 chunk（如播放 TTS 时闭麦）
- 超过 3 秒后，计时器触发 timeout finalize

**配置**:
- `pause_ms`: 默认 3000ms（3 秒），可通过配置调整

---

### 2.3 MaxDuration（时长限制）

**触发条件**:
- 累积音频时长超过 `max_duration_ms`（默认 10 秒）

**代码位置**: `actor_event_handling.rs:83-94`

```rust
// 检查最大时长限制
if self.max_duration_ms > 0 && self.internal_state.accumulated_audio_duration_ms >= self.max_duration_ms {
    tracing::warn!(
        session_id = %self.session_id,
        utterance_index = utterance_index,
        accumulated_duration_ms = self.internal_state.accumulated_audio_duration_ms,
        max_duration_ms = self.max_duration_ms,
        "Audio duration exceeded max limit, auto-finalizing"
    );
    should_finalize = true;
    finalize_reason = "MaxDuration";
}
```

**特点**:
- ✅ 主动触发（在收到 chunk 时检查累积时长）
- ✅ 保护机制（防止超长语音导致缓冲区过大）
- ✅ 节点端会重新拼接（正常业务逻辑）

**典型场景**:
- 用户持续说话超过 10 秒
- 调度服务器自动截断，创建 job
- 节点端会按能量切片处理前 5+ 秒，缓存剩余部分等待下一个 job

**配置**:
- `max_duration_ms`: 默认 10000ms（10 秒），可通过配置调整

---

### 2.4 MaxLength（异常保护）

**触发条件**:
- 音频缓冲区超过异常保护限制（500KB）

**代码位置**: `actor_event_handling.rs:111-122`

```rust
// 检查异常保护限制
if should_finalize_due_to_length {
    tracing::warn!(
        session_id = %self.session_id,
        utterance_index = utterance_index,
        current_size_bytes = current_size_bytes,
        pause_ms = self.pause_ms,
        "Audio buffer exceeded异常保护限制 (500KB), auto-finalizing. This should not happen normally - check VAD and timeout mechanism"
    );
    should_finalize = true;
    finalize_reason = "MaxLength";
}
```

**特点**:
- ✅ 异常保护机制（正常情况下不应触发）
- ✅ 防止缓冲区过大导致内存问题
- ✅ 如果触发，说明 VAD 或 timeout 机制可能有问题

**典型场景**:
- 正常情况下不应触发
- 如果触发，需要检查 VAD 检测和 timeout 机制

---

## 三、触发优先级和检查顺序

### 3.1 检查顺序

**代码位置**: `actor_event_handling.rs:79-151`

```rust
// 检查顺序：
1. MaxDuration → "MaxDuration"      // ✅ 最先检查（累积时长）
2. IsFinal → "IsFinal"              // ✅ 其次检查（用户手动）
3. MaxLength → "MaxLength"          // ✅ 最后检查（异常保护）

// Timeout 不在这个检查列表中，它是通过事件触发的
```

**优先级说明**:
- **MaxDuration** 优先级最高：如果累积时长超过限制，立即触发
- **IsFinal** 优先级中等：用户手动触发
- **MaxLength** 优先级最低：异常保护，正常情况下不应触发
- **Timeout** 独立触发：通过 `TimeoutFired` 事件触发，不在 `handle_audio_chunk` 的检查列表中

### 3.2 触发时机对比

| Finalize 类型 | 触发时机 | 触发机制 | 是否需要新 chunk |
|--------------|---------|---------|-----------------|
| **IsFinal** | 收到 chunk 时立即检查 | 主动检查 | ✅ 是 |
| **Timeout** | 长时间无新 chunk 时触发 | 被动等待（计时器） | ❌ 否 |
| **MaxDuration** | 收到 chunk 时立即检查 | 主动检查 | ✅ 是 |
| **MaxLength** | 收到 chunk 时立即检查 | 主动检查 | ✅ 是 |

---

## 四、Finalize 类型总结

### 4.1 类型分类

| FinalizeType | Reason | 触发方式 | 是否创建 Job | 用途 |
|--------------|--------|---------|------------|------|
| **Manual** | `"IsFinal"` | 用户手动 | ✅ 是 | 用户主动结束句子 |
| **Auto** | `"Timeout"` | 计时器触发 | ✅ 是（如果有音频） | 检测用户停止说话 |
| **Auto** | `"MaxDuration"` | 累积时长检查 | ✅ 是 | 超长语音自动截断 |
| **Exception** | `"MaxLength"` | 缓冲区大小检查 | ✅ 是 | 异常保护 |

### 4.2 关键差异

**IsFinal vs Timeout**:
- **IsFinal**: 需要新 chunk，用户主动触发
- **Timeout**: 不需要新 chunk，被动等待触发

**Timeout vs MaxDuration**:
- **Timeout**: 长时间无新 chunk（用户停止说话）
- **MaxDuration**: 累积时长超过限制（用户持续说话）

**MaxDuration vs MaxLength**:
- **MaxDuration**: 正常业务逻辑（超长语音保护）
- **MaxLength**: 异常保护（正常情况下不应触发）

---

## 五、相关配置

### 5.1 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `pause_ms` | 3000ms | Timeout finalize 的触发阈值 |
| `max_duration_ms` | 10000ms | MaxDuration finalize 的触发阈值 |
| `hangover_manual_ms` | 200ms | IsFinal 的 Hangover 延迟 |
| `hangover_auto_ms` | 150ms | Timeout/MaxDuration 的 Hangover 延迟 |

### 5.2 配置位置

- `config_defaults.rs`: 默认配置值
- `config_types.rs`: 配置类型定义
- `config.toml`: 运行时配置

---

## 六、相关文档

- [Finalize 处理逻辑](./scheduler_finalize_processing.md)
- [Timeout Finalize](./timeout_finalize.md)
- [MaxDuration Finalize](./maxduration_finalize.md)
- [节点端 Finalize 处理流程](./node_finalize_processing.md)
