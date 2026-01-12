# 上下文缓冲区启用状态确认

## ✅ 确认：上下文缓冲区已启用

根据代码检查，**上下文缓冲区功能已经完全启用并正在使用**。

## 实现位置

**文件**: `src/inference.rs`

### 1. 数据结构定义（第 84-87 行）

```rust
// 上下文缓冲区：保存前一个utterance的尾部音频（用于提高ASR准确性）
// 采样率：16kHz，格式：f32，范围：[-1.0, 1.0]
// 最大长度：2秒（32000个样本 @ 16kHz）
context_buffer: Arc<tokio::sync::Mutex<Vec<f32>>>,
```

### 2. 初始化（第 123 行）

```rust
context_buffer: Arc::new(tokio::sync::Mutex::new(Vec::new())),
```

### 3. 前置上下文音频（第 348-366 行）

```rust
// 2.0 上下文缓冲区处理：前置前一个utterance的尾部音频
// 这可以提高Whisper对句子开头的识别准确性
let audio_f32_with_context = {
    let context = self.context_buffer.lock().await;
    if !context.is_empty() {
        let mut audio_with_context = context.clone();
        audio_with_context.extend_from_slice(&audio_f32);
        debug!(
            trace_id = %trace_id,
            context_samples = context.len(),
            original_samples = audio_f32.len(),
            total_samples = audio_with_context.len(),
            "前置上下文音频到当前utterance"
        );
        audio_with_context
    } else {
        audio_f32.clone()
    }
};
```

**说明**: 
- ✅ 如果上下文缓冲区不为空，会将前一个 utterance 的尾部音频前置到当前音频
- ✅ 第一个 utterance 时，上下文缓冲区为空，使用原始音频

### 4. 更新上下文缓冲区（第 470-540 行）

```rust
// 2.1 更新上下文缓冲区：使用VAD选择最佳上下文片段
// 优先选择最后一个语音段的尾部，而不是简单的音频尾部
{
    const CONTEXT_DURATION_SEC: f32 = 2.0;  // 保存最后2秒
    const SAMPLE_RATE: u32 = 16000;
    let context_samples = (CONTEXT_DURATION_SEC * SAMPLE_RATE as f32) as usize;
    
    let mut context = self.context_buffer.lock().await;
    
    // 使用VAD检测原始音频（不带上下文）的语音段
    match self.vad_engine.detect_speech(&audio_f32) {
        Ok(segments) => {
            if !segments.is_empty() {
                // 选择最后一个语音段
                let (last_start, last_end) = segments.last().unwrap();
                let last_segment = &audio_f32[*last_start..*last_end];
                
                // 从最后一个语音段的尾部提取上下文
                if last_segment.len() > context_samples {
                    let start_idx = last_segment.len() - context_samples;
                    *context = last_segment[start_idx..].to_vec();
                    debug!(
                        trace_id = %trace_id,
                        context_samples = context.len(),
                        segment_start = last_start,
                        segment_end = last_end,
                        "更新上下文缓冲区（使用VAD选择的最后一个语音段尾部）"
                    );
                } else {
                    // 如果最后一个段太短，保存整个段
                    *context = last_segment.to_vec();
                    debug!(
                        trace_id = %trace_id,
                        context_samples = context.len(),
                        "更新上下文缓冲区（最后一个语音段较短，保存全部）"
                    );
                }
            } else {
                // 如果没有检测到语音段，回退到简单尾部保存
                if audio_f32.len() > context_samples {
                    let start_idx = audio_f32.len() - context_samples;
                    *context = audio_f32[start_idx..].to_vec();
                    debug!(
                        trace_id = %trace_id,
                        context_samples = context.len(),
                        "更新上下文缓冲区（VAD未检测到语音段，保存最后{}秒）", CONTEXT_DURATION_SEC
                    );
                } else {
                    *context = audio_f32.clone();
                    debug!(
                        trace_id = %trace_id,
                        context_samples = context.len(),
                        "更新上下文缓冲区（utterance较短，保存全部）"
                    );
                }
            }
        }
        Err(e) => {
            // VAD检测失败，回退到简单尾部保存
            warn!(
                trace_id = %trace_id,
                error = %e,
                "VAD检测失败，使用简单尾部保存上下文"
            );
            if audio_f32.len() > context_samples {
                let start_idx = audio_f32.len() - context_samples;
                *context = audio_f32[start_idx..].to_vec();
            } else {
                *context = audio_f32.clone();
            }
        }
    }
}
```

**说明**:
- ✅ 使用 VAD 选择最佳上下文片段（最后一个语音段的尾部）
- ✅ 如果 VAD 未检测到语音段或失败，回退到简单尾部保存
- ✅ 保存最后 2 秒的音频（32000 个样本 @ 16kHz）

## 工作流程

### 第一个 Utterance
1. 上下文缓冲区为空
2. 直接使用原始音频进行 ASR 识别
3. 处理完成后，保存当前 utterance 的尾部（最后 2 秒）到上下文缓冲区

### 后续 Utterance
1. 从上下文缓冲区获取前一个 utterance 的尾部音频
2. 将上下文音频前置到当前音频
3. 使用带上下文的音频进行 ASR 识别
4. 处理完成后，更新上下文缓冲区（保存当前 utterance 的尾部）

## 如何验证上下文缓冲区是否工作

### 方法 1: 查看日志

在日志中搜索以下关键字：

1. **前置上下文**:
   ```
   DEBUG 前置上下文音频到当前utterance trace_id=xxx context_samples=32000 original_samples=48000 total_samples=80000
   ```

2. **更新上下文缓冲区**:
   ```
   DEBUG 更新上下文缓冲区（使用VAD选择的最后一个语音段尾部） trace_id=xxx context_samples=32000
   ```

### 方法 2: 检查日志中的样本数

- **第一个 utterance**: `context_samples=0` 或没有"前置上下文"日志
- **后续 utterance**: `context_samples>0` 且有"前置上下文"日志

### 方法 3: 使用 API 检查

```rust
// 获取上下文缓冲区大小
let size = service.get_context_buffer_size().await;
println!("上下文缓冲区大小: {} 样本 (约 {} 秒)", size, size as f32 / 16000.0);
```

## 清空上下文缓冲区

上下文缓冲区会在以下情况被清空：

1. **手动清空**: 调用 `clear_context_buffer()` API
2. **会话结束**: 通常由上层服务在会话结束时调用

```rust
// 清空上下文缓冲区（同时重置VAD状态）
service.clear_context_buffer().await;
```

## 配置参数

- **上下文时长**: 2.0 秒（`CONTEXT_DURATION_SEC`）
- **采样率**: 16000 Hz
- **最大样本数**: 32000 样本（2秒 × 16000 Hz）

## 总结

✅ **上下文缓冲区已完全启用并正常工作**

- ✅ 数据结构已定义
- ✅ 初始化已完成
- ✅ 前置上下文逻辑已实现
- ✅ 更新上下文逻辑已实现（使用 VAD 优化）
- ✅ 清空功能已实现
- ✅ 日志输出已配置

如果识别不准确，可能的原因：
1. 上下文缓冲区未正确更新（检查日志）
2. VAD 检测失败导致上下文选择不当
3. 音频质量问题
4. 语言设置错误

## 相关文档

- [VAD 上下文缓冲区实现文档](./VAD_CONTEXT_BUFFER_IMPLEMENTATION.md)
- [VAD 集成实现文档](./VAD_INTEGRATION_IMPLEMENTATION.md)
- [如何查看 ASR 日志](./HOW_TO_VIEW_ASR_LOGS.md)

