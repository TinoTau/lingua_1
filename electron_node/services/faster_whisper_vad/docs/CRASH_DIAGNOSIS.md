# ASR服务崩溃诊断报告

**日期**: 2025-12-25  
**状态**: ⚠️ **服务仍然崩溃，需要进一步诊断**

---

## 问题描述

用户报告服务仍然崩溃，但从日志来看：

1. **最后一条成功日志**: `16:07:51.286Z` - `200 OK` (job-D9DB9D27)
2. **之后没有新日志**: 说明服务可能在后续请求中崩溃
3. **节点端状态**: `"asr","ready":false,"reason":"gpu_impl_not_running"` - 服务未运行

---

## 可能的原因

### 1. C扩展层面的崩溃

如果Faster Whisper的C扩展在更深层次崩溃（例如内存访问违规），Python异常处理**无法捕获**。这种情况下：

- ✅ 服务会直接退出
- ❌ 不会留下Python异常日志
- ❌ 不会触发`try-except`块

### 2. CUDA/GPU内存问题

- GPU内存不足
- CUDA驱动错误
- 内存泄漏导致后续请求崩溃

### 3. 并发问题

- 多个请求同时处理时发生竞争条件
- 共享状态（如模型实例）的并发访问问题

### 4. 特定音频数据触发崩溃

- 某些特定的音频数据格式或内容可能触发Faster Whisper的bug
- 音频长度、采样率或其他参数组合导致崩溃

---

## 已实施的修复

### 1. 音频数据验证 ✅

- 检查空数组
- 检查NaN/Inf值
- 检查值范围
- 确保数据类型和连续性

### 2. 异常处理 ✅

- 捕获`RuntimeError`
- 捕获其他异常
- 记录详细错误日志

### 3. 增强日志 ✅

- 将调试日志改为`info`级别
- 在`transcribe()`调用前后记录关键信息
- 记录音频数据验证结果

---

## 下一步诊断措施

### 1. 启用更详细的日志

已修改代码，将音频数据验证日志从`debug`改为`info`，并添加`transcribe()`调用前后的日志。

### 2. 检查服务进程状态

需要检查：
- 服务进程是否仍在运行
- 如果已退出，退出代码是什么
- 是否有Windows事件日志记录

### 3. 添加进程监控

考虑添加：
- 进程健康检查
- 自动重启机制
- 崩溃转储（core dump）

### 4. 测试特定场景

- 测试不同长度的音频
- 测试不同的音频内容
- 测试并发请求
- 测试长时间运行

---

## 建议的临时解决方案

### 1. 使用进程包装器

使用一个包装器进程来监控Python服务，如果崩溃则自动重启。

### 2. 限制并发请求

限制同时处理的请求数量，避免并发问题。

### 3. 添加超时机制

为`transcribe()`调用添加超时，如果超时则终止并重启服务。

### 4. 使用CPU模式

如果GPU模式不稳定，可以尝试使用CPU模式（虽然性能会下降）。

---

## 代码修改

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**修改内容**:
1. 将音频数据验证日志从`logger.debug`改为`logger.info`
2. 在`transcribe()`调用前添加详细日志
3. 在`transcribe()`调用后添加成功日志

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/ASR_CRASH_FIX.md` - 初始修复说明
- `electron_node/services/faster_whisper_vad/docs/ASR_CRASH_FIX_SUMMARY.md` - 修复总结
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 修复后的代码

