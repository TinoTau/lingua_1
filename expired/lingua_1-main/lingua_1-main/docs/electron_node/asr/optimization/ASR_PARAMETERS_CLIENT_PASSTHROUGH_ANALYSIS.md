# ASR 参数客户端传递分析

## 当前状态

### ✅ 已完成的层级

1. **Python ASR Service** (`faster_whisper_vad_service.py`)
   - ✅ `UtteranceRequest` 已包含所有新参数：
     - `beam_size: int = 10`
     - `best_of: Optional[int] = 5`
     - `temperature: Optional[float] = 0.0`
     - `patience: Optional[float] = 1.0`
     - `compression_ratio_threshold: Optional[float] = 2.4`
     - `log_prob_threshold: Optional[float] = -1.0`
     - `no_speech_threshold: Optional[float] = 0.6`

2. **ASR Worker Manager** (`asr_worker_manager.py`)
   - ✅ `ASRTask` 数据类已包含所有新参数
   - ✅ `submit_task` 方法已支持传递新参数

3. **ASR Worker Process** (`asr_worker_process.py`)
   - ✅ `transcribe` 调用已支持使用新参数

### ❌ 缺失的层级

1. **Rust node-inference** (`faster_whisper_vad_client.rs`)
   - ❌ `UtteranceRequest` 结构体**不包含**新参数（只有 `beam_size`）
   - ❌ 构建请求时**硬编码** `beam_size: 5`（第211行）

2. **TypeScript 协议定义** (`shared/protocols/messages.ts`)
   - ❌ `UtteranceMessage` **不包含**新参数
   - ❌ `JobAssignMessage` **不包含**新参数

3. **Node 端代码** (`task-router.ts`, `pipeline-orchestrator.ts`)
   - ❌ 没有从 `JobAssignMessage` 提取新参数
   - ❌ 没有传递新参数到 ASR 服务

## 数据流分析

```
Web Client
  ↓ UtteranceMessage (❌ 无新参数)
Scheduler
  ↓ JobAssignMessage (❌ 无新参数)
Node (TypeScript)
  ↓ 调用 Rust node-inference
Rust node-inference
  ↓ UtteranceRequest (❌ 无新参数，beam_size 硬编码为 5)
Python ASR Service
  ↓ ✅ 支持新参数，但无法接收
```

## 需要修改的文件

### 1. TypeScript 协议定义

**文件**: `electron_node/shared/protocols/messages.ts`

需要添加：
- `UtteranceMessage` 中添加新参数（可选）
- `JobAssignMessage` 中添加新参数（可选）

### 2. Rust node-inference

**文件**: `electron_node/services/node-inference/src/faster_whisper_vad_client.rs`

需要：
- 在 `UtteranceRequest` 结构体中添加新参数
- 在构建请求时从参数中提取并传递新参数

### 3. Node 端代码

**文件**: `electron_node/electron-node/main/src/task-router/task-router.ts`

需要：
- 从 `JobAssignMessage` 中提取新参数
- 传递到 ASR 服务调用

## 结论

**当前这些参数无法由客户端传递**，因为：

1. 客户端消息定义（`UtteranceMessage`）中没有这些字段
2. 调度服务器消息定义（`JobAssignMessage`）中没有这些字段
3. Rust 客户端代码中没有这些字段，且 `beam_size` 被硬编码为 5

## 建议

### 方案 1：服务端默认值（推荐）

保持当前实现，使用服务端默认值：
- `beam_size = 10`（已在 Python 服务中设置）
- 其他参数使用默认值

**优点**：
- 无需修改客户端代码
- 所有用户自动获得优化

**缺点**：
- 无法按需调整参数

### 方案 2：完整传递链（如果需要客户端控制）

如果需要客户端能够控制这些参数，需要：

1. 在 `UtteranceMessage` 和 `JobAssignMessage` 中添加可选字段
2. 在 Rust 代码中添加字段并传递
3. 在 Node 端代码中提取并传递

**优点**：
- 客户端可以按需调整参数

**缺点**：
- 需要修改多个层级
- 增加协议复杂度

## 当前建议

**使用方案 1**：保持服务端默认值，因为：
- 这些参数主要是为了提高准确度，应该对所有用户生效
- 客户端通常不需要调整这些技术参数
- 减少协议复杂度

如果需要，可以在后续版本中添加客户端控制能力。

