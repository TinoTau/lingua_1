# 服务死锁问题修复

**日期**: 2025-12-24  
**问题**: 服务在测试后停止响应  
**原因**: VAD推理时在持有锁的情况下调用ONNX推理，导致死锁

---

## 问题分析

### 问题现象

1. 服务在测试后无法响应健康检查请求
2. 服务进程仍在运行，但端口连接被拒绝
3. 日志显示最后一条请求处理完成，但后续请求无法处理

### 根本原因

在 `vad.py` 的 `detect_voice_activity_frame()` 函数中，ONNX推理（`vad_session.run()`）在持有锁（`vad_state.lock`）的情况下执行：

```python
with vad_state.lock:
    # ... 准备输入 ...
    outputs = vad_session.run(None, inputs)  # ❌ 在锁内执行ONNX推理
    # ... 更新状态 ...
```

**问题**：
- ONNX Runtime的推理可能涉及GPU操作，可能阻塞
- 如果多个请求同时到达，第一个请求持有锁并执行推理，其他请求等待锁
- 如果ONNX推理阻塞或耗时过长，会导致所有后续请求被阻塞
- 这可能导致服务无法响应新的请求，包括健康检查

### 解决方案

将ONNX推理移到锁外执行，只在锁内进行状态的读取和更新：

```python
# 在锁内读取状态
with vad_state.lock:
    if vad_state.hidden_state is None:
        state_array = np.zeros((2, 1, 128), dtype=np.float32)
    else:
        state_array = vad_state.hidden_state.reshape(2, 1, 128).astype(np.float32)

# 在锁外执行ONNX推理（避免阻塞）
outputs = vad_session.run(None, inputs)

# 在锁内更新状态
with vad_state.lock:
    if len(outputs) > 1:
        new_state = outputs[1]
        vad_state.hidden_state = new_state.reshape(2, 128)
```

**优点**：
- 锁的持有时间最小化
- ONNX推理不会阻塞其他请求获取锁
- 减少死锁风险

---

## 修复内容

### 修改文件

- `vad.py`: 修复 `detect_voice_activity_frame()` 函数的锁使用

### 修改详情

1. **锁的范围缩小**：只在读取和更新状态时持有锁
2. **ONNX推理移出锁**：在锁外执行推理，避免阻塞
3. **状态更新保护**：在锁内更新隐藏状态，保证线程安全

---

## 测试验证

### 测试步骤

1. 重启服务
2. 运行稳定性测试（多次连续请求）
3. 验证服务在测试后仍能响应健康检查

### 预期结果

- ✅ 服务在测试后仍能正常响应
- ✅ 健康检查请求不会超时
- ✅ 多个并发请求能正常处理

---

## 相关文档

- `vad.py` - VAD状态管理和语音活动检测
- `docs/SERVICE_CRASH_ANALYSIS.md` - 服务崩溃分析
- `docs/TEST_RESULTS_AFTER_FIX.md` - 修复后的测试结果

---

**修复状态**: ✅ **已修复**  
**测试状态**: ⚠️ **待验证**

