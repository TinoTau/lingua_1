# Beam Size 完整修复总结

## 问题根源

发现了**所有**设置 `beam_size=5` 的地方：

### 1. ✅ Python 服务（已修复）
- `faster_whisper_vad_service.py:128` - 默认值已改为 10
- `asr_worker_process.py:180` - 默认值已改为 10

### 2. ✅ Rust 客户端（已修复）
- `faster_whisper_vad_client.rs:226` - 已设置为 10

### 3. ❌ **TypeScript/JavaScript Task Router（新发现，已修复）**
- `task-router.ts:473` - **硬编码 `beam_size: 5`** ⚠️
- `task-router.js:419` - **硬编码 `beam_size: 5`** ⚠️

## 问题分析

### 调用链

```
Web Client
  ↓
Scheduler
  ↓
Electron Node (TypeScript/JavaScript)
  ↓ task-router.ts/js (硬编码 beam_size: 5)
  ↓
Rust node-inference (beam_size: 10)
  ↓
Python ASR Service (默认 beam_size: 10)
```

**问题**：如果 Electron Node 的 `task-router` 直接调用 Python ASR Service（HTTP），那么硬编码的 `beam_size: 5` 会覆盖 Python 服务的默认值 `beam_size: 10`！

### 为什么之前没发现？

1. 如果走 Rust node-inference 路径，Rust 客户端会传递 `beam_size: 10`，覆盖 TypeScript 的值
2. 但如果直接调用 Python 服务，TypeScript 的硬编码值会生效
3. 日志显示 `beam_size=5`，说明确实有地方在传递 5

## 已修复的文件

### 1. `task-router.ts`
- **第 473 行**：`beam_size: 5` → `beam_size: 10`

### 2. `task-router.js`
- **第 419 行**：`beam_size: 5` → `beam_size: 10`

## 验证

修复后，所有路径的 `beam_size` 都应该是 10：

1. **TypeScript/JavaScript → Python**：`beam_size: 10` ✅
2. **Rust → Python**：`beam_size: 10` ✅
3. **Python 默认值**：`beam_size: 10` ✅

## 其他文件中的 beam_size=5

以下文件中的 `beam_size=5` **不影响生产代码**：

1. **测试文件**：
   - `test_language_probabilities.py`
   - `test_language_probabilities_http.py`
   - `test_service_unit.py`
   - `test_plan_a_e2e.py`
   - 等等

2. **文档文件**：
   - `docs/ASR_CONTEXT_AND_OUTPUT_LOGGING.md`
   - `docs/ASR_EMPTY_RESULTS_DIAGNOSIS.md`
   - 等等

这些只是测试和文档，不影响实际运行。

## 总结

**`beam_size=5` 是代码中硬编码的，不是默认设置**。现在已经全部修复为 10。

需要重新编译/重启 Electron Node 服务，使 TypeScript/JavaScript 的修改生效。

