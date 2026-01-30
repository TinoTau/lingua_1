# 调度服务器 Finalize 处理逻辑

**日期**: 2026-01-24  
**代码位置**: `central_server/scheduler/src/websocket/session_actor/actor/actor_finalize.rs`

---

## 一、处理流程概览

### 1.1 完整流程

```
收到 finalize 触发
  ↓
try_finalize() - 去重检查
  ↓
应用 Hangover 延迟
  ↓
do_finalize() - 执行 finalize
  ↓
获取音频数据
  ↓
设置 finalize 标识（is_manual_cut, is_timeout_triggered, is_max_duration_triggered）
  ↓
Session Affinity 处理
  ↓
创建翻译任务（create_translation_jobs）
  ↓
记录 Session Affinity（MaxDuration）
  ↓
派发 Job 到节点
  ↓
更新指标
```

---

## 二、try_finalize - 去重检查和 Hangover 延迟

### 2.1 去重检查

**代码位置**: `actor_finalize.rs:11-29`

```rust
pub(crate) async fn try_finalize(
    &mut self,
    utterance_index: u64,
    reason: &str,
) -> Result<bool, anyhow::Error> {
    // 检查是否可以 finalize
    if !self.internal_state.can_finalize(utterance_index) {
        debug!(
            session_id = %self.session_id,
            requested_index = utterance_index,
            current_index = self.internal_state.current_utterance_index,
            state = ?self.internal_state.state,
            reason = reason,
            "Skipping finalize: already finalized or in progress"
        );
        // 记录被抑制的重复 finalize
        crate::metrics::on_duplicate_finalize_suppressed();
        return Ok(false);
    }

    // 进入 finalizing 状态
    self.internal_state.enter_finalizing(utterance_index);
    // ...
}
```

**功能**:
- ✅ 防止重复 finalize（检查 `can_finalize`）
- ✅ 记录被抑制的重复 finalize（用于指标统计）
- ✅ 进入 finalizing 状态（防止并发 finalize）

### 2.2 Hangover 延迟

**代码位置**: `actor_finalize.rs:46-64`

```rust
// 判断 finalize 类型并应用 Hangover 延迟
let finalize_type = FinalizeType::from_reason(reason);
let hangover_ms = match finalize_type {
    FinalizeType::Manual => self.edge_config.hangover_manual_ms,
    FinalizeType::Auto => self.edge_config.hangover_auto_ms,
    FinalizeType::Exception => 0, // 异常情况不延迟
};

if hangover_ms > 0 {
    debug!(
        session_id = %self.session_id,
        utterance_index = utterance_index,
        reason = reason,
        finalize_type = ?finalize_type,
        hangover_ms = hangover_ms,
        "Applying hangover delay before finalize"
    );
    sleep(Duration::from_millis(hangover_ms)).await;
}
```

**功能**:
- ✅ 等待可能的后续音频 chunk（Hangover 机制）
- ✅ 不同 finalize 类型使用不同的延迟时间
- ✅ 异常情况（MaxLength）不延迟

**延迟时间**:
- `hangover_manual_ms`: 默认 200ms（IsFinal 使用）
- `hangover_auto_ms`: 默认 150ms（Timeout/MaxDuration 使用）
- `Exception`: 0ms（MaxLength 不延迟）

---

## 三、do_finalize - 执行 Finalize

### 3.1 获取音频数据

**代码位置**: `actor_finalize.rs:111-129`

```rust
// 与备份一致：take 一次，传入 create_translation_jobs，随 Job 存储
let audio_data = match self
    .state
    .audio_buffer
    .take_combined(&self.session_id, utterance_index)
    .await
{
    Some(data) if !data.is_empty() => data,
    _ => {
        warn!(
            session_id = %self.session_id,
            utterance_index = utterance_index,
            reason = reason,
            "Audio buffer empty, skipping finalize"
        );
        crate::metrics::on_empty_finalize();
        return Ok(false);
    }
};
```

**功能**:
- ✅ 从音频缓冲区获取所有音频数据（`take_combined`）
- ✅ 如果缓冲区为空，跳过 finalize（不创建 job）
- ✅ 记录空 finalize 指标（用于统计）

### 3.2 设置 Finalize 标识

**代码位置**: `actor_finalize.rs:148-153`

```rust
// 根据 finalize 原因设置标识
let is_manual_cut = reason == "IsFinal";
// ✅ 修复：MaxDuration 使用独立的标签，不与 timeout 混用
let is_timeout_triggered = reason == "Timeout";
// MaxDuration：用户持续说话超过最大时长，产生多 job；节点端按切片处理
let is_max_duration_triggered = reason == "MaxDuration";
```

**标识说明**:
- `is_manual_cut`: 用户手动截断
- `is_timeout_triggered`: 超时触发（长时间无新 chunk）
- `is_max_duration_triggered`: 超长语音自动截断（独立标签，不与 timeout 混用）

**关键修复**:
- ✅ MaxDuration 使用独立的标签（`is_max_duration_triggered`），不与 timeout 混用
- ✅ 这些标识会传递给节点端，用于不同的处理逻辑

---

## 四、Session Affinity 处理

### 4.1 手动/Timeout Finalize - 清除映射

**代码位置**: `actor_finalize.rs:156-195`

```rust
// ============================================================
// Session Affinity：手动/timeout finalize时立即清除timeout_node_id映射
// 必须在jobs创建之前清除，确保当前job不会使用旧的timeout_node_id
// ============================================================
if is_manual_cut || is_timeout_triggered {
    if let Some(ref rt) = self.state.phase2 {
        let session_key = format!("scheduler:session:{}", self.session_id);
        
        // 使用Lua脚本原子性地清除timeout_node_id
        let script = r#"
redis.call('HDEL', KEYS[1], 'timeout_node_id')
return 1
"#;
        let mut cmd = redis::cmd("EVAL");
        cmd.arg(script).arg(1).arg(&session_key);
        
        match rt.redis_query::<i64>(cmd).await {
            Ok(_) => {
                info!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    reason = reason,
                    is_manual_cut = is_manual_cut,
                    is_timeout_triggered = is_timeout_triggered,
                    "Session affinity: Cleared timeout_node_id mapping (manual/timeout finalize) - cleared before job creation, subsequent jobs can use random assignment"
                );
            }
            Err(e) => {
                warn!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    reason = reason,
                    is_manual_cut = is_manual_cut,
                    is_timeout_triggered = is_timeout_triggered,
                    error = %e,
                    "Session affinity: Failed to clear timeout_node_id mapping (will retry after job creation)"
                );
            }
        }
    }
}
```

**功能**:
- ✅ 手动/timeout finalize 时，清除 `timeout_node_id` 映射
- ✅ 必须在 jobs 创建之前清除，确保当前 job 不会使用旧的 `timeout_node_id`
- ✅ 使用 Lua 脚本原子性操作，防止竞态条件

**目的**:
- 手动/timeout finalize 表示句子结束，后续 job 可以使用随机分配
- 清除映射后，后续 job 不会路由到之前的节点

### 4.2 MaxDuration Finalize - 记录映射

**代码位置**: `actor_finalize.rs:269-323`

```rust
// ============================================================
// Session Affinity：MaxDuration finalize 时记录 sessionId->nodeId 映射
// 连续长语音产生多 job，需路由到同一节点
// ============================================================
if is_max_duration_triggered {
    // 获取第一个job的node_id（如果有）
    if let Some(first_job) = jobs.first() {
        if let Some(ref node_id) = first_job.assigned_node_id {
            // 记录sessionId->nodeId映射到Redis
            if let Some(ref rt) = self.state.phase2 {
                let session_key = format!("scheduler:session:{}", self.session_id);
                let ttl_seconds = 5 * 60; // 5分钟TTL（优化：符合业务逻辑，避免长期缓存）
                
                // ✅ 修复：MaxDuration 使用独立的 Redis key，不与 timeout 混用
                // 使用Lua脚本原子性地设置max_duration_node_id
                let script = r#"
redis.call('HSET', KEYS[1], 'max_duration_node_id', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"#;
                let mut cmd = redis::cmd("EVAL");
                cmd.arg(script)
                    .arg(1)
                    .arg(&session_key)
                    .arg(node_id)
                    .arg(ttl_seconds);
                
                match rt.redis_query::<i64>(cmd).await {
                    Ok(_) => {
                        info!(
                            session_id = %self.session_id,
                            utterance_index = utterance_index,
                            reason = reason,
                            node_id = %node_id,
                            ttl_seconds = ttl_seconds,
                            job_count = jobs.len(),
                            first_job_id = ?jobs.first().map(|j| &j.job_id),
                            "Session affinity: Recorded MaxDuration finalize session mapping - subsequent jobs will route to same node"
                        );
                    }
                    Err(e) => {
                        warn!(
                            session_id = %self.session_id,
                            utterance_index = utterance_index,
                            reason = reason,
                            node_id = %node_id,
                            ttl_seconds = ttl_seconds,
                            error = %e,
                            "Session affinity: Failed to record MaxDuration finalize session mapping"
                        );
                    }
                }
            }
        }
    }
}
```

**功能**:
- ✅ MaxDuration finalize 时，记录 `max_duration_node_id` 映射
- ✅ 使用独立的 Redis key（`max_duration_node_id`），不与 timeout 混用
- ✅ 设置 5 分钟 TTL，避免长期缓存
- ✅ 后续 MaxDuration job 会路由到同一个节点

**目的**:
- 连续长语音产生多个 MaxDuration job，需要路由到同一节点
- 节点端会按能量切片处理前 5+ 秒，缓存剩余部分等待下一个 job
- 确保所有 MaxDuration job 都在同一个节点处理，便于合并

### 4.3 兜底清除逻辑

**代码位置**: `actor_finalize.rs:323-361`

```rust
} else if is_manual_cut || is_timeout_triggered {
    // 手动/timeout finalize：如果之前清除失败，再次尝试清除（兜底）
    // 注意：主要清除已在jobs创建之前完成，这里是兜底逻辑
    // ...（类似上面的清除逻辑）
}
```

**功能**:
- ✅ 如果主要清除逻辑失败，在 jobs 创建后再次尝试清除（兜底）
- ✅ 确保 `timeout_node_id` 映射被清除

---

## 五、Job 创建和派发

### 5.1 创建翻译任务

**代码位置**: `actor_finalize.rs:219-266`

```rust
let jobs = match create_translation_jobs(
    &self.state,
    &self.session_id,
    utterance_index,
    session.src_lang.clone(),
    session.tgt_lang.clone(),
    session.dialect.clone(),
    session.default_features.clone(),
    default_pipeline,
    session.tenant_id.clone(),
    audio_data,
    audio_format,
    16000,
    session.paired_node_id.clone(),
    session.mode.clone(),
    session.lang_a.clone(),
    session.lang_b.clone(),
    session.auto_langs.clone(),
    Some(true), // enable_streaming_asr
    Some(1000u64), // partial_update_interval_ms
    session.trace_id.clone(),
    self.internal_state.first_chunk_client_timestamp_ms,
    Some(padding_ms),
    is_manual_cut,
    is_timeout_triggered,
    is_max_duration_triggered,
)
.await {
    Ok(jobs) => {
        info!(
            session_id = %self.session_id,
            utterance_index = utterance_index,
            job_count = jobs.len(),
            "【Finalize】翻译任务创建成功，共 {} 个任务",
            jobs.len()
        );
        jobs
    },
    Err(e) => {
        tracing::error!(
            session_id = %self.session_id,
            utterance_index = utterance_index,
            error = %e,
            "翻译任务创建失败"
        );
        return Err(e);
    }
};
```

**功能**:
- ✅ 创建翻译任务（`create_translation_jobs`）
- ✅ 传递 finalize 标识（`is_manual_cut`, `is_timeout_triggered`, `is_max_duration_triggered`）
- ✅ 使用默认 pipeline 配置（finalize 时没有 pipeline 信息）

**关键参数**:
- `enable_streaming_asr`: `true`（启用流式 ASR）
- `partial_update_interval_ms`: `1000`（部分更新间隔）
- `padding_ms`: 根据 finalize 类型设置（Manual 200ms, Auto 150ms）

### 5.2 派发 Job 到节点

**代码位置**: `actor_finalize.rs:363-472`

```rust
for job in jobs {
    // 优化: 使用本地内存字段作为短路条件（性能优化）
    if job.dispatched_to_node {
        continue;  // 已派发，跳过（本地判断）
    }

    // 关键：必须以 Redis Lua 原子占用作为唯一闸门
    let dispatch_result = self.state.dispatcher.mark_job_dispatched(&job.job_id, Some(&job.request_id), Some(job.dispatch_attempt_id)).await;
    
    if !dispatch_result {
        debug!(
            session_id = %self.session_id,
            job_id = %job.job_id,
            node_id = %node_id,
            utterance_index = utterance_index,
            "【Finalize】原子占用失败，跳过派发"
        );
        continue;
    }
    
    // 原子占用成功，可以安全派发
    if let Some(job_assign_msg) = create_job_assign_message(&self.state, &job, None, None, None).await {
        // 发送 JobAssign 到节点
        if crate::redis_runtime::send_node_message_routed(&self.state, node_id, job_assign_msg).await {
            // 发送成功
            send_ui_event(/* ... */).await;
        } else {
            // 发送失败，释放资源
            // ...
        }
    }
}
```

**功能**:
- ✅ 使用原子占用机制（`mark_job_dispatched`）防止重复派发
- ✅ 发送 `JobAssign` 消息到节点
- ✅ 发送 UI 事件通知客户端
- ✅ 处理发送失败的情况（释放资源）

**关键机制**:
- **原子占用**: 使用 Redis Lua 脚本原子性占用 job，防止跨实例重复派发
- **本地短路**: 使用本地字段 `dispatched_to_node` 作为短路条件（性能优化）

---

## 六、状态更新和指标统计

### 6.1 状态更新

**代码位置**: `actor_finalize.rs:69-87`

```rust
if finalized {
    // 完成 finalize，递增 index
    self.internal_state.complete_finalize();
    // 重置状态
    self.internal_state.pending_short_audio = false;
    self.internal_state.accumulated_short_audio_duration_ms = 0;
    self.internal_state.accumulated_audio_duration_ms = 0;
    self.state
        .session_manager
        .update_session(
            &self.session_id,
            crate::core::session::SessionUpdate::IncrementUtteranceIndex,
        )
        .await;
} else {
    // finalize 失败，恢复状态
    self.internal_state.state = super::super::state::SessionActorState::Idle;
    self.internal_state.finalize_inflight = None;
}
```

**功能**:
- ✅ 完成 finalize 后，递增 `utterance_index`
- ✅ 重置累积状态（`accumulated_audio_duration_ms` 等）
- ✅ 如果 finalize 失败，恢复状态

### 6.2 指标统计

**代码位置**: `actor_finalize.rs:474-484`

```rust
// 更新指标
match reason {
    "IsFinal" => crate::metrics::on_web_task_finalized_by_send(),
    "Timeout" => crate::metrics::on_web_task_finalized_by_timeout(),
    "MaxDuration" => {
        // ✅ 修复：MaxDuration 使用独立的 metrics，但如果没有则使用 timeout（向后兼容）
        crate::metrics::on_web_task_finalized_by_timeout()
    },
    _ => {}
}
```

**功能**:
- ✅ 根据 finalize 原因更新不同的指标
- ✅ MaxDuration 暂时使用 timeout 的指标（向后兼容）

---

## 七、关键设计决策

### 7.1 MaxDuration 独立标签

**决策**: MaxDuration 使用独立的标签（`is_max_duration_triggered`），不与 timeout 混用。

**原因**:
- MaxDuration 和 Timeout 有不同的业务逻辑
- 节点端需要区分这两种 finalize 类型
- 避免混用导致的处理错误

### 7.2 Session Affinity 分离

**决策**: MaxDuration 使用独立的 Redis key（`max_duration_node_id`），Timeout 使用 `timeout_node_id`。

**原因**:
- MaxDuration 和 Timeout 有不同的路由需求
- MaxDuration 需要连续 job 路由到同一节点
- Timeout 在 finalize 后清除映射，允许随机分配

### 7.3 原子占用机制

**决策**: 使用 Redis Lua 脚本原子性占用 job，防止跨实例重复派发。

**原因**:
- 多实例环境下，需要防止重复派发
- 本地字段只能作为短路条件，不能保证正确性
- Redis Lua 脚本提供原子性保证

---

## 八、相关文档

- [Finalize 类型和触发条件](./scheduler_finalize_types.md)
- [Timeout Finalize](./timeout_finalize.md)
- [MaxDuration Finalize](./maxduration_finalize.md)
- [节点端 Finalize 处理流程](./node_finalize_processing.md)
