# 如何查看节点端 ASR 识别日志

## 概述

**重要说明**：
- **Silero VAD** 是用于**语音活动检测**（Voice Activity Detection）的，它只负责检测音频中哪些部分是语音，哪些部分是静音
- **ASR（Whisper）** 才是真正**识别原文**的引擎
- 识别不准确的问题应该查看 **ASR 识别日志**，而不是 VAD 日志

## 关键日志位置

### 1. ASR 识别结果日志

**位置**: `src/inference.rs:555`

```rust
info!(
    trace_id = %trace_id, 
    transcript_len = transcript.len(), 
    transcript_preview = %transcript.chars().take(50).collect::<String>(), 
    "ASR 识别完成"
);
```

**日志输出示例**:
```
INFO ASR 识别完成 trace_id=xxx transcript_len=45 transcript_preview="把这些文本都显示在一个聊天框里，然后随着我们的语音结果"
```

### 2. ASR 文本过滤日志

**位置**: `src/asr.rs:231`

```rust
tracing::info!("[ASR] Text filtered: \"{}\" -> \"{}\"", raw_text, filtered_text);
```

**日志输出示例**:
```
INFO [ASR] Text filtered: "把这些文本都显示在一个聊天框里，然后随着我们的语音结果" -> "把这些文本都显示在一个聊天框里，然后随着我们的语音结果"
```

### 3. VAD 检测日志（仅用于语音段检测）

**位置**: `src/inference.rs:389-395`

```rust
info!(
    trace_id = %trace_id,
    segments_count = segments.len(),
    original_samples = audio_f32_with_context.len(),
    processed_samples = processed_audio.len(),
    removed_samples = audio_f32_with_context.len() - processed_audio.len(),
    "VAD检测到{}个语音段，已提取有效语音", segments.len()
);
```

**说明**: 这个日志只显示 VAD 检测到了几个语音段，不显示识别结果。

## 如何查看日志

### 方法 1: 查看节点服务日志

节点服务使用 `tracing` 库进行日志记录。日志级别可以通过环境变量设置：

```bash
# 设置日志级别为 DEBUG（显示所有日志）
RUST_LOG=debug ./node-inference

# 设置日志级别为 INFO（显示重要日志）
RUST_LOG=info ./node-inference

# 只显示 ASR 相关日志
RUST_LOG=node_inference::asr=debug,node_inference::inference=info ./node-inference
```

### 方法 2: 查看 Electron 主进程日志

如果通过 Electron 运行，日志会输出到 Electron 的控制台。可以通过以下方式查看：

1. **开发模式**: 打开 Electron DevTools，查看 Console 标签
2. **生产模式**: 查看系统日志或 Electron 的日志文件

### 方法 3: 使用 trace_id 追踪

每个请求都有一个 `trace_id`，可以在日志中搜索特定的 `trace_id` 来追踪完整的处理流程：

```bash
# 搜索特定 trace_id 的所有日志
grep "trace_id=xxx" node-inference.log
```

## 识别不准确问题的排查步骤

### 1. 查看原始 ASR 识别结果

查找日志中的 `ASR 识别完成` 条目，查看 `transcript_preview` 字段：

```
INFO ASR 识别完成 trace_id=xxx transcript_preview="把這些文本都顯示在同一個了解誇了"
```

### 2. 查看文本过滤过程

查找 `[ASR] Text filtered` 日志，查看过滤前后的文本：

```
INFO [ASR] Text filtered: "把這些文本都顯示在同一個了解誇了" -> "把這些文本都顯示在同一個了解誇了"
```

### 3. 查看 VAD 检测结果（可选）

虽然 VAD 不负责识别，但它会影响识别质量。查看 VAD 是否正确检测到语音段：

```
INFO VAD检测到1个语音段，已提取有效语音 segments_count=1 original_samples=48000 processed_samples=32000
```

### 4. 查看上下文缓冲区使用情况

上下文缓冲区会影响 ASR 对句子开头的识别。查看是否使用了上下文：

```
DEBUG 前置上下文音频到当前utterance context_samples=32000
```

## 常见问题

### Q: 为什么识别结果不准确？

**可能原因**：
1. **音频质量问题**: 音频可能包含噪音、回声或失真
2. **语言设置错误**: ASR 使用的语言代码可能不正确
3. **上下文不足**: 如果句子开头识别不准确，可能是上下文缓冲区未正确使用
4. **VAD 过度过滤**: VAD 可能误将有效语音识别为静音并过滤掉

### Q: 如何提高识别准确性？

1. **检查音频质量**: 确保音频清晰，无背景噪音
2. **验证语言设置**: 确保 `src_lang` 参数正确
3. **查看上下文缓冲区**: 确保上下文缓冲区正常工作
4. **调整 VAD 阈值**: 如果 VAD 过度过滤，可以调整 `silence_threshold`

### Q: VAD 和 ASR 的关系是什么？

- **VAD**: 检测音频中的语音段，去除静音部分，提高 ASR 效率
- **ASR**: 对 VAD 处理后的音频进行语音识别，生成文本

VAD 不负责识别文本，只负责找到哪些部分是语音。

## 日志示例

### 完整的处理流程日志示例

```
DEBUG 开始处理推理请求 trace_id=abc123 job_id=job-001
DEBUG 开始 ASR 语音识别 trace_id=abc123 src_lang=zh
DEBUG 前置上下文音频到当前utterance context_samples=32000 trace_id=abc123
INFO VAD检测到1个语音段，已提取有效语音 segments_count=1 original_samples=48000 processed_samples=32000 trace_id=abc123
INFO ASR 识别完成 trace_id=abc123 transcript_len=45 transcript_preview="把这些文本都显示在一个聊天框里，然后随着我们的语音结果"
INFO 机器翻译完成 trace_id=abc123 translation_len=52
INFO 语音合成完成 trace_id=abc123 audio_len=64000
INFO 推理请求处理完成 trace_id=abc123 job_id=job-001
```

## 相关文档

- [ASR 引擎实现文档](./ASR_ENGINE.md)
- [VAD 集成实现文档](./VAD_INTEGRATION_IMPLEMENTATION.md)
- [文本过滤实现文档](./ASR_FILTER_CALL_FLOW.md)

