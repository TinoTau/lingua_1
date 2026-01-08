# 任务链路日志记录文档

## 文档信息
- **版本**: v1.0
- **日期**: 2026-01-XX
- **目的**: 记录 web 端到调度服务器到节点端的完整任务链路日志

---

## 一、任务链路概览

```
Web 端
  ↓ SessionInit
调度服务器（创建会话）
  ↓ SessionInitAck
Web 端
  ↓ Utterance
调度服务器（创建 Job、选择节点、派发任务）
  ↓ JobAssign
节点端
  ↓ JobAck + JobStarted + JobResult
调度服务器（处理结果、创建 TranslationResult）
  ↓ TranslationResult
Web 端
```

---

## 二、日志记录点

### 2.1 Web 端 → 调度服务器：SessionInit

**文件**: `src/websocket/session_message_handler/core.rs`

**日志**:
```rust
info!(
    trace_id = %session.trace_id,
    session_id = %session.session_id,
    src_lang = %session.src_lang,
    tgt_lang = %session.tgt_lang,
    mode = ?session.mode,
    "Session created"
);
```

**日志内容**:
- `trace_id`: 追踪 ID
- `session_id`: 会话 ID
- `src_lang`: 源语言
- `tgt_lang`: 目标语言
- `mode`: 会话模式

---

### 2.2 Web 端 → 调度服务器：Utterance

**文件**: `src/websocket/session_message_handler/utterance.rs`

**日志**:
```rust
info!(
    trace_id = %trace_id,
    session_id = %sess_id,
    utterance_index = utterance_index,
    src_lang = %src_lang,
    tgt_lang = %tgt_lang,
    audio_size_bytes = audio_data.len(),
    "收到 Utterance 消息，开始创建翻译任务"
);
```

**日志内容**:
- `trace_id`: 追踪 ID
- `session_id`: 会话 ID
- `utterance_index`: 话语索引
- `src_lang`: 源语言
- `tgt_lang`: 目标语言
- `audio_size_bytes`: 音频大小（字节）

---

### 2.3 调度服务器：Job 创建

**文件**: `src/websocket/session_message_handler/utterance.rs`

**日志**:
```rust
info!(
    trace_id = %trace_id,
    job_id = %job.job_id,
    node_id = ?job.assigned_node_id,
    tgt_lang = %job.tgt_lang,
    audio_format = %job.audio_format,
    audio_size_bytes = job.audio_data.len(),
    "Job created"
);
```

**日志内容**:
- `trace_id`: 追踪 ID
- `job_id`: 任务 ID
- `node_id`: 分配的节点 ID（可选）
- `tgt_lang`: 目标语言
- `audio_format`: 音频格式
- `audio_size_bytes`: 音频大小（字节）

---

### 2.4 调度服务器：节点选择

**文件**: `src/core/dispatcher/job_creation/job_creation_node_selection.rs`

**日志**:

#### 2.4.1 节点选择开始
```rust
tracing::info!(
    trace_id = %trace_id,
    request_id = %request_id,
    session_id = %session_id,
    src_lang = %src_lang,
    tgt_lang = %tgt_lang,
    preferred_node_id = ?preferred_node_id,
    "开始节点选择"
);
```

#### 2.4.2 preferred_node_id 检查
```rust
// 节点不可用
tracing::info!(
    trace_id = %trace_id,
    request_id = %request_id,
    preferred_node_id = %node_id,
    fallback_reason = "node_unavailable",
    selected_node = ?o.node_id,
    "preferred_node_id 节点不可用，已回退到随机选择"
);

// 节点不在池中
tracing::info!(
    trace_id = %trace_id,
    request_id = %request_id,
    preferred_node_id = %node_id,
    fallback_reason = "node_not_in_pool",
    selected_node = ?o.node_id,
    "preferred_node_id 节点不在对应池中，已回退到随机选择"
);

// 节点缺少模型
tracing::info!(
    trace_id = %trace_id,
    request_id = %request_id,
    preferred_node_id = %node_id,
    fallback_reason = "node_missing_models",
    selected_node = ?o.node_id,
    "preferred_node_id 节点缺少所需模型，已回退到随机选择"
);

// preferred_node_id 通过检查
tracing::info!(
    trace_id = %trace_id,
    request_id = %request_id,
    preferred_node_id = %node_id,
    src_lang = %src_lang,
    tgt_lang = %tgt_lang,
    "preferred_node_id 节点通过所有检查，使用该节点"
);
```

#### 2.4.3 功能感知选择
```rust
tracing::debug!(
    trace_id = %trace_id,
    request_id = %request_id,
    routing_key = %routing_key,
    src_lang = %src_lang,
    tgt_lang = %tgt_lang,
    exclude_node_id = ?exclude_node_id,
    "使用功能感知选择（模块依赖展开）"
);
```

#### 2.4.4 节点选择结果
```rust
// 选择成功
tracing::info!(
    trace_id = %trace_id,
    request_id = %request_id,
    selected_node = %node_id,
    selector = %o.selector,
    src_lang = %src_lang,
    tgt_lang = %tgt_lang,
    "节点选择成功"
);

// Phase3 两级调度详情
if o.selector == "phase3" {
    tracing::info!(
        trace_id = %trace_id,
        request_id = %request_id,
        pool_count = dbg.pool_count,
        eligible_pools = ?dbg.eligible_pools,
        preferred_pool = dbg.preferred_pool,
        selected_pool = ?dbg.selected_pool,
        fallback_used = dbg.fallback_used,
        attempts = ?dbg.attempts,
        "Phase3 两级调度详情"
    );
}

// 选择失败
tracing::warn!(
    trace_id = %trace_id,
    request_id = %request_id,
    selector = %o.selector,
    reason = %o.breakdown.best_reason_label(),
    src_lang = %src_lang,
    tgt_lang = %tgt_lang,
    "节点选择失败：无可用节点"
);
```

---

### 2.5 调度服务器 → 节点端：Job 派发

**文件**: `src/websocket/session_message_handler/utterance.rs`

**日志**:

#### 2.5.1 派发成功
```rust
info!(
    trace_id = %trace_id,
    job_id = %job.job_id,
    node_id = %node_id,
    dispatch_latency_seconds = dispatch_latency,
    "任务派发成功"
);
```

**日志内容**:
- `trace_id`: 追踪 ID
- `job_id`: 任务 ID
- `node_id`: 节点 ID
- `dispatch_latency_seconds`: 派发延迟（秒）

#### 2.5.2 派发失败
```rust
warn!(
    trace_id = %trace_id,
    job_id = %job.job_id,
    node_id = %node_id,
    "Failed to send job to node"
);
```

---

### 2.6 节点端 → 调度服务器：JobResult

**文件**: `src/websocket/node_handler/message/job_result/job_result_processing.rs`

**日志**:

#### 2.6.1 收到 JobResult
```rust
info!(
    trace_id = %trace_id,
    job_id = %job_id,
    node_id = %node_id,
    session_id = %session_id,
    utterance_index = utterance_index,
    success = success,
    attempt_id = attempt_id,
    "收到节点返回的 JobResult"
);
```

#### 2.6.2 JobResult 重复检查
```rust
info!(
    trace_id = %trace_id,
    job_id = %job_id,
    session_id = %session_id,
    "JobResult 重复，已跳过处理"
);
```

---

### 2.7 调度服务器：TranslationResult 创建

**文件**: `src/websocket/node_handler/message/job_result/job_result_creation.rs`

**日志**:
```rust
info!(
    trace_id = %trace_id,
    job_id = %job_id,
    session_id = %session_id,
    utterance_index = utterance_index,
    text_asr = %text_asr,
    text_translated = %text_translated,
    tts_audio_len = tts_audio.len(),
    elapsed_ms = elapsed_ms,
    "TranslationResult created"
);
```

**日志内容**:
- `trace_id`: 追踪 ID
- `job_id`: 任务 ID
- `session_id`: 会话 ID
- `utterance_index`: 话语索引
- `text_asr`: ASR 文本
- `text_translated`: 翻译文本
- `tts_audio_len`: TTS 音频长度
- `elapsed_ms`: 处理耗时（毫秒）

---

### 2.8 调度服务器 → Web 端：TranslationResult 发送

**文件**: `src/websocket/node_handler/message/job_result/job_result_sending.rs`

**日志**:

#### 2.8.1 获取就绪结果
```rust
info!(
    trace_id = %trace_id,
    session_id = %session_id,
    ready_results_count = ready_results.len(),
    "Getting ready results from queue"
);
```

#### 2.8.2 发送结果到会话
```rust
info!(
    trace_id = %trace_id,
    session_id = %session_id,
    text_asr = %text_asr,
    text_translated = %text_translated,
    tts_audio_len = tts_audio.len(),
    "Sending translation result to session"
);
```

#### 2.8.3 发送成功
```rust
info!(
    trace_id = %trace_id,
    session_id = %session_id,
    "Successfully sent translation result to session"
);
```

#### 2.8.4 发送失败
```rust
warn!(
    trace_id = %trace_id,
    session_id = %session_id,
    "Failed to send result to session"
);
```

---

## 三、日志级别

- **`info!`**: 正常流程的关键步骤
- **`debug!`**: 详细的调试信息（节点选择详情）
- **`warn!`**: 警告信息（派发失败、选择失败等）
- **`error!`**: 错误信息（Redis 不可用等）

---

## 四、日志字段说明

### 4.1 通用字段

- `trace_id`: 追踪 ID（贯穿整个任务链路）
- `session_id`: 会话 ID
- `job_id`: 任务 ID
- `node_id`: 节点 ID
- `utterance_index`: 话语索引

### 4.2 节点选择字段

- `request_id`: 请求 ID
- `src_lang`: 源语言
- `tgt_lang`: 目标语言
- `preferred_node_id`: 首选节点 ID
- `selected_node`: 选中的节点 ID
- `selector`: 选择器类型（"phase3", "phase1" 等）
- `pool_count`: Pool 数量
- `eligible_pools`: 符合条件的 Pool 列表
- `preferred_pool`: 首选 Pool
- `selected_pool`: 选中的 Pool
- `fallback_used`: 是否使用了 fallback
- `attempts`: 尝试次数

### 4.3 性能字段

- `dispatch_latency_seconds`: 派发延迟（秒）
- `elapsed_ms`: 处理耗时（毫秒）
- `audio_size_bytes`: 音频大小（字节）

---

## 五、日志追踪示例

### 5.1 正常流程

```
[INFO] Session created: trace_id=xxx, session_id=yyy, src_lang=zh, tgt_lang=en
[INFO] 收到 Utterance 消息，开始创建翻译任务: trace_id=xxx, session_id=yyy, utterance_index=1
[INFO] 开始节点选择: trace_id=xxx, request_id=zzz, src_lang=zh, tgt_lang=en
[INFO] 节点选择成功: trace_id=xxx, selected_node=node-1, selector=phase3
[INFO] Phase3 两级调度详情: trace_id=xxx, pool_count=2, selected_pool=Some(1)
[INFO] Job created: trace_id=xxx, job_id=job-1, node_id=Some("node-1")
[INFO] 任务派发成功: trace_id=xxx, job_id=job-1, node_id=node-1, dispatch_latency_seconds=0.001
[INFO] 收到节点返回的 JobResult: trace_id=xxx, job_id=job-1, node_id=node-1, success=true
[INFO] TranslationResult created: trace_id=xxx, job_id=job-1, text_asr="你好", text_translated="hello"
[INFO] Sending translation result to session: trace_id=xxx, session_id=yyy
[INFO] Successfully sent translation result to session: trace_id=xxx, session_id=yyy
```

### 5.2 异常流程

```
[INFO] Session created: trace_id=xxx, session_id=yyy
[INFO] 收到 Utterance 消息，开始创建翻译任务: trace_id=xxx
[INFO] 开始节点选择: trace_id=xxx
[WARN] 节点选择失败：无可用节点: trace_id=xxx, reason="no_available_pool"
[WARN] Job has no available nodes: trace_id=xxx, job_id=job-1
```

---

## 六、日志配置建议

### 6.1 开发环境

```toml
RUST_LOG=debug
```

### 6.2 生产环境

```toml
RUST_LOG=info,scheduler::websocket=debug
```

---

**最后更新**: 2026-01-XX
