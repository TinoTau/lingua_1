# VAD 模块业务逻辑文档

## 模块概述
Silero VAD（Voice Activity Detection）语音活动检测引擎，用于检测音频中的语音段。

## 核心功能

### 1. 模型加载 (`new_from_model_path`)
- **输入**：ONNX 模型文件路径
- **处理**：
  1. 初始化 ONNX Runtime 环境
  2. 创建 Session，优先使用 CUDA GPU
  3. 如果 CUDA 不可用，回退到 CPU
- **输出**：VADEngine 实例

### 2. 语音活动检测 (`detect_voice_activity_frame`)
- **输入**：单帧音频数据（512 samples @ 16kHz = 32ms）
- **处理流程**：
  1. 归一化音频到 [-1, 1]
  2. 准备三个输入：
     - `audio_input`: 形状 [1, frame_size] 的音频数据
     - `state_input`: 形状 [2, 1, 128] 的隐藏状态（如果存在）
     - `sr_input`: 采样率标量（Int64）
  3. 运行 ONNX 推理
  4. 提取输出：
     - `outputs[0]`: 语音概率（需要提取并处理）
     - `outputs[1]`: 新的隐藏状态（用于下一帧）
  5. 更新隐藏状态
  6. 处理输出值（可能是 logit，需要 sigmoid 转换）
- **输出**：语音活动概率（0.0-1.0）

### 3. 状态管理
- **隐藏状态**：用于在帧之间传递模型状态
- **自适应状态**：根据语速动态调整阈值
- **重置功能**：支持重置所有状态（用于新音频流）

## ONNX 模型输入/输出

### 输入
1. **audio_input**: `[1, frame_size]` (f32) - 音频帧
2. **state_input**: `[2, 1, 128]` (f32) - 隐藏状态（可选，首次为全零）
3. **sr_input**: `[]` (i64) - 采样率（16000）

### 输出
1. **output[0]**: 语音概率或 logit（需要处理）
2. **output[1]**: 新的隐藏状态 `[2, 1, 128]` (f32)

## 关键数据结构

### VADConfig
- `sample_rate`: 16000
- `frame_size`: 512
- `silence_threshold`: 0.2
- 自适应阈值配置

### 状态存储
- `hidden_state`: `Option<Array2<f32>>` - 形状 [2, 128]
- `adaptive_state`: 语速自适应状态

## 业务逻辑要点

1. **状态传递**：模型需要隐藏状态在帧之间传递，首次推理时使用全零状态
2. **输出处理**：输出可能是 logit（需要 sigmoid）或直接的概率值
3. **GPU 回退**：优先使用 CUDA，失败时自动回退到 CPU
4. **自适应阈值**：根据语速动态调整静音检测阈值
