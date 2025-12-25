# Audio Chunk拼接问题分析

**日期**: 2025-12-25  
**状态**: 🔍 **问题已定位**

---

## 问题现象

**所有job的音频都只有0.24秒（3840 samples at 16kHz）**

从日志看：
- `job-031EC479`: `original_samples=3840 original_duration_sec=0.240`
- `job-E14E2B85`: `original_samples=3840 original_duration_sec=0.240`
- `job-D6A0E6E9`: `original_samples=3840 original_duration_sec=0.240`
- `job-CDEA69AC`: `original_samples=3840 original_duration_sec=0.240`

---

## 预期机制

### 调度服务器应该拼接audio_chunk

1. **Web端发送audio_chunk**:
   - 每100ms发送一个audio_chunk（10帧，每帧10ms）
   - 累积到调度服务器的`audio_buffer`

2. **调度服务器累积**:
   - 所有audio_chunk累积到同一个`utterance_index`的buffer
   - 每次收到chunk后，重置超时计时器（pause_ms，默认2000ms）

3. **调度服务器finalize**:
   - 如果`pause_ms`时间内没有收到新的audio_chunk → **自动finalize**
   - 如果收到`is_final=true` → **立即finalize**
   - 如果检测到pause_exceeded → **先finalize上一个，然后开始新的**

4. **finalize执行**:
   - 合并所有chunk: `take_combined()` → 合并所有chunk
   - 创建job → 发送给节点端

### faster_whisper_vad的上下文缓冲区

**注意**: faster_whisper_vad的上下文缓冲区是用于**跨utterance**的上下文，不是用于拼接audio_chunk的。

- **用途**: 保存前一个utterance的尾部音频（最后2秒），前置到当前utterance
- **不是**: 拼接audio_chunk（那是调度服务器的职责）

---

## 问题分析

### 0.24秒音频 = 只收到了2-3个audio_chunk

**计算**:
- 0.24秒 = 240ms
- 每个audio_chunk = 100ms（10帧 × 10ms/帧）
- 0.24秒 ≈ 2-3个audio_chunk

**可能原因**:

#### 原因1: Web端静音检测过早触发 ⚠️

**场景**:
- Web端录音开始
- 发送了2-3个audio_chunk（0.2-0.3秒）
- Web端静音检测触发 → 停止发送audio_chunk
- 调度服务器等待2秒后超时 → finalize → 只有0.24秒音频

**检查点**:
- Web端的静音检测配置（silence_threshold, silence_duration_ms）
- Web端是否过早触发静音检测

#### 原因2: Web端发送了`is_final=true` ⚠️

**场景**:
- Web端发送了2-3个audio_chunk
- Web端发送`is_final=true` → 调度服务器立即finalize
- 只有0.24秒音频

**检查点**:
- Web端是否过早调用`sendFinal()`
- Web端的静音检测逻辑

#### 原因3: 调度服务器finalize机制有问题 ⚠️

**场景**:
- Web端正常发送audio_chunk
- 但调度服务器的finalize机制过早触发
- 只累积了2-3个chunk就finalize了

**检查点**:
- 调度服务器的`pause_ms`配置
- 调度服务器的超时计时器逻辑
- 是否有其他触发finalize的条件

---

## 日志分析

### 关键日志

```
07:53:09,408 - original_samples=3840 original_duration_sec=0.240
'ℹ️ 上下文缓冲区为空，使用原始音频（第一个utterance或上下文已清空）'
```

**说明**:
- 这是第一个utterance（上下文缓冲区为空）
- 原始音频只有0.24秒
- 说明调度服务器只发送了0.24秒的音频

### 缺少的日志

**应该检查**:
1. 调度服务器日志：查看finalize的原因（IsFinal、Pause、Timeout）
2. Web端日志：查看发送了多少个audio_chunk
3. 调度服务器日志：查看audio_buffer累积了多少chunk

---

## 修复建议

### 1. 检查Web端静音检测配置 ⚠️

**问题**: Web端可能过早触发静音检测

**检查**:
- `silence_threshold`: 静音阈值
- `silence_duration_ms`: 静音持续时间（默认值？）
- 是否在录音开始后立即触发静音检测

**修复**:
- 增加`silence_duration_ms`（比如从500ms增加到1000ms）
- 或者：在录音开始的前1秒内，不触发静音检测

### 2. 检查调度服务器finalize原因 ⚠️

**问题**: 调度服务器可能过早finalize

**检查**:
- 调度服务器日志中的finalize原因（IsFinal、Pause、Timeout）
- `pause_ms`配置值
- 是否有异常触发finalize

**修复**:
- 如果是因为`is_final=true`，检查Web端为什么过早发送
- 如果是因为超时，检查`pause_ms`是否太小

### 3. 增加最短音频时长检查 ⚠️

**问题**: 即使调度服务器正确拼接，如果音频太短，Faster Whisper也无法识别

**修复**:
- 在faster_whisper_vad服务中，如果音频< 0.5秒，直接返回空文本
- 记录警告日志，说明音频太短

### 4. 增强日志记录 ⚠️

**问题**: 缺少关键日志信息

**修复**:
- 在调度服务器中，记录finalize的原因和累积的chunk数量
- 在Web端中，记录发送的audio_chunk数量和总时长
- 在faster_whisper_vad服务中，记录接收到的音频时长

---

## 下一步

1. ✅ **检查调度服务器日志**: 查看finalize的原因和累积的chunk数量
2. ⚠️ **检查Web端日志**: 查看发送了多少个audio_chunk
3. ⚠️ **检查Web端静音检测配置**: 确认是否过早触发
4. ⚠️ **增加最短音频时长检查**: 在faster_whisper_vad服务中过滤太短的音频

---

**分析完成时间**: 2025-12-25  
**状态**: 🔍 **问题已定位：0.24秒音频 = 只收到了2-3个audio_chunk，可能是Web端静音检测过早触发或调度服务器过早finalize**

