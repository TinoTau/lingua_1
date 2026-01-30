# 备份代码与正式代码对比分析

**日期**: 2026-01-23  
**目的**: 对比备份代码和正式代码的关键配置和逻辑差异

---

## 一、Job结果去重机制

### 1.1 备份代码

**文件**: `expired/lingua_1-main/central_server/scheduler/src/core/job_result_deduplicator.rs`

**逻辑**:
- 只检查 `job_id`，不区分结果类型（ASR_EMPTY vs 完整结果）
- 30秒TTL内，相同 `job_id` 的结果会被过滤
- 没有特殊处理 ASR_EMPTY 的情况

### 1.2 正式代码

**文件**: `central_server/scheduler/src/core/job_result_deduplicator.rs`

**逻辑**:
- **完全一致**：只检查 `job_id`，不区分结果类型
- 30秒TTL内，相同 `job_id` 的结果会被过滤
- 没有特殊处理 ASR_EMPTY 的情况

### 1.3 差异

**无差异**：备份代码和正式代码的去重机制完全一致。

**问题**：
- 如果第一次返回 ASR_EMPTY，第二次返回完整结果，第二次结果会被去重机制过滤
- 这是导致 `job-7007e5fc` (utterance_index=1) 完整结果丢失的根本原因

**建议修复**：
- 修改去重逻辑，区分 ASR_EMPTY 和完整结果
- 如果第一次是 ASR_EMPTY，第二次是完整结果，应该允许处理第二次结果

---

## 二、音频质量阈值（RMS）

### 2.1 备份代码

**节点端** (`expired/lingua_1-main/electron_node/electron-node/main/src/task-router/task-router-asr-audio-quality.ts`):
```typescript
const MIN_RMS_THRESHOLD = 0.015;  // 从0.008提高到0.015，更严格地过滤低质量音频
```

**ASR服务端** (`expired/lingua_1-main/electron_node/services/faster_whisper_vad/audio_validation.py`):
```python
MIN_AUDIO_RMS = 0.0005  # 最小 RMS 能量（降低到 0.0005，适应 Opus 编码音频）
```

### 2.2 正式代码

**节点端** (`electron_node/electron-node/main/src/task-router/task-router-asr-audio-quality.ts`):
```typescript
const MIN_RMS_THRESHOLD = 0.015;  // 从0.008提高到0.015，更严格地过滤低质量音频
```

**ASR服务端** (`electron_node/services/faster_whisper_vad/audio_validation.py`):
```python
MIN_AUDIO_RMS = 0.0005  # 最小 RMS 能量（降低到 0.0005，适应 Opus 编码音频）
```

### 2.3 差异

**无差异**：备份代码和正式代码的RMS阈值完全一致。

**说明**：
- 节点端使用 `0.015` 进行预检查（更严格）
- ASR服务端使用 `0.0005` 进行二次检查（更宽松）
- 这是两层检查机制，节点端先过滤，ASR服务端再验证

---

## 三、文本去重算法

### 3.1 备份代码

**文件**: `expired/lingua_1-main/electron_node/services/faster_whisper_vad/text_deduplicator.py`

**逻辑**:
- 方法1：检测完全重复的短语（递归处理）
- 方法2：检测部分重复（从长到短检查）
- 方法3：检测开头和结尾的重复（最小短语长度4）
- 方法4：检测句尾的重复字符或短词（1-3个字符）

### 3.2 正式代码

**文件**: `electron_node/services/faster_whisper_vad/text_deduplicator.py`

**逻辑**:
- **完全一致**：所有方法都相同

### 3.3 差异

**无差异**：备份代码和正式代码的文本去重算法完全一致。

---

## 四、空结果处理

### 4.1 备份代码

**文件**: `expired/lingua_1-main/central_server/scheduler/src/websocket/node_handler/message/job_result/job_result_processing.rs`

**逻辑**:
- 只处理 `NO_TEXT_ASSIGNED`（空容器核销）
- 没有处理 `ASR_EMPTY` 的特殊逻辑
- 空结果会跳过 group_manager 和 UI 事件

### 4.2 正式代码

**文件**: `central_server/scheduler/src/websocket/node_handler/message/job_result/job_result_processing.rs`

**逻辑**:
- 处理 `NO_TEXT_ASSIGNED` 和 `ASR_EMPTY` 两种情况
- 空结果会跳过 group_manager 和 UI 事件

### 4.3 差异

**差异**：正式代码增加了对 `ASR_EMPTY` 的处理，备份代码没有。

**说明**：
- 正式代码更完善，支持了 `ASR_EMPTY` 的处理
- 但去重机制的问题仍然存在

---

## 五、总结

### 5.1 完全一致的模块

1. ✅ **Job结果去重机制**：备份代码和正式代码完全一致（都有问题）
2. ✅ **音频质量阈值（RMS）**：备份代码和正式代码完全一致
3. ✅ **文本去重算法**：备份代码和正式代码完全一致

### 5.2 有差异的模块

1. ⚠️ **空结果处理**：
   - 备份代码：只处理 `NO_TEXT_ASSIGNED`
   - 正式代码：处理 `NO_TEXT_ASSIGNED` 和 `ASR_EMPTY`
   - **建议**：保持正式代码的处理方式（更完善）

### 5.3 需要修复的问题

**关键问题**：Job结果去重机制不区分 ASR_EMPTY 和完整结果

**修复方案**：
1. 修改 `job_result_deduplicator.rs`，在记录时同时记录结果类型（是否为空）
2. 修改去重检查逻辑：
   - 如果第一次是 ASR_EMPTY，第二次是完整结果，允许处理第二次结果
   - 如果第一次是完整结果，第二次也是完整结果，过滤第二次（正常去重）
   - 如果第一次是完整结果，第二次是 ASR_EMPTY，过滤第二次（避免空结果覆盖完整结果）

---

**文档版本**: v1.0  
**最后更新**: 2026-01-23  
**状态**: 归档文档（历史记录）
