# ASR 准确率和重复识别问题分析

## 完整流程概览

```
Web端录音 → 静音过滤 → 音频编码(Opus) → 发送音频块(100ms)
    ↓
调度服务器接收 → 累积音频块 → 检测停顿/超时 → Finalize Utterance → 创建Job
    ↓
节点端接收Job → 解码音频 → 转发到ASR服务
    ↓
ASR服务处理 → VAD检测 → Faster Whisper识别 → 文本去重 → 返回结果
```

---

## 问题点分析

### 1. Web端录音和发送阶段

#### 1.1 音频质量
**位置**: `webapp/web-client/src/recorder.ts:108-169`

**可能问题**:
- **采样率**: 固定 16kHz，可能不适合某些场景
- **音频处理链**: `echoCancellation`, `noiseSuppression`, `autoGainControl` 可能引入失真
- **ScriptProcessorNode**: 已废弃的 API，可能影响音频质量
- **Buffer Size**: 4096 样本，可能导致延迟或丢帧

**影响**: 音频质量直接影响 ASR 识别准确率

#### 1.2 静音过滤逻辑
**位置**: `webapp/web-client/src/recorder.ts:243-300`

**可能问题**:
- **RMS 阈值**: `threshold: 0.01` 可能过于敏感或不够敏感
- **Attack/Release 帧数**: 
  - `attackFrames: 3` (30ms) - 可能过早开始发送，包含静音开头
  - `releaseFrames: 30` (300ms) - 可能过早停止，截断语音结尾
- **平滑逻辑**: 可能导致语音开头/结尾被截断

**影响**: 
- 过早截断 → 识别不完整
- 包含静音 → 识别准确率下降
- 截断语音结尾 → 重复识别（因为下一句可能包含上一句的结尾）

#### 1.3 音频块发送时机
**位置**: `webapp/web-client/src/app.ts:249-270`

**可能问题**:
- **固定间隔**: 每 100ms 发送一次（10帧），不考虑语音边界
- **静音检测超时**: `onSilenceDetected()` 在静音超时后才发送 `is_final=true`
- **缓冲区清空**: 静音检测后立即清空缓冲区，可能丢失语音结尾

**影响**:
- 语音结尾可能被截断
- 下一句可能包含上一句的结尾（导致重复）

---

### 2. 调度服务器拼接阶段

#### 2.1 音频块累积
**位置**: `central_server/scheduler/src/managers/audio_buffer.rs:75-100`

**可能问题**:
- **简单拼接**: 直接 `extend_from_slice`，没有考虑音频格式边界
- **Opus 格式**: 如果 Web 端发送 Opus，调度服务器直接拼接 Opus 帧可能不正确
  - Opus 帧有帧头，直接拼接可能导致解码错误
  - 应该先解码再拼接，或保持 Opus 帧的完整性

**影响**:
- Opus 帧拼接错误 → ASR 解码失败或识别错误
- 音频边界不清晰 → 识别准确率下降

#### 2.2 停顿检测
**位置**: `central_server/scheduler/src/managers/audio_buffer.rs:59-69`

**可能问题**:
- **pause_ms 阈值**: 默认值可能不适合所有场景
- **时间戳依赖**: 依赖客户端时间戳，网络延迟可能导致误判
- **停顿后处理**: 停顿后立即 finalize，可能截断语音

**影响**:
- 停顿阈值过短 → 一句话被分成多句（重复识别）
- 停顿阈值过长 → 多句话合并成一句（识别不准确）

#### 2.3 Finalize 时机
**位置**: `central_server/scheduler/src/websocket/session_actor/actor.rs:199-263`

**可能问题**:
- **多种触发条件**: Pause、IsFinal、MaxLength，可能冲突
- **utterance_index 管理**: 在 finalize 过程中可能收到新的音频块
- **音频边界**: finalize 时可能正好在语音中间

**影响**:
- 语音被截断 → 识别不完整
- 下一句包含上一句结尾 → 重复识别

---

### 3. 节点端转发阶段

#### 3.1 音频解码
**位置**: `electron_node/electron-node/main/src/task-router/task-router.ts:357-523`

**可能问题**:
- **格式转换**: Opus → PCM16 转换可能引入误差
- **解码错误处理**: 如果解码失败，可能使用错误的音频数据

**影响**:
- 解码误差 → 识别准确率下降

#### 3.2 ASR 参数传递
**位置**: `electron_node/electron-node/main/src/task-router/task-router.ts:420-434`

**当前配置**:
```typescript
condition_on_previous_text: false,  // ✅ 已禁用
use_context_buffer: false,          // ✅ 已禁用
use_text_context: true,             // ⚠️ 启用（initial_prompt）
```

**可能问题**:
- **use_text_context**: 虽然禁用了 `condition_on_previous_text`，但 `initial_prompt` 仍然可能影响识别
- **context_text**: 如果传递了错误的上下文文本，可能导致重复识别

**影响**:
- 文本上下文影响 → 识别结果偏向上下文（重复识别）

---

### 4. ASR 服务处理阶段

#### 4.1 音频解码
**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py:292-299`

**可能问题**:
- **格式支持**: Opus 解码可能不完整
- **采样率转换**: 如果采样率不匹配，可能导致识别错误

**影响**:
- 解码错误 → 识别失败或准确率下降

#### 4.2 VAD 检测
**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` (VAD 相关代码)

**可能问题**:
- **VAD 参数**: 阈值、窗口大小可能不适合所有场景
- **重复检测**: Web 端已经过滤了静音，ASR 服务再次 VAD 可能重复处理

**影响**:
- VAD 误判 → 语音被截断或包含静音
- 重复 VAD → 处理延迟增加

#### 4.3 Faster Whisper 识别
**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` (ASR Worker)

**可能问题**:
- **initial_prompt**: 如果传递了错误的上下文，可能导致重复识别
- **模型参数**: `beam_size`, `task` 等参数可能不适合所有场景
- **语言检测**: 自动语言检测可能误判

**影响**:
- 上下文影响 → 识别结果偏向上下文（重复识别）
- 参数不当 → 识别准确率下降

#### 4.4 文本去重
**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py:732-800`

**当前逻辑**:
- Step 9.2: 单 utterance 内去重
- Step 9.3: 跨 utterance 去重（已增强）

**可能问题**:
- **去重时机**: 在识别后去重，如果识别本身重复，去重可能无效
- **去重逻辑**: 虽然已增强，但可能仍有遗漏

**影响**:
- 去重不完整 → 重复文本仍然返回

---

## 主要问题总结

### 1. 音频边界问题（最严重）

**问题**: 语音开头/结尾被截断，导致：
- 当前句识别不完整
- 下一句包含上一句的结尾（重复识别）

**根本原因**:
1. Web 端静音过滤的 `releaseFrames` 可能过早停止发送
2. 调度服务器停顿检测可能过早 finalize
3. 音频块发送时机不考虑语音边界

**建议**:
- 增加语音结尾保护时间（例如：静音检测后继续发送 200-300ms）
- 优化停顿检测逻辑，考虑语音能量而非仅时间间隔
- 在 finalize 前检查音频能量，避免在语音中间截断

### 2. Opus 格式拼接问题

**问题**: 调度服务器直接拼接 Opus 帧，可能导致解码错误

**根本原因**:
- Opus 帧有帧头，直接拼接可能破坏帧结构

**建议**:
- 在调度服务器解码 Opus 后再拼接（转换为 PCM16）
- 或保持 Opus 帧的完整性，在 ASR 服务端解码

### 3. 文本上下文影响

**问题**: `use_text_context: true` 可能导致识别结果偏向上下文

**根本原因**:
- Faster Whisper 的 `initial_prompt` 会影响识别结果
- 如果上下文文本和当前音频内容相似，可能导致重复识别

**建议**:
- 考虑禁用 `use_text_context`，或优化上下文文本的生成逻辑
- 检查 `context_text` 的传递是否正确

### 4. 静音过滤参数

**问题**: Web 端静音过滤参数可能不适合所有场景

**根本原因**:
- `attackFrames: 3` 可能过早开始
- `releaseFrames: 30` 可能过早停止

**建议**:
- 根据实际场景调整参数
- 考虑实现自适应参数（根据语音能量动态调整）

---

---

## 技术细节补充

### 1. Web端技术细节

#### 1.1 音频采集参数
**位置**: `webapp/web-client/src/recorder.ts:111-119`

**具体配置**:
```typescript
audio: {
  sampleRate: 16000,        // 固定 16kHz（Faster Whisper 标准）
  channelCount: 1,          // 单声道
  echoCancellation: true,   // 回声消除（可能引入延迟/失真）
  noiseSuppression: true,   // 噪声抑制（可能误删语音）
  autoGainControl: true,    // 自动增益（可能改变音量）
}
```

**技术影响**:
- **采样率 16kHz**: 适合语音识别，但可能丢失高频信息
- **音频处理链**: 三个处理步骤可能引入 20-50ms 延迟
- **ScriptProcessorNode**: 已废弃 API，bufferSize=4096 样本（约 256ms @ 16kHz）

#### 1.2 静音过滤详细参数
**位置**: `webapp/web-client/src/types.ts:53-61`

**默认配置**:
```typescript
{
  enabled: true,
  threshold: 0.015,              // RMS 阈值（0-1）
  attackThreshold: 0.015,         // 进入语音阈值（严格）
  releaseThreshold: 0.005,        // 退出语音阈值（宽松）
  windowMs: 100,                  // 窗口大小（100ms）
  attackFrames: 3,                // 连续 3 帧（30ms）语音才开始发送
  releaseFrames: 30,              // 连续 30 帧（300ms）静音才停止发送
}
```

**技术细节**:
- **RMS 计算**: `sqrt(sum(samples²) / length)`，衡量音频能量
- **帧率**: 假设 10ms/帧，`attackFrames=3` = 30ms，`releaseFrames=30` = 300ms
- **平滑逻辑**: 使用 `consecutiveVoiceFrames` 和 `consecutiveSilenceFrames` 避免抖动

**潜在问题**:
- `releaseFrames=30` (300ms) 可能过早停止，截断语音结尾
- 如果用户说话时音量稍微降低（< 0.005），可能被误判为静音

#### 1.3 静音超时检测
**位置**: `webapp/web-client/src/recorder.ts:345-386`

**默认配置**:
```typescript
silenceTimeoutMs: 3000,    // 3秒静音超时
tailBufferMs: 250,         // 尾部缓冲 250ms
```

**技术细节**:
- **检测频率**: 使用 `requestAnimationFrame`（约 60fps，16.67ms/次）
- **静音阈值**: `average < 20`（基于 `getByteFrequencyData`，0-255 范围）
- **超时处理**: 检测到静音超时后，延迟 `tailBufferMs` 再触发回调

**潜在问题**:
- `tailBufferMs=250ms` 可能不够，语音结尾可能被截断
- 静音阈值 `20` 可能不适合所有环境（环境噪音、麦克风灵敏度）

#### 1.4 音频块发送机制
**位置**: `webapp/web-client/src/app.ts:249-270`

**技术细节**:
- **发送间隔**: 固定每 100ms（10帧）发送一次
- **缓冲区**: 累积 10 帧后发送，剩余帧保留在缓冲区
- **静音检测**: 静音超时后，发送剩余缓冲区 + `is_final=true`

**潜在问题**:
- 固定间隔不考虑语音边界，可能在语音中间发送
- 静音检测后立即清空缓冲区，可能丢失语音结尾

#### 1.5 Opus 编码
**位置**: `webapp/web-client/src/audio_codec.ts`

**技术细节**:
- **编码器**: `@minceraftmc/opus-encoder` (WebAssembly)
- **配置**: `sampleRate: 16000`, `channelCount: 1`, `frameSizeMs: 20`
- **比特率**: 默认自适应（通常 16-32kbps）

**潜在问题**:
- Opus 帧有帧头，直接拼接可能破坏帧结构
- 编码延迟：约 20ms（一帧大小）

---

### 2. 调度服务器技术细节

#### 2.1 音频缓冲区实现
**位置**: `central_server/scheduler/src/managers/audio_buffer.rs:23-34`

**技术细节**:
```rust
struct AudioBuffer {
    chunks: Vec<Vec<u8>>,  // 音频块列表
    total_size: usize,     // 总大小（字节）
}

fn get_combined(&self) -> Vec<u8> {
    let mut combined = Vec::with_capacity(self.total_size);
    for chunk in &self.chunks {
        combined.extend_from_slice(chunk);  // 直接拼接
    }
    combined
}
```

**潜在问题**:
- **Opus 格式**: 如果 Web 端发送 Opus，直接拼接 Opus 帧可能不正确
  - Opus 帧格式：`[TOC byte][frame data]`
  - 直接拼接可能导致解码器无法识别帧边界
- **PCM16 格式**: 如果 Web 端发送 PCM16，直接拼接是正确的

#### 2.2 停顿检测
**位置**: `central_server/scheduler/src/managers/audio_buffer.rs:59-69`

**默认配置**:
```rust
pause_ms: 3000  // 3秒（与 Web 端 silenceTimeoutMs 一致）
```

**技术细节**:
- **检测逻辑**: 比较当前时间戳和上次时间戳，差值 > `pause_ms` 则触发
- **时间戳来源**: 客户端发送的 `timestamp_ms`（可能受网络延迟影响）

**潜在问题**:
- **网络延迟**: 客户端时间戳可能不准确，导致误判
- **固定阈值**: 3秒可能不适合所有场景（快语速 vs 慢语速）

#### 2.3 Finalize 触发条件
**位置**: `central_server/scheduler/src/websocket/session_actor/actor.rs:199-263`

**触发条件**:
1. **Pause**: 停顿超过 `pause_ms` (3000ms)
2. **IsFinal**: Web 端发送 `is_final=true`
3. **MaxLength**: 音频大小超过 500KB（异常保护）

**技术细节**:
- **utterance_index 管理**: 使用 `current_utterance_index` 跟踪当前 utterance
- **状态机**: `Idle` → `Collecting` → `Finalizing` → `Idle`
- **去重机制**: 使用 `finalize_inflight` 防止重复 finalize

**潜在问题**:
- 在 `Finalizing` 状态时收到新音频块，可能使用错误的 `utterance_index`
- 停顿检测和 `is_final` 可能同时触发，导致重复 finalize

---

### 3. 节点端技术细节

#### 3.1 音频解码
**位置**: `electron_node/electron-node/main/src/task-router/task-router.ts`

**技术细节**:
- **Opus 解码**: 使用 `@minceraftmc/opus-encoder` 解码器
- **格式转换**: Opus → PCM16 Float32 → PCM16 Int16
- **采样率**: 保持 16kHz（不转换）

**潜在问题**:
- 解码误差可能累积
- 如果 Opus 帧拼接错误，解码可能失败

#### 3.2 ASR 参数
**位置**: `electron_node/electron-node/main/src/task-router/task-router.ts:420-434`

**当前配置**:
```typescript
{
  task: 'transcribe',
  beam_size: 5,
  condition_on_previous_text: false,  // ✅ 已禁用
  use_context_buffer: false,          // ✅ 已禁用
  use_text_context: true,            // ⚠️ 启用
  context_text: task.context_text,   // 来自调度服务器
}
```

**技术细节**:
- **condition_on_previous_text**: 控制是否基于上一个识别结果进行条件生成（已禁用）
- **use_context_buffer**: 控制是否使用音频上下文缓冲区（已禁用）
- **use_text_context**: 控制是否使用文本上下文作为 `initial_prompt`（启用）

**潜在问题**:
- `initial_prompt` 会影响 Faster Whisper 的识别结果
- 如果 `context_text` 和当前音频相似，可能导致重复识别

---

### 4. ASR 服务技术细节

#### 4.1 VAD 检测
**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**技术细节**:
- **模型**: Silero VAD (ONNX)
- **采样率**: 16kHz
- **窗口大小**: 512 样本（32ms @ 16kHz）
- **阈值**: 模型内部阈值（可配置）

**潜在问题**:
- Web 端已经过滤了静音，ASR 服务再次 VAD 可能重复处理
- VAD 参数可能不适合所有场景

#### 4.2 Faster Whisper 识别
**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**技术细节**:
- **模型**: Faster Whisper (large-v3)
- **beam_size**: 5（平衡准确率和速度）
- **initial_prompt**: 来自 `context_text`（如果启用 `use_text_context`）

**潜在问题**:
- `initial_prompt` 会影响识别结果，可能导致偏向上下文
- `beam_size=5` 可能不适合所有场景（可以调整）

#### 4.3 文本去重
**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py:732-800`

**技术细节**:
- **Step 9.2**: 单 utterance 内去重（使用 `deduplicate_text`）
- **Step 9.3**: 跨 utterance 去重（检查完全重复、前缀重复、后缀重复、包含关系）

**去重逻辑**:
1. 完全重复 → 返回空结果
2. 当前文本以上一个文本开头 → 移除重复部分
3. 当前文本是上一个文本的后缀 → 返回空结果
4. 当前文本包含在上一个文本中 → 返回空结果
5. 上一个文本包含在当前文本中 → 移除重复部分

**潜在问题**:
- 去重在识别后执行，如果识别本身重复，去重可能无效
- 部分重复的检测可能不够精确

---

## 用户操作影响分析

### 1. 说话速度影响

#### 1.1 快语速用户
**影响**:
- **静音过滤**: `releaseFrames=30` (300ms) 可能过长，导致句子间停顿被误判为句子内停顿
- **停顿检测**: `pause_ms=3000ms` 可能过长，快语速用户句子间停顿通常 < 1秒
- **音频块发送**: 固定 100ms 间隔可能跟不上快语速，导致延迟累积

**可能问题**:
- 多句话被合并成一句 → 识别不准确
- 句子间停顿被误判为句子内停顿 → 识别不完整

**建议**:
- 实现语速自适应（根据语音能量变化率检测语速）
- 动态调整 `releaseFrames` 和 `pause_ms`（快语速时减小）

#### 1.2 慢语速用户
**影响**:
- **静音过滤**: `releaseFrames=30` (300ms) 可能过短，慢语速用户句子内停顿可能 > 300ms
- **停顿检测**: `pause_ms=3000ms` 可能过短，慢语速用户思考停顿可能 > 3秒

**可能问题**:
- 一句话被分成多句 → 重复识别
- 句子内停顿被误判为句子结束 → 识别不完整

**建议**:
- 动态调整 `releaseFrames`（慢语速时增大）
- 动态调整 `pause_ms`（慢语速时增大）

---

### 2. 停顿习惯影响

#### 2.1 习惯性停顿
**影响**:
- 用户在句子中间习惯性停顿（思考、换气）
- 停顿时间可能 > 300ms（`releaseFrames` 阈值）

**可能问题**:
- 静音过滤误判为句子结束 → 提前停止发送
- 停顿检测误判为句子结束 → 提前 finalize
- 一句话被分成多句 → 重复识别

**建议**:
- 增加 `releaseFrames` 阈值（例如：500ms）
- 优化停顿检测，考虑语音能量变化而非仅时间间隔

#### 2.2 无停顿连续说话
**影响**:
- 用户连续说话，句子间无停顿
- 停顿时间 < 300ms

**可能问题**:
- 多句话被合并成一句 → 识别不准确
- 句子边界不清晰 → 识别不完整

**建议**:
- 使用 VAD 检测句子边界（而非仅停顿检测）
- 考虑语音能量变化率（句子结束通常有能量下降）

---

### 3. 环境噪音影响

#### 3.1 高噪音环境
**影响**:
- **RMS 阈值**: `threshold=0.015` 可能过低，环境噪音可能 > 0.015
- **静音检测**: 静音阈值 `20` 可能过低，环境噪音可能 > 20

**可能问题**:
- 环境噪音被误判为语音 → 包含噪音，识别准确率下降
- 静音检测失效 → 无法自动停止，需要手动停止

**建议**:
- 动态调整 RMS 阈值（根据环境噪音水平）
- 使用频谱分析区分语音和噪音（语音有特定频率特征）

#### 3.2 低噪音环境
**影响**:
- **RMS 阈值**: `threshold=0.015` 可能过高，低音量语音可能 < 0.015
- **静音检测**: 静音阈值 `20` 可能过高，低音量语音可能 < 20

**可能问题**:
- 低音量语音被误判为静音 → 不发送，识别失败
- 语音开头/结尾被截断 → 识别不完整

**建议**:
- 动态调整 RMS 阈值（根据环境噪音水平）
- 使用自适应增益（AGC）提高低音量语音

---

### 4. 麦克风距离影响

#### 4.1 远距离麦克风
**影响**:
- 语音音量较低，RMS 值可能 < 0.015
- 环境噪音相对较大

**可能问题**:
- 语音被误判为静音 → 不发送，识别失败
- 环境噪音被误判为语音 → 包含噪音，识别准确率下降

**建议**:
- 使用自适应增益（AGC）
- 动态调整 RMS 阈值

#### 4.2 近距离麦克风
**影响**:
- 语音音量较高，RMS 值可能 > 0.015
- 可能产生爆音（clipping）

**可能问题**:
- 爆音导致音频失真 → 识别准确率下降
- 高音量导致 RMS 值波动大 → 静音过滤不稳定

**建议**:
- 使用自动增益控制（AGC）限制最大音量
- 使用压缩器（compressor）平滑音量波动

---

### 5. 说话音量影响

#### 5.1 低音量用户
**影响**:
- RMS 值可能 < 0.015（静音过滤阈值）
- 可能 < 20（静音检测阈值）

**可能问题**:
- 语音被误判为静音 → 不发送，识别失败
- 语音开头/结尾被截断 → 识别不完整

**建议**:
- 使用自适应增益（AGC）
- 降低 RMS 阈值（但需考虑环境噪音）

#### 5.2 高音量用户
**影响**:
- RMS 值可能 > 0.015
- 可能产生爆音（clipping）

**可能问题**:
- 爆音导致音频失真 → 识别准确率下降
- 高音量导致 RMS 值波动大 → 静音过滤不稳定

**建议**:
- 使用自动增益控制（AGC）限制最大音量
- 使用压缩器（compressor）平滑音量波动

---

### 6. 口音和方言影响

#### 6.1 口音影响
**影响**:
- 口音可能导致语音特征不同
- Faster Whisper 可能对某些口音识别准确率较低

**可能问题**:
- 识别准确率下降
- 重复识别（因为识别错误，上下文影响）

**建议**:
- 使用语言特定的模型（如果支持）
- 优化 `initial_prompt` 使用（提供口音相关的上下文）

#### 6.2 方言影响
**影响**:
- 方言可能导致语音特征不同
- Faster Whisper 可能对某些方言识别准确率较低

**可能问题**:
- 识别准确率下降
- 重复识别（因为识别错误，上下文影响）

**建议**:
- 使用方言特定的模型（如果支持）
- 优化 `initial_prompt` 使用（提供方言相关的上下文）

---

## 优先级建议

### 高优先级
1. **修复音频边界问题**（语音截断导致重复）
   - 增加语音结尾保护时间（例如：静音检测后继续发送 200-300ms）
   - 优化停顿检测逻辑，考虑语音能量而非仅时间间隔
   - 在 finalize 前检查音频能量，避免在语音中间截断

2. **修复 Opus 格式拼接问题**（解码错误）
   - 在调度服务器解码 Opus 后再拼接（转换为 PCM16）
   - 或保持 Opus 帧的完整性，在 ASR 服务端解码

### 中优先级
3. **优化静音过滤参数**（减少截断）
   - 根据实际场景调整 `releaseFrames`（例如：500ms）
   - 实现自适应参数（根据语音能量动态调整）

4. **优化停顿检测逻辑**（避免过早 finalize）
   - 考虑语音能量变化率（句子结束通常有能量下降）
   - 使用 VAD 检测句子边界（而非仅停顿检测）

5. **实现语速自适应**（减少快/慢语速用户问题）
   - 根据语音能量变化率检测语速
   - 动态调整 `releaseFrames` 和 `pause_ms`

### 低优先级
6. **优化文本上下文使用**（减少上下文影响）
   - 考虑禁用 `use_text_context`，或优化上下文文本的生成逻辑
   - 检查 `context_text` 的传递是否正确

7. **增强去重逻辑**（作为最后防线）
   - 优化部分重复的检测逻辑
   - 考虑在识别前进行去重（如果可能）

8. **环境自适应**（减少环境噪音影响）
   - 动态调整 RMS 阈值（根据环境噪音水平）
   - 使用频谱分析区分语音和噪音

