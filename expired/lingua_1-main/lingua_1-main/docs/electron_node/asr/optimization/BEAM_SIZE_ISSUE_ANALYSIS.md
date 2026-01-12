# Beam Size 问题分析

## 问题描述

日志显示 `beam_size=5`，但代码中已经设置为 `beam_size=10`。

## 代码检查结果

### 1. Rust 客户端 ✅
- `electron_node/services/node-inference/src/faster_whisper_vad_client.rs:226`
- `beam_size: 10` ✅ 正确

### 2. Python 服务默认值 ✅
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py:128`
- `beam_size: int = 10` ✅ 正确

### 3. 任务传递 ✅
- `electron_node/services/faster_whisper_vad/asr_worker_manager.py:521`
- `"beam_size": beam_size,` ✅ 正确传递

### 4. Worker 进程接收 ✅ (已修复)
- `electron_node/services/faster_whisper_vad/asr_worker_process.py:180`
- `"beam_size": task.get("beam_size", 10),` ✅ **默认值已改为 10**

### 5. 参数传递 ✅ (已修复)
- `electron_node/services/faster_whisper_vad/asr_worker_manager.py:513-524`
- ✅ **已修复：所有优化参数现在都会传递到 worker 进程**

## 问题分析

### 可能的原因

1. **服务没有重启**：
   - Python 服务可能还在运行旧代码
   - 需要重启服务使新代码生效

2. **默认值问题**：
   - `asr_worker_process.py:180` 中的默认值是 5
   - 虽然 `asr_worker_manager.py` 传递了 `beam_size`，但如果传递失败，会使用默认值 5

3. **参数传递丢失**：
   - 在进程间通信（multiprocessing.Queue）中，如果参数传递失败，会使用默认值

## 解决方案

### 方案 1：更新默认值（推荐）

将 `asr_worker_process.py` 中的默认值从 5 改为 10：

```python
"beam_size": task.get("beam_size", 10),  # 从 5 改为 10
```

### 方案 2：确保参数传递

检查 `asr_worker_manager.py` 中是否正确传递了所有参数，包括新增的优化参数。

### 方案 3：重启服务

确保 Python 服务已重启，使新代码生效。

## 已完成的修复

### ✅ 修复 1：更新默认值
- 将 `asr_worker_process.py:180` 中的默认值从 5 改为 10
- 将 `asr_worker_process.py:153` 日志中的默认值从 5 改为 10

### ✅ 修复 2：修复参数传递
- 在 `asr_worker_manager.py` 中添加了所有优化参数的传递
- 确保 `best_of`, `temperature`, `patience`, `compression_ratio_threshold`, `log_prob_threshold`, `no_speech_threshold` 都能正确传递到 worker 进程

## 验证步骤

1. **重启服务**：确保 Python ASR 服务已重启
2. **检查日志**：查看日志中是否显示 `beam_size=10`（而不是 `beam_size=5`）
3. **测试识别**：进行语音识别测试，确认识别准确度是否提高

## 注意事项

- 如果日志仍然显示 `beam_size=5`，可能是：
  1. 服务没有完全重启（旧进程仍在运行）
  2. 需要清理 Python 缓存（`__pycache__`, `*.pyc`）
  3. 需要强制停止所有 Python 进程后重新启动

