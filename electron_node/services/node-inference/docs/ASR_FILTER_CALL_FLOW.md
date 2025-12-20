# ASR 文本过滤机制调用流程

## 概述

ASR 文本过滤机制在多个层级被调用，确保无意义的文本（如带括号的字幕信息）被过滤掉。

## 调用位置

### 1. **Segment 级别过滤** (`asr.rs`)

在提取每个 Whisper segment 的文本时，立即进行过滤：

**位置**：
- `transcribe_f32` (第215行)
- `get_partial_result` (第370行)
- `get_final_result` (第475行)

**代码**：
```rust
if crate::text_filter::is_meaningless_transcript(text_trimmed) {
    tracing::debug!("[ASR] Filtering segment at transcription level: \"{}\"", text_trimmed);
} else {
    full_text.push_str(text_trimmed);
    full_text.push(' ');
}
```

**作用**：在 segment 级别就过滤掉无意义的文本，避免它们被拼接到 `full_text` 中。

### 2. **拼接后过滤** (`asr.rs`)

在所有 segments 拼接成完整文本后，进行第二次过滤：

**位置**：
- `transcribe_f32` (第229行)
- `get_partial_result` (第384行)
- `get_final_result` (第489行)

**代码**：
```rust
let raw_text = full_text.trim().to_string();
let filtered_text = crate::text_filter::filter_asr_text(&raw_text);
```

**作用**：处理可能通过 segment 级别过滤的混合文本（如 "正常文本 (字幕:J Chong)"）。

### 3. **最终结果过滤** (`asr.rs`)

在返回结果前，进行最后一次过滤（双重保险）：

**位置**：
- `transcribe_f32` (第242行)
- `get_partial_result` (第397行)
- `get_final_result` (第502行)

**代码**：
```rust
let filtered_text = crate::text_filter::filter_asr_text(&text);
```

**作用**：确保最终返回的文本不包含无意义内容。

### 4. **结果检查** (`inference.rs`)

在将 transcript 设置到 PipelineContext 前，检查是否包含括号：

**位置**：`inference.rs` 第372行

**代码**：
```rust
if transcript.contains('(') || transcript.contains('（') || transcript.contains('[') || transcript.contains('【') {
    tracing::warn!(
        "⚠️ [ASR Filter Check] Transcript contains brackets before setting to context!"
    );
}
```

**作用**：如果过滤后仍包含括号，记录警告日志。

## 数据流

```
音频输入
  ↓
Whisper ASR 推理
  ↓
提取 Segments
  ↓
[过滤层级1] Segment 级别过滤 (is_meaningless_transcript)
  ↓
拼接 Segments → full_text
  ↓
[过滤层级2] 拼接后过滤 (filter_asr_text)
  ↓
返回 text
  ↓
[过滤层级3] 最终结果过滤 (filter_asr_text)
  ↓
返回 filtered_text
  ↓
设置到 PipelineContext
  ↓
[检查] 如果仍包含括号，记录警告
  ↓
发送到调度服务器
```

## 过滤函数

### `is_meaningless_transcript(text: &str) -> bool`

检查单个文本片段是否为无意义内容：
- 检查括号
- 检查精确匹配
- 检查部分匹配模式
- 检查字幕相关模式

### `filter_asr_text(text: &str) -> String`

过滤完整文本中的无意义内容：
- 检查整个文本
- 智能分割括号内容
- 过滤无意义片段
- 重新组合有意义的片段

## 配置加载

配置在服务启动时加载：
- `main.rs` 第83行：`lingua_node_inference::text_filter::init_config()`
- 配置文件路径：`config/asr_filters.json`
- 如果配置文件不存在，使用默认配置

## 调试日志

以下日志可以帮助诊断过滤是否生效：

1. **配置加载**：
   - `[ASR Filter] ✅ Loading config from: ...`
   - `ASR 文本过滤配置已加载`

2. **Segment 过滤**：
   - `[ASR] Filtering segment at transcription level: "..."`

3. **文本过滤**：
   - `[ASR Filter] 🔍 filter_asr_text called with bracketed text: "..."`
   - `[ASR Filter] ✅ Filtering text with bracket '...': "..."`
   - `[ASR] Text filtered: "..." -> "..."`

4. **警告**：
   - `[ASR] ⚠️ Filtered text still contains brackets: "..."`
   - `⚠️ [ASR Filter Check] Transcript contains brackets before setting to context!`

## 问题排查

如果过滤没有生效，检查：

1. **配置是否正确加载**：
   - 查看启动日志中是否有 `ASR 文本过滤配置已加载`
   - 检查 `filter_brackets` 是否为 `true`

2. **过滤函数是否被调用**：
   - 查看是否有 `[ASR Filter] 🔍 filter_asr_text called` 日志
   - 查看是否有 `[ASR Filter Debug] 🔍 Checking text with brackets` 日志

3. **过滤是否生效**：
   - 查看是否有 `[ASR Filter] ✅ Filtering text with bracket` 日志
   - 查看是否有 `[ASR] Text filtered: "..." -> "..."` 日志

4. **如果过滤后仍包含括号**：
   - 查看 `[ASR] ⚠️ Filtered text still contains brackets` 警告
   - 检查 `filter_asr_text` 函数的逻辑

