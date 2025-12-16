# VAD 架构分析：Web 端 vs 节点端

## 概述

本文档分析 Web 端 VAD 和节点端 Silero VAD 的功能定位、实现状态和流程关系。

---

## 1. 功能定位对比

### 1.1 Web 端 VAD（轻量级静音检测）

**位置**: `web-client/src/recorder.ts`

**功能**:
- ✅ **已实现**：简单的音量检测（使用 `AnalyserNode`）
- ✅ **作用**：检测静音，触发"结束本轮"操作
- ✅ **阈值**：音量 < 20（相对值）
- ✅ **超时**：静音持续 1000ms 后触发回调

**代码实现**:
```typescript
// 计算平均音量
const average = this.dataArray.reduce((sum, value) => sum + value, 0) / this.dataArray.length;
const threshold = 20; // 静音阈值

if (average < threshold) {
  // 检测到静音超过 1000ms → 触发回调
  if (now - this.silenceStartTime > this.config.silenceTimeoutMs) {
    this.silenceDetectedCallback();
  }
}
```

**关键特点**:
- 🎯 **不负责断句**：只负责触发"结束本轮"
- 🎯 **不决定句子边界**：只是简单的音量检测
- 🎯 **轻量级**：使用浏览器原生 API，无模型推理

---

### 1.2 节点端 Silero VAD（精确断句）

**位置**: `node-inference/src/vad.rs`

**功能**:
- ✅ **已实现**：Silero VAD 模型（ONNX Runtime）
- ⚠️ **当前状态**：**在 `inference.rs` 中暂未使用**
- 🎯 **设计目标**：对拼接后的音频进行精确的语音段检测和断句

**代码实现**:
```rust
// VAD 引擎已创建，但未在 process 中使用
vad_engine: vad::VADEngine,  // VAD 用于节点端 Level 2 断句，当前在 process 中暂未使用
```

**关键特点**:
- 🎯 **精确断句**：使用深度学习模型检测语音段边界
- 🎯 **自适应阈值**：根据语速动态调整静音阈值
- 🎯 **高精度**：能够识别自然停顿和句子边界
- ✅ **上下文缓冲**：包含多层上下文状态管理（见下文）

#### 1.2.1 上下文缓冲机制 ✅

Silero VAD 实现了**多层上下文缓冲和状态管理**：

**1. 模型隐藏状态（RNN 状态）** ✅
```rust
hidden_state: Arc<Mutex<Option<Array2<f32>>>>,  // 形状: [2, 128]
```
- **作用**：Silero VAD 模型是 RNN 架构，需要在帧之间传递隐藏状态
- **更新**：每次推理后更新，用于下一帧的上下文感知
- **生命周期**：在整个音频流处理过程中保持，可通过 `reset_state()` 重置

**2. 帧缓冲区** ✅
```rust
frame_buffer: Arc<Mutex<Vec<f32>>>,  // 用于累积小帧
```
- **作用**：累积不足一帧的音频数据
- **状态**：已实现，但当前 `detect_speech()` 方法中未使用（直接处理完整音频块）

**3. 自适应状态（语速历史）** ✅
```rust
adaptive_state: Arc<Mutex<AdaptiveState>>,  // 包含语速历史
struct AdaptiveState {
    speech_rate_history: VecDeque<f32>,  // 最多保存 20 个历史值
    base_threshold_ms: u64,
    sample_count: usize,
}
```
- **作用**：根据历史语速动态调整静音阈值
- **历史窗口**：最多保存 20 个语速样本
- **算法**：使用指数加权移动平均（EWMA）计算平均语速
- **自适应**：根据语速使用 sigmoid 函数动态调整阈值倍数（0.5x - 1.5x）

**4. 其他状态管理** ✅
```rust
silence_frame_count: Arc<Mutex<usize>>,           // 连续静音帧数
last_speech_timestamp: Arc<Mutex<Option<u64>>>,   // 上一个检测到语音的时间戳
last_boundary_timestamp: Arc<Mutex<Option<u64>>>, // 上一次边界检测的时间戳（冷却期）
```
- **作用**：跟踪语音活动状态，防止频繁边界检测
- **冷却期**：通过 `last_boundary_timestamp` 实现边界检测冷却

**状态重置**：
```rust
pub fn reset_state(&self) -> Result<()> {
    // 重置所有状态，用于新的音频流
}
```

---

## 2. 当前流程分析

### 2.1 实际运行流程

```
[Web 客户端]
  ├─ 录音（连续）
  ├─ 轻量级 VAD 检测静音
  ├─ 静音超过 1000ms → 触发"结束本轮"
  ├─ 发送 audio_chunk（is_final=true）
  └─ 等待翻译结果
         ↓
[调度服务器]
  ├─ 累积 audio_chunk
  ├─ 收到 is_final=true → 创建 job
  └─ 发送完整音频给节点
         ↓
[节点推理服务]
  ├─ 接收完整音频数据
  ├─ ⚠️ **直接进行 ASR（未使用 VAD 断句）**
  ├─ ASR → NMT → TTS
  └─ 返回结果
```

### 2.2 设计意图（两层 VAD 架构）

根据 `docs/node_inference/TWO_LEVEL_VAD_DESIGN.md`，设计意图是：

```
[Web 客户端]
  ├─ Level 1 VAD：轻量级，只过滤明显静音
  ├─ 按固定窗口打包音频块（非断句）
  └─ 持续上传 audio_chunk
         ↓
[调度服务器]
  ├─ 转发 audio_chunk 到节点
         ↓
[节点推理服务]
  ├─ 拼接 audio_chunk
  ├─ Level 2 VAD：使用 Silero VAD 进行精确断句
  ├─ 输出自然句级 utterances
  └─ ASR → NMT → TTS
```

---

## 3. 功能重复性分析

### 3.1 功能不重复 ✅

| 维度 | Web 端 VAD | 节点端 Silero VAD |
|------|-----------|------------------|
| **功能定位** | 触发"结束本轮" | 精确断句 |
| **检测精度** | 简单音量检测 | 深度学习模型 |
| **作用时机** | 录音过程中 | 音频拼接后 |
| **输出结果** | 布尔值（是否静音） | 语音段边界列表 |
| **计算资源** | 浏览器原生 API | GPU/CPU 模型推理 |

**结论**：功能定位不同，**不重复**。

### 3.2 流程不冲突 ✅

**当前实现**：
- Web 端 VAD 决定何时发送完整音频（`is_final=true`）
- 节点端直接处理完整音频，**未使用 VAD 断句**

**设计意图**：
- Web 端 VAD 只过滤静音，降低带宽
- 节点端 VAD 进行精确断句，提升 ASR 质量

**结论**：流程**不冲突**，但节点端 VAD **尚未集成**。

---

## 4. 当前实现状态

### 4.1 已实现 ✅

- ✅ Web 端轻量级 VAD（静音检测）
- ✅ 节点端 Silero VAD 引擎（模型加载和检测逻辑）
- ✅ 调度服务器音频缓冲区（累积 audio_chunk）

### 4.2 未实现 ⚠️

- ⚠️ **节点端 VAD 集成**：`inference.rs` 中未使用 VAD 进行断句
- ⚠️ **流式断句**：节点端未实现"拼接 → VAD 断句 → 多 utterance"的流程

### 4.3 当前行为

**实际运行**：
1. Web 端检测到静音 → 发送完整音频（`is_final=true`）
2. 节点端接收完整音频 → **直接进行 ASR**（未断句）
3. 返回单个翻译结果

**设计意图**：
1. Web 端过滤静音 → 持续发送音频块
2. 节点端拼接音频 → **VAD 断句** → 多个 utterance
3. 返回多个翻译结果

---

## 5. 建议

### 5.1 短期（当前状态）

**当前实现可以正常工作**：
- Web 端 VAD 用于触发"结束本轮"，功能正常
- 节点端直接处理完整音频，ASR 质量可接受
- **无需立即修改**

### 5.2 长期（优化方向）

**如果希望实现完整的两层 VAD 架构**：

1. **节点端集成 VAD**：
   - 在 `inference.rs` 中使用 `vad_engine` 进行断句
   - 对拼接后的音频进行语音段检测
   - 为每个语音段创建独立的 ASR 任务

2. **Web 端优化**：
   - 改为持续发送音频块（不等待静音）
   - 降低静音过滤阈值（更保守）
   - 让节点端负责所有断句决策

3. **调度服务器优化**：
   - 支持流式音频块转发
   - 维护会话级音频缓冲区
   - 支持节点端主动请求音频数据

---

## 6. 节点端 VAD 上下文缓冲详解

### 6.1 上下文缓冲层次

节点端 Silero VAD 实现了**三层上下文缓冲机制**：

#### 6.1.1 模型级上下文（RNN 隐藏状态）

**实现位置**: `detect_voice_activity_frame()` 方法

```rust
// 获取或初始化隐藏状态（形状：[2, 1, 128]）
let state_array = {
    let mut state_guard = self.hidden_state.lock()?;
    if let Some(ref state_2d) = *state_guard {
        // 使用之前的隐藏状态
        state_2d.clone().into_shape((2, 1, 128))?
    } else {
        // 初始化新的隐藏状态
        let new_state = Array3::<f32>::zeros((2, 1, 128));
        *state_guard = Some(new_state.clone().into_shape((2, 128))?);
        new_state
    }
};

// 推理时传入隐藏状态
let outputs = session.run(vec![audio_input, state_input, sr_input])?;

// 更新隐藏状态（用于下一帧）
if outputs.len() > 1 {
    let new_state = extract_state_from_output(outputs[1])?;
    *state_guard = Some(new_state);
}
```

**特点**:
- ✅ **自动维护**：每次推理自动更新
- ✅ **跨帧传递**：保持音频流的时序上下文
- ✅ **模型必需**：Silero VAD 是 RNN 模型，需要状态传递

#### 6.1.2 应用级上下文（语速历史）

**实现位置**: `AdaptiveState` 结构

```rust
struct AdaptiveState {
    speech_rate_history: VecDeque<f32>,  // 最多 20 个历史值
    base_threshold_ms: u64,
    sample_count: usize,
}

fn update_speech_rate(&mut self, speech_rate: f32, config: &VADConfig) {
    // 添加到历史（FIFO，最多 20 个）
    self.speech_rate_history.push_back(speech_rate);
    if self.speech_rate_history.len() > 20 {
        self.speech_rate_history.pop_front();
    }
    
    // 计算指数加权移动平均
    let avg_speech_rate = calculate_ewma(&self.speech_rate_history);
    
    // 根据语速动态调整阈值
    let multiplier = calculate_multiplier_from_speech_rate(avg_speech_rate);
    self.base_threshold_ms = adjust_threshold(multiplier);
}
```

**特点**:
- ✅ **历史窗口**：保存最近 20 个语速样本
- ✅ **自适应调整**：根据语速动态调整静音阈值（200ms - 800ms）
- ✅ **平滑过渡**：使用 EWMA 避免阈值突变

#### 6.1.3 会话级上下文（时间戳和计数）

**实现位置**: `VADEngine` 结构

```rust
silence_frame_count: Arc<Mutex<usize>>,           // 连续静音帧数
last_speech_timestamp: Arc<Mutex<Option<u64>>>,   // 上一个语音时间戳
last_boundary_timestamp: Arc<Mutex<Option<u64>>>, // 上一次边界时间戳
```

**特点**:
- ✅ **状态跟踪**：跟踪语音活动状态
- ✅ **冷却期**：防止频繁边界检测
- ✅ **会话级**：在整个会话过程中保持

### 6.2 上下文缓冲的作用

1. **提升检测精度**：
   - RNN 隐藏状态提供时序上下文，提升单帧检测准确率
   - 语速历史帮助适应不同说话人的语速特点

2. **自适应调整**：
   - 根据历史语速动态调整阈值，适应快慢语速
   - 避免固定阈值导致的误检或漏检

3. **状态一致性**：
   - 跨帧状态传递保证检测结果的一致性
   - 冷却期机制避免频繁边界切换

### 6.3 与 Web 端 VAD 的对比

| 维度 | Web 端 VAD | 节点端 Silero VAD |
|------|-----------|------------------|
| **上下文缓冲** | ❌ 无（每帧独立检测） | ✅ 多层（RNN 状态 + 语速历史 + 时间戳） |
| **状态管理** | ❌ 无状态 | ✅ 有状态（跨帧传递） |
| **自适应能力** | ❌ 固定阈值 | ✅ 动态调整（根据语速） |
| **检测精度** | ⚠️ 简单（音量检测） | ✅ 高精度（深度学习模型） |

---

## 7. 总结

### 7.1 功能重复性

✅ **不重复**：
- Web 端 VAD：触发"结束本轮"（UI 交互）
- 节点端 VAD：精确断句（ASR 质量）

### 7.2 流程冲突性

✅ **不冲突**：
- Web 端决定何时发送完整音频
- 节点端处理完整音频（当前未使用 VAD）

### 7.3 上下文缓冲

✅ **节点端 VAD 有完整的上下文缓冲机制**：
- ✅ **模型级**：RNN 隐藏状态（跨帧传递）
- ✅ **应用级**：语速历史（自适应调整）
- ✅ **会话级**：时间戳和计数（状态跟踪）

### 7.4 当前状态

⚠️ **节点端 VAD 未集成**：
- VAD 引擎已实现（包含完整的上下文缓冲），但未在推理流程中使用
- 当前是"单层 VAD"架构（Web 端决定断句）
- 设计意图是"两层 VAD"架构（节点端精确断句）

### 7.5 建议

- **当前实现可以正常工作**，无需立即修改
- **节点端 VAD 已具备完整的上下文缓冲能力**，集成后可以提升 ASR 质量
- **如需优化 ASR 质量**，可以考虑集成节点端 VAD（上下文缓冲已就绪）
- **如需降低带宽**，可以考虑实现完整的两层 VAD 架构

---

## 7. 相关文档

- [两层 VAD 架构设计](./node_inference/TWO_LEVEL_VAD_DESIGN.md)
- [Web 客户端 README](../web-client/README.md)
- [节点推理服务 README](../node_inference/README.md)

