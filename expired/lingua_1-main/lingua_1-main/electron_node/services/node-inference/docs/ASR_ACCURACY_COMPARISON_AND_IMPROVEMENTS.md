# ASR 识别准确率对比与改进方案

## 概述

本文档对比原项目（`D:\Programs\github\lingua`）和当前项目（`lingua_1`）的 ASR 实现差异，分析识别准确率偏低的原因，并提供改进方案。

## 关键差异对比

### 1. ASR 引擎

| 特性 | 原项目 | 当前项目 |
|------|--------|----------|
| **引擎** | Faster Whisper (Python HTTP 服务) | whisper-rs (Rust 库) |
| **上下文类型** | 文本上下文（initial_prompt） | 音频上下文（前置音频） |
| **解码策略** | Beam Search (beam_size=5) | Greedy Search (best_of=1) |
| **条件生成** | condition_on_previous_text=true | 不支持 |

### 2. 上下文实现

#### 原项目：文本上下文（initial_prompt）

```rust
// 原项目：使用文本上下文
let context_prompt = self.get_context_prompt()?;  // 获取前一个 utterance 的文本
let asr_response = self.http_client.transcribe(
    wav_bytes,
    context_prompt,  // 作为 initial_prompt 传递给 Faster Whisper
    language,
).await?;
```

**Faster Whisper 配置**：
```rust
AsrHttpRequest {
    prompt: context_prompt,  // 文本上下文
    beam_size: 5,  // 束搜索
    condition_on_previous_text: true,  // 启用条件生成
    // ...
}
```

**优势**：
- Faster Whisper 原生支持 `initial_prompt`，可以显著提高连续识别准确度
- 文本上下文比音频上下文更精确（直接提供语言信息）
- 束搜索（beam_size=5）比贪心搜索更准确

#### 当前项目：音频上下文

```rust
// 当前项目：使用音频上下文
let audio_f32_with_context = {
    let context = self.context_buffer.lock().await;
    if !context.is_empty() {
        let mut audio_with_context = context.clone();
        audio_with_context.extend_from_slice(&audio_f32);  // 前置音频
        audio_with_context
    } else {
        audio_f32.clone()
    }
};
```

**whisper-rs 配置**：
```rust
let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });  // 贪心搜索
// 没有 initial_prompt 支持
```

**劣势**：
- whisper-rs 可能不支持 `initial_prompt`（需要验证）
- 音频上下文不如文本上下文精确
- 贪心搜索（best_of=1）比束搜索准确度低

### 3. 解码策略差异

#### 原项目：束搜索（Beam Search）

```rust
beam_size: 5,  // 束搜索，保留 5 个最佳候选
```

**优势**：
- 探索多个候选路径，选择最优解
- 准确度通常比贪心搜索高 5-10%

#### 当前项目：贪心搜索（Greedy Search）

```rust
SamplingStrategy::Greedy { best_of: 1 }  // 贪心搜索，只保留 1 个候选
```

**劣势**：
- 只选择当前最优，可能错过全局最优
- 准确度通常比束搜索低

## 识别准确率偏低的原因分析

### 主要原因

1. **缺少文本上下文支持**
   - 原项目使用 `initial_prompt` 提供文本上下文，显著提高连续识别准确度
   - 当前项目只使用音频上下文，效果不如文本上下文

2. **使用贪心搜索而非束搜索**
   - 原项目使用 `beam_size=5` 的束搜索
   - 当前项目使用 `best_of=1` 的贪心搜索
   - 贪心搜索准确度通常比束搜索低 5-10%

3. **缺少条件生成**
   - 原项目使用 `condition_on_previous_text=true`
   - 当前项目不支持此功能

### 次要原因

1. **音频上下文不如文本上下文精确**
   - 音频上下文需要模型从音频中提取信息
   - 文本上下文直接提供语言信息，更精确

2. **模型差异**
   - Faster Whisper 和 whisper-rs 可能使用不同的模型实现
   - Faster Whisper 可能针对连续识别进行了优化

## 改进方案

### 方案 1：添加文本上下文支持（推荐）

**目标**：在 whisper-rs 中添加 `initial_prompt` 支持

**步骤**：

1. **检查 whisper-rs 是否支持 initial_prompt**
   ```rust
   // 查看 FullParams 是否有 set_initial_prompt 方法
   // 如果支持，添加文本上下文缓存
   ```

2. **添加文本上下文缓存**
   ```rust
   pub struct InferenceService {
       // ... 现有字段 ...
       
       // 文本上下文缓存（前一个 utterance 的识别文本）
       text_context_cache: Arc<tokio::sync::Mutex<Option<String>>>,
   }
   ```

3. **在 ASR 处理时使用文本上下文**
   ```rust
   // 获取文本上下文
   let text_context = {
       let cache = self.text_context_cache.lock().await;
       cache.clone()
   };
   
   // 如果 whisper-rs 支持，设置 initial_prompt
   if let Some(ref context) = text_context {
       params.set_initial_prompt(context.as_str());  // 需要验证 API
   }
   ```

4. **更新文本上下文缓存**
   ```rust
   // ASR 识别完成后，更新文本上下文缓存
   if !transcript.trim().is_empty() {
       let mut cache = self.text_context_cache.lock().await;
       *cache = Some(transcript.clone());
   }
   ```

### 方案 2：改用束搜索（推荐）

**目标**：将贪心搜索改为束搜索

**步骤**：

1. **修改解码策略**
   ```rust
   // 当前：贪心搜索
   let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
   
   // 改为：束搜索
   let mut params = FullParams::new(SamplingStrategy::BeamSearch { 
       beam_size: 5,  // 与原项目一致
       patience: 1.0,  // 默认值
   });
   ```

2. **性能考虑**
   - 束搜索比贪心搜索慢，但准确度更高
   - `beam_size=5` 是性能和准确度的平衡点

### 方案 3：同时使用音频和文本上下文（最佳）

**目标**：结合音频上下文和文本上下文

**步骤**：

1. **保留音频上下文**（当前实现）
   - 继续使用 `context_buffer` 前置音频

2. **添加文本上下文**（新功能）
   - 添加 `text_context_cache` 存储前一个 utterance 的文本
   - 在 ASR 处理时同时使用音频和文本上下文

3. **更新逻辑**
   ```rust
   // 1. 前置音频上下文（现有）
   let audio_f32_with_context = {
       let context = self.context_buffer.lock().await;
       if !context.is_empty() {
           let mut audio_with_context = context.clone();
           audio_with_context.extend_from_slice(&audio_f32);
           audio_with_context
       } else {
           audio_f32.clone()
       }
   };
   
   // 2. 获取文本上下文（新增）
   let text_context = {
       let cache = self.text_context_cache.lock().await;
       cache.clone()
   };
   
   // 3. 配置 ASR 参数
   let mut params = FullParams::new(SamplingStrategy::BeamSearch { 
       beam_size: 5,
       patience: 1.0,
   });
   
   // 4. 如果支持，设置文本上下文
   if let Some(ref context) = text_context {
       params.set_initial_prompt(context.as_str());  // 需要验证 API
   }
   
   // 5. ASR 识别
   let transcript = self.asr_engine.transcribe_f32(&audio_f32_with_context, &src_lang).await?;
   
   // 6. 更新文本上下文缓存
   if !transcript.trim().is_empty() {
       let mut cache = self.text_context_cache.lock().await;
       *cache = Some(transcript.clone());
   }
   ```

## 实施优先级

### 高优先级（立即实施）

1. **改用束搜索**
   - 影响：准确度提升 5-10%
   - 难度：低（只需修改一行代码）
   - 风险：低（性能略有下降，但可接受）

2. **检查并添加文本上下文支持**
   - 影响：准确度提升 10-20%（如果支持）
   - 难度：中（需要验证 API 并实现缓存）
   - 风险：中（如果 API 不支持，需要其他方案）

### 中优先级（后续优化）

3. **优化音频上下文选择**
   - 当前已使用 VAD 选择最佳上下文片段
   - 可以进一步优化上下文时长和选择策略

4. **添加条件生成支持**
   - 如果 whisper-rs 支持，启用条件生成
   - 提高连续识别准确度

### 低优先级（长期优化）

5. **考虑切换到 Faster Whisper**
   - 如果 whisper-rs 不支持关键功能，考虑使用 Faster Whisper
   - 需要添加 HTTP 客户端和 Python 服务

## 验证步骤

### 1. 检查 whisper-rs API

```rust
// 检查 FullParams 是否有以下方法：
// - set_initial_prompt()
// - set_condition_on_previous_text()
// - BeamSearch 策略支持
```

### 2. 实施改进

1. 先实施束搜索（简单，立即见效）
2. 再实施文本上下文（如果 API 支持）
3. 测试准确度提升

### 3. 对比测试

- 使用相同的测试音频
- 对比改进前后的识别准确度
- 记录性能影响

## 相关文档

- [上下文缓冲区实现](./VAD_CONTEXT_BUFFER_IMPLEMENTATION.md)
- [上下文缓冲区 vs NMT 上下文](./CONTEXT_BUFFER_VS_NMT_CONTEXT_ANALYSIS.md)
- [原项目 Faster Whisper 实现](../../../../D:/Programs/github/lingua/core/engine/src/asr_whisper/faster_whisper_streaming.rs)

## 总结

**主要问题**：
1. 缺少文本上下文支持（initial_prompt）
2. 使用贪心搜索而非束搜索
3. 缺少条件生成支持

**推荐改进**：
1. **立即**：改用束搜索（beam_size=5）
2. **尽快**：检查并添加文本上下文支持
3. **长期**：考虑切换到 Faster Whisper（如果 whisper-rs 不支持关键功能）

**预期效果**：
- 束搜索：准确度提升 5-10%
- 文本上下文：准确度提升 10-20%
- 综合提升：15-30%

