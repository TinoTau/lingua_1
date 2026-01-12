# Silero VAD 上下文缓冲区实现文档

**版本**: v1.0  
**最后更新**: 2025-01-XX  
**实现位置**: `src/inference.rs`

---

## 1. 功能概述

实现了 Silero VAD 的上下文缓冲区功能，用于提高 Whisper ASR 的识别准确性，特别是对句子开头的识别。

### 1.1 核心原理

- **问题**: Whisper 在处理短音频片段时，缺少上下文会导致识别准确性下降，特别是句子开头可能被截断
- **解决方案**: 在处理新 utterance 时，将前一个 utterance 的尾部音频（最后 1-2 秒）前置到当前音频
- **效果**: 提供跨 utterance 的音频上下文，提高识别准确性

---

## 2. 实现细节

### 2.1 数据结构

在 `InferenceService` 中添加上下文缓冲区：

```rust
pub struct InferenceService {
    // ... 其他字段 ...
    
    // 上下文缓冲区：保存前一个utterance的尾部音频（用于提高ASR准确性）
    // 采样率：16kHz，格式：f32，范围：[-1.0, 1.0]
    // 最大长度：2秒（32000个样本 @ 16kHz）
    context_buffer: Arc<tokio::sync::Mutex<Vec<f32>>>,
}
```

### 2.2 工作流程

#### 步骤 1: 前置上下文音频

在处理 ASR 之前，从上下文缓冲区获取前一个 utterance 的尾部音频，并前置到当前音频：

```rust
// 2.0 上下文缓冲区处理：前置前一个utterance的尾部音频
let audio_f32_with_context = {
    let context = self.context_buffer.lock().await;
    if !context.is_empty() {
        let mut audio_with_context = context.clone();
        audio_with_context.extend_from_slice(&audio_f32);
        // 使用带上下文的音频进行ASR识别
        audio_with_context
    } else {
        // 第一个utterance，没有上下文
        audio_f32.clone()
    }
};
```

#### 步骤 2: ASR 识别

使用带上下文的音频进行 ASR 识别（支持流式和一次性处理）：

```rust
// 一次性处理（使用带上下文的音频）
self.asr_engine.transcribe_f32(&audio_f32_with_context, &src_lang).await?
```

#### 步骤 3: 更新上下文缓冲区

处理完成后，保存当前 utterance 的尾部音频（最后 2 秒）到上下文缓冲区：

```rust
// 2.1 更新上下文缓冲区：保存当前utterance的尾部音频（最后1-2秒）
const CONTEXT_DURATION_SEC: f32 = 2.0;  // 保存最后2秒
const SAMPLE_RATE: u32 = 16000;
let context_samples = (CONTEXT_DURATION_SEC * SAMPLE_RATE as f32) as usize;

let mut context = self.context_buffer.lock().await;
if audio_f32.len() > context_samples {
    // 保存最后2秒的音频
    let start_idx = audio_f32.len() - context_samples;
    *context = audio_f32[start_idx..].to_vec();
} else {
    // 如果当前utterance太短，保存全部
    *context = audio_f32.clone();
}
```

---

## 3. API 方法

### 3.1 清空上下文缓冲区

```rust
/// 清空上下文缓冲区
/// 
/// 用于会话结束或需要重置上下文时调用
pub async fn clear_context_buffer(&self) {
    let mut context = self.context_buffer.lock().await;
    context.clear();
    tracing::debug!("上下文缓冲区已清空");
}
```

### 3.2 获取上下文缓冲区大小

```rust
/// 获取上下文缓冲区当前大小（样本数）
pub async fn get_context_buffer_size(&self) -> usize {
    let context = self.context_buffer.lock().await;
    context.len()
}
```

---

## 4. 配置参数

### 4.1 上下文时长

- **默认值**: 2.0 秒
- **位置**: `CONTEXT_DURATION_SEC` 常量
- **说明**: 保存前一个 utterance 的最后 2 秒音频作为上下文

### 4.2 采样率

- **值**: 16000 Hz
- **说明**: 与 Whisper ASR 和 Silero VAD 的采样率一致

---

## 5. 使用场景

### 5.1 正常对话流程

```
Utterance 1: "我今天去了" (3秒)
  ↓ ASR识别（无上下文）
  ↓ 保存尾部2秒到上下文缓冲区

Utterance 2: "那个新开的" (2秒)
  ↓ 前置上下文（Utterance 1的最后2秒）
  ↓ ASR识别（带上下文，提高准确性）
  ↓ 保存尾部2秒到上下文缓冲区

Utterance 3: "咖啡店" (1.5秒)
  ↓ 前置上下文（Utterance 2的最后2秒，但实际只有2秒）
  ↓ ASR识别（带上下文）
  ↓ 保存尾部1.5秒到上下文缓冲区（utterance较短，保存全部）
```

### 5.2 会话重置

当会话结束或需要重置时，调用 `clear_context_buffer()` 清空上下文缓冲区。

---

## 6. 优势

1. **提高识别准确性**: 特别是对句子开头的识别
2. **保持上下文连续性**: 跨 utterance 的音频上下文
3. **减少截断问题**: 避免句子开头被截断导致的识别错误
4. **自动管理**: 无需手动管理，自动维护上下文缓冲区

---

## 7. 注意事项

1. **内存占用**: 上下文缓冲区最多保存 2 秒音频（32000 个样本），内存占用约 128KB
2. **流式 ASR**: 在流式 ASR 模式下，上下文也会被前置，Whisper 会自动处理
3. **第一个 utterance**: 第一个 utterance 没有上下文，从第二个 utterance 开始使用上下文
4. **短 utterance**: 如果 utterance 太短（< 2 秒），会保存全部音频作为上下文

---

## 8. 与 Silero VAD 的关系

- **Silero VAD**: 主要用于语音活动检测和断句（Level 2 VAD）
- **上下文缓冲区**: 用于提高 ASR 识别准确性（音频级别上下文）
- **互补关系**: 两者在不同层次工作，共同提升系统性能

---

## 9. 测试建议

1. **准确性测试**: 对比使用上下文缓冲区前后的 ASR 识别准确性
2. **句子开头测试**: 特别测试句子开头的识别准确性
3. **短 utterance 测试**: 测试短 utterance（< 2 秒）的处理
4. **会话重置测试**: 测试 `clear_context_buffer()` 的功能

---

## 10. 未来改进

1. **可配置的上下文时长**: 允许通过配置调整上下文时长（1-3 秒）
2. **智能上下文选择**: 使用 VAD 检测选择更合适的上下文片段
3. **上下文质量评估**: 评估上下文质量，避免低质量上下文影响识别

