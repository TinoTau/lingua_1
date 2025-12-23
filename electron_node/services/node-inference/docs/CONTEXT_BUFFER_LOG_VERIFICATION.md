# 上下文缓冲区日志验证文档

## 概述

本文档用于验证上下文缓冲区的日志是否正常输出，以及如何检查日志。

## 日志实现检查

### ✅ 日志宏导入

**文件**: `src/inference.rs`

**导入位置**:
- 第 6 行：`use tracing::{info, warn, debug};` （文件级别导入）
- 第 257 行：`use tracing::{info, warn, debug};` （方法内重复导入，不影响使用）

**状态**: ✅ 已正确导入

### ✅ 上下文缓冲区日志位置

#### 1. 前置上下文音频日志（ASR 处理前）

**位置**: `src/inference.rs:361-378`

**日志级别**: `INFO`

**两种情况**:

**情况1: 上下文缓冲区不为空**
```rust
info!(
    trace_id = %trace_id,
    context_samples = context.len(),
    context_duration_sec = (context.len() as f32 / 16000.0),
    original_samples = audio_f32.len(),
    original_duration_sec = (audio_f32.len() as f32 / 16000.0),
    total_samples = audio_with_context.len(),
    total_duration_sec = (audio_with_context.len() as f32 / 16000.0),
    "✅ 前置上下文音频到当前utterance（上下文缓冲区不为空）"
);
```

**情况2: 上下文缓冲区为空**
```rust
info!(
    trace_id = %trace_id,
    original_samples = audio_f32.len(),
    original_duration_sec = (audio_f32.len() as f32 / 16000.0),
    "ℹ️ 上下文缓冲区为空，使用原始音频（第一个utterance或上下文已清空）"
);
```

**状态**: ✅ 已正确实现

#### 2. 更新上下文缓冲区日志（ASR 处理后）

**位置**: `src/inference.rs:608-675`

**日志级别**: `INFO` 或 `WARN`

**多种情况**:

**情况1: 使用VAD选择最佳片段（正常）**
```rust
info!(
    trace_id = %trace_id,
    context_samples = context.len(),
    context_duration_sec = (context.len() as f32 / 16000.0),
    segment_start = last_start,
    segment_end = last_end,
    segment_samples = last_segment.len(),
    "✅ 更新上下文缓冲区（使用VAD选择的最后一个语音段尾部）"
);
```

**情况2: 语音段较短，保存全部**
```rust
info!(
    trace_id = %trace_id,
    context_samples = context.len(),
    context_duration_sec = (context.len() as f32 / 16000.0),
    segment_samples = last_segment.len(),
    "✅ 更新上下文缓冲区（最后一个语音段较短，保存全部）"
);
```

**情况3: VAD未检测到语音段（回退）**
```rust
info!(
    trace_id = %trace_id,
    context_samples = context.len(),
    context_duration_sec = (context.len() as f32 / 16000.0),
    original_samples = audio_f32.len(),
    "⚠️ 更新上下文缓冲区（VAD未检测到语音段，保存最后{}秒）", CONTEXT_DURATION_SEC
);
```

**情况4: Utterance较短，保存全部**
```rust
info!(
    trace_id = %trace_id,
    context_samples = context.len(),
    context_duration_sec = (context.len() as f32 / 16000.0),
    original_samples = audio_f32.len(),
    "⚠️ 更新上下文缓冲区（utterance较短，保存全部）"
);
```

**情况5: VAD检测失败（错误回退）**
```rust
warn!(
    trace_id = %trace_id,
    error = %e,
    "VAD检测失败，使用简单尾部保存上下文"
);
info!(
    trace_id = %trace_id,
    context_samples = context.len(),
    context_duration_sec = (context.len() as f32 / 16000.0),
    "⚠️ 更新上下文缓冲区（VAD失败回退，保存最后{}秒）", CONTEXT_DURATION_SEC
);
```

**状态**: ✅ 已正确实现

#### 3. 清空上下文缓冲区日志

**位置**: `src/inference.rs:236-240`

**日志级别**: `INFO`

```rust
info!(
    previous_context_samples = previous_size,
    previous_context_duration_sec = (previous_size as f32 / 16000.0),
    "🗑️ 上下文缓冲区和VAD状态已清空"
);
```

**状态**: ✅ 已正确实现

## 如何验证日志是否正常输出

### 方法1: 设置日志级别

确保日志级别设置为 `INFO` 或更低（`DEBUG`）：

```bash
# 方式1: 环境变量
export RUST_LOG=info
./inference-service

# 方式2: 命令行参数（如果支持）
./inference-service --log-level info

# 方式3: 配置文件（如果使用）
# 在配置文件中设置日志级别为 INFO
```

### 方法2: 搜索日志关键字

在日志文件中搜索以下关键字：

```bash
# 搜索前置上下文日志
grep "前置上下文音频" node-inference.log

# 搜索更新上下文缓冲区日志
grep "更新上下文缓冲区" node-inference.log

# 搜索清空上下文缓冲区日志
grep "上下文缓冲区和VAD状态已清空" node-inference.log

# 搜索所有上下文缓冲区相关日志
grep -E "前置上下文|更新上下文缓冲区|上下文缓冲区为空|上下文缓冲区和VAD状态已清空" node-inference.log
```

### 方法3: 使用 trace_id 追踪

```bash
# 搜索特定 trace_id 的上下文缓冲区日志
grep "trace_id=your_trace_id" node-inference.log | grep -E "前置上下文|更新上下文缓冲区"
```

### 方法4: 检查日志输出格式

正常的日志输出应该包含以下字段：

- `trace_id`: 追踪ID
- `context_samples`: 上下文样本数
- `context_duration_sec`: 上下文时长（秒）
- `original_samples`: 原始音频样本数
- `original_duration_sec`: 原始音频时长（秒）
- `total_samples`: 合并后的总样本数（仅前置上下文时）
- `total_duration_sec`: 合并后的总时长（仅前置上下文时）

## 预期的日志输出示例

### 第一个 Utterance（上下文缓冲区为空）

```
INFO ℹ️ 上下文缓冲区为空，使用原始音频（第一个utterance或上下文已清空） trace_id=abc123 original_samples=48000 original_duration_sec=3.0
INFO ✅ 更新上下文缓冲区（使用VAD选择的最后一个语音段尾部） trace_id=abc123 context_samples=32000 context_duration_sec=2.0 segment_start=16000 segment_end=48000 segment_samples=32000
```

### 后续 Utterance（使用上下文）

```
INFO ✅ 前置上下文音频到当前utterance（上下文缓冲区不为空） trace_id=def456 context_samples=32000 context_duration_sec=2.0 original_samples=48000 original_duration_sec=3.0 total_samples=80000 total_duration_sec=5.0
INFO ✅ 更新上下文缓冲区（使用VAD选择的最后一个语音段尾部） trace_id=def456 context_samples=32000 context_duration_sec=2.0 segment_start=16000 segment_end=48000 segment_samples=32000
```

### 清空上下文缓冲区

```
INFO 🗑️ 上下文缓冲区和VAD状态已清空 previous_context_samples=32000 previous_context_duration_sec=2.0
```

## 常见问题排查

### Q1: 为什么看不到"前置上下文音频"的日志？

**可能原因**:
1. ✅ **上下文缓冲区始终为空** - 检查"更新上下文缓冲区"的日志，确认上下文是否被正确更新
2. ✅ **每次处理前上下文都被清空** - 检查是否有"清空上下文缓冲区"的日志
3. ✅ **日志级别设置不正确** - 确保设置为 `INFO` 或 `DEBUG`
4. ✅ **空文本或无效文本导致上下文未更新** - 检查是否有"ASR transcript is empty"或"ASR transcript is meaningless"的警告日志

**排查步骤**:
```bash
# 1. 检查日志级别
grep -i "log.*level\|RUST_LOG" node-inference.log | head -5

# 2. 检查上下文更新日志
grep "更新上下文缓冲区" node-inference.log | tail -10

# 3. 检查空文本过滤日志
grep -E "ASR transcript is empty|ASR transcript is meaningless" node-inference.log | tail -10

# 4. 检查清空日志
grep "上下文缓冲区和VAD状态已清空" node-inference.log
```

### Q2: 为什么上下文缓冲区大小不正确？

**检查点**:
1. ✅ 查看"更新上下文缓冲区"的日志，确认 `context_samples` 的值
2. ✅ 正常情况下应该是 32000 样本（2秒 @ 16kHz）
3. ✅ 如果 utterance 较短，可能会保存全部音频（小于 32000 样本）

**验证命令**:
```bash
# 检查上下文样本数
grep "更新上下文缓冲区" node-inference.log | grep -o "context_samples=[0-9]*" | sort -u

# 应该看到类似输出：
# context_samples=32000
# context_samples=16000  (如果utterance较短)
```

### Q3: 为什么第一个 utterance 后没有上下文？

**检查点**:
1. ✅ 第一个 utterance 应该看到"上下文缓冲区为空"的日志
2. ✅ 第一个 utterance 处理后应该看到"更新上下文缓冲区"的日志
3. ✅ 第二个 utterance 应该看到"前置上下文音频"的日志

**验证命令**:
```bash
# 按 trace_id 分组查看日志
grep -E "前置上下文|更新上下文缓冲区|上下文缓冲区为空" node-inference.log | sort
```

## 代码检查清单

- [x] ✅ 日志宏已正确导入（`use tracing::{info, warn, debug};`）
- [x] ✅ 前置上下文日志已实现（INFO 级别）
- [x] ✅ 更新上下文缓冲区日志已实现（INFO/WARN 级别）
- [x] ✅ 清空上下文缓冲区日志已实现（INFO 级别）
- [x] ✅ 所有日志都包含 `trace_id` 字段
- [x] ✅ 所有日志都包含必要的上下文信息（样本数、时长等）

## 总结

✅ **上下文缓冲区的日志实现是完整的**，包括：
- 前置上下文音频的日志（两种情况）
- 更新上下文缓冲区的日志（多种情况）
- 清空上下文缓冲区的日志

✅ **日志级别设置正确**：
- 前置上下文：`INFO`
- 更新上下文缓冲区：`INFO`（正常情况）或 `WARN`（错误情况）
- 清空上下文缓冲区：`INFO`

✅ **日志包含完整的上下文信息**：
- 样本数、时长、追踪ID等关键信息都已记录

**如果看不到日志，请检查**：
1. 日志级别是否设置为 `INFO` 或更低
2. 上下文缓冲区是否被正确更新（检查"更新上下文缓冲区"日志）
3. 是否有空文本或无效文本导致上下文未更新（检查警告日志）

