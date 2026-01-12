# Beam Size 修复总结

## 修复时间
2025-12-27

## 问题描述
尽管代码中已经将 `beam_size` 设置为 10，但日志中仍然显示 `beam_size=5`，导致 ASR 识别准确度没有提升。

## 根本原因

1. **默认值冲突**：
   - `asr_worker_process.py` 中的默认值仍然是 5
   - 即使其他位置设置为 10，如果参数传递失败，会回退到默认值 5

2. **参数传递缺失**：
   - `asr_worker_manager.py` 中只传递了基本参数
   - 优化参数（`best_of`, `temperature`, `patience` 等）没有传递到 worker 进程

## 已修复的代码

### 1. `asr_worker_process.py`
- **第 153 行**：日志中的默认值从 5 改为 10
- **第 180 行**：`transcribe_kwargs` 中的默认值从 5 改为 10

### 2. `asr_worker_manager.py`
- **第 513-524 行**：添加了所有优化参数的传递逻辑
- 确保 `best_of`, `temperature`, `patience`, `compression_ratio_threshold`, `log_prob_threshold`, `no_speech_threshold` 都能正确传递

## 验证方法

1. **检查日志**：
   ```bash
   # 查看最新的 ASR 请求日志
   Get-Content "electron_node\services\faster_whisper_vad\logs\faster-whisper-vad-service.log" | Select-String "beam_size" | Select-Object -Last 5
   ```
   应该看到 `beam_size=10`，而不是 `beam_size=5`

2. **测试识别准确度**：
   - 进行语音识别测试
   - 观察同音字错误是否减少
   - 识别准确度应该明显提升

## 下一步

1. **重启服务**：确保 Python ASR 服务使用新代码
2. **清理缓存**：清理 Python 字节码缓存（`__pycache__`, `*.pyc`）
3. **验证效果**：进行实际测试，确认 `beam_size=10` 生效

## 相关文件

- `electron_node/services/faster_whisper_vad/asr_worker_process.py`
- `electron_node/services/faster_whisper_vad/asr_worker_manager.py`
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`
- `electron_node/services/node-inference/src/faster_whisper_vad_client.rs`

