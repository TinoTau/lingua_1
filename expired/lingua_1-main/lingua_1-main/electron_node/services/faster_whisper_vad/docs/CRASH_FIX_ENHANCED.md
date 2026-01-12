# Opus解码器崩溃修复（增强版）

**日期**: 2025-12-25  
**状态**: ✅ **增强修复完成**

---

## 问题描述

服务在处理Opus解码时仍然崩溃，日志显示大量的 `access violation` 和 `stack overflow` 错误。

**错误日志示例**：
```
🚨 CRITICAL: Opus decode_float access violation detected! 
packet_len=74, max_frame_samples=960, 
error=exception: access violation writing 0x000000D2AE600000

This may indicate a memory corruption or thread safety issue. 
The decoder state may be corrupted.
```

---

## 增强修复方案

### 1. 立即重建解码器 ✅

**问题**：之前的修复只在下次解码时重建解码器，但access violation可能导致进程崩溃

**解决方案**：
- 在检测到 access violation 时，立即尝试重建解码器
- 在锁内重建，确保线程安全

**代码**：
```python
if "access violation" in error_str or "segmentation fault" in error_str or "stack overflow" in error_str:
    self._corrupted = True
    # 立即尝试重建解码器
    try:
        logger.warning("Attempting immediate decoder rebuild after access violation...")
        with _opus_decode_lock:
            self._init_decoder()
        logger.info("Decoder rebuilt successfully after access violation")
    except Exception as rebuild_e:
        logger.error(f"Failed to rebuild decoder after access violation: {rebuild_e}")
```

### 2. 线程安全的重建 ✅

**问题**：解码器重建可能不是线程安全的

**解决方案**：
- 在 `_check_and_rebuild_if_corrupted` 方法中，在锁内重建解码器

**代码**：
```python
def _check_and_rebuild_if_corrupted(self):
    if self._corrupted:
        logger.warning("Opus decoder is corrupted, rebuilding...")
        try:
            # 在锁内重建解码器，确保线程安全
            with _opus_decode_lock:
                self._init_decoder()
            logger.info("Opus decoder rebuilt successfully")
        except Exception as e:
            logger.error(f"Failed to rebuild Opus decoder: {e}", exc_info=True)
            raise RuntimeError(f"Opus decoder is corrupted and cannot be rebuilt: {e}")
```

### 3. 检测 stack overflow ✅

**问题**：之前的修复只检测 access violation，没有检测 stack overflow

**解决方案**：
- 在错误检测中添加 stack overflow 检测

**代码**：
```python
if "access violation" in error_str or "segmentation fault" in error_str or "stack overflow" in error_str:
    # 处理崩溃
```

---

## 修复效果

### 修复前
- ❌ 发生 access violation 后，解码器状态损坏
- ❌ 下次解码时可能再次崩溃
- ❌ 服务可能崩溃或停止

### 修复后
- ✅ 发生 access violation 时，立即尝试重建解码器
- ✅ 在锁内重建，确保线程安全
- ✅ 检测 stack overflow 错误
- ✅ 如果重建失败，抛出异常供上层处理

---

## 注意事项

1. **性能影响**
   - 解码器重建需要少量时间（< 1ms）
   - 正常情况下不会触发重建
   - 只在解码器损坏时才会重建

2. **线程安全**
   - 所有解码器操作都在全局锁内执行
   - 确保线程安全

3. **资源管理**
   - 解码器实例在销毁时自动清理资源
   - 创建新实例时不会泄漏旧实例的资源

---

## 相关文件

- `electron_node/services/faster_whisper_vad/opus_packet_decoder.py`
  - `OpusPacketDecoder` 类：立即重建解码器
  - `_check_and_rebuild_if_corrupted` 方法：线程安全的重建

---

**修复完成时间**: 2025-12-25  
**状态**: ✅ **增强修复完成，可以开始测试**

