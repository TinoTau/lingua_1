# Opus解码崩溃修复

**日期**: 2025-12-25  
**状态**: ⚠️ **已增强错误处理，但C层面segfault无法完全防止**

---

## 问题描述

**现象**: 服务在处理`job-C9BC0FEE`时崩溃，日志在`pipeline.feed_data()`处截断

**日志**:
```
2025-12-25 08:19:24,561 - audio_decoder - INFO - [job-C9BC0FEE] Calling pipeline.feed_data() with 9305 bytes
[日志截断，无后续记录]
```

**节点端日志**:
```
read ECONNRESET
No available ASR service
```

**说明**: 
- 没有看到watchdog的重启日志，说明是**主进程崩溃**，而不是worker进程崩溃
- 崩溃发生在Opus解码过程中（`pipeline.feed_data()` → `decoder.decode()` → `opus.opus_decode_float()`）

---

## 根本原因分析

### 1. C层面segfault无法被Python捕获 ⚠️

**问题**: 
- `opus.opus_decode_float()`是C扩展函数，如果发生segfault，Python的`try-except`无法捕获
- 即使有全局锁保护，仍然可能发生内存访问违规

**可能原因**:
1. **内存损坏**: Opus解码器状态可能已损坏
2. **并发问题**: 虽然加了锁，但可能还有其他并发访问点
3. **数据问题**: 无效的Opus packet可能导致C库崩溃

### 2. 主进程崩溃影响整个服务 ⚠️

**问题**:
- 如果主进程崩溃，整个服务停止
- Watchdog无法工作（因为Watchdog在主进程中）
- 需要外部监控和重启

---

## 修复方案

### 1. 增强错误处理 ✅

**文件**: `audio_decoder.py`

**修复内容**:
- 添加`BaseException`捕获，捕获所有异常（包括KeyboardInterrupt、SystemExit等）
- 记录详细的错误信息，包括错误类型、输入大小等
- 使用`CRITICAL`级别记录关键错误

**代码**:
```python
try:
    logger.info(f"[{trace_id}] Calling pipeline.feed_data() with {len(audio_bytes)} bytes")
    pipeline.feed_data(audio_bytes)
    logger.info(f"[{trace_id}] pipeline.feed_data() completed successfully")
except Exception as e:
    logger.error(f"[{trace_id}] Error in pipeline.feed_data(): {e}", exc_info=True)
    raise ValueError(f"Failed to feed data to pipeline: {e}")
except BaseException as e:
    # 捕获所有异常，包括KeyboardInterrupt、SystemExit等
    logger.critical(
        f"[{trace_id}] 🚨 CRITICAL: Pipeline feed_data raised BaseException: {e}, "
        f"input_size={len(audio_bytes)}, "
        f"error_type={type(e).__name__}",
        exc_info=True
    )
    raise
```

### 2. 增强主进程异常处理 ✅

**文件**: `faster_whisper_vad_service.py`

**修复内容**:
- 在`process_utterance`中添加顶层异常处理
- 捕获所有异常，包括可能的segfault前的异常
- 返回适当的HTTP错误响应

**代码**:
```python
try:
    audio, sr = decode_audio(req.audio, audio_format, sample_rate, trace_id)
except ValueError as e:
    logger.error(f"[{trace_id}] Audio decoding failed: {e}")
    raise HTTPException(status_code=400, detail=str(e))
except Exception as e:
    # 捕获所有其他异常（包括可能的segfault前的异常）
    logger.critical(
        f"[{trace_id}] 🚨 CRITICAL: Audio decoding raised unexpected exception: {e}, "
        f"error_type={type(e).__name__}",
        exc_info=True
    )
    raise HTTPException(status_code=500, detail=f"Audio decoding error: {str(e)}")
```

---

## 限制和注意事项

### ⚠️ C层面segfault无法完全防止

**限制**:
- 如果`opus.opus_decode_float()`在C层面发生segfault，Python的异常处理**无法捕获**
- 服务仍然可能崩溃，但至少可以记录崩溃前的日志

**建议**:
1. **进程隔离**: 考虑将Opus解码也放到独立的子进程中（类似ASR worker）
2. **外部监控**: 使用外部监控工具（如systemd、supervisor）自动重启服务
3. **日志分析**: 分析崩溃前的日志，找出导致崩溃的特定Opus packet

### ⚠️ 需要进一步调查

**待解决问题**:
1. **为什么特定job会导致崩溃**: `job-C9BC0FEE`的Opus数据有什么特殊之处？
2. **是否所有崩溃都发生在Opus解码**: 还是还有其他崩溃点？
3. **内存问题**: 是否有内存泄漏或内存损坏？

---

## 下一步

1. ✅ **增强错误处理**: 已完成
2. ⚠️ **分析崩溃数据**: 检查`job-C9BC0FEE`的Opus数据
3. ⚠️ **考虑进程隔离**: 将Opus解码放到独立子进程
4. ⚠️ **外部监控**: 配置自动重启机制

---

**修复完成时间**: 2025-12-25  
**状态**: ⚠️ **已增强错误处理，但C层面segfault无法完全防止，需要进一步调查**

