# ASR服务并发保护修复总结

**日期**: 2025-12-25  
**状态**: ✅ **已添加并发保护锁**

---

## 问题分析

### 崩溃原因：并发访问问题

**根本原因**:
- `asr_model`是全局共享的`WhisperModel`实例
- FastAPI默认是异步的，多个请求可能同时调用`asr_model.transcribe()`
- **Faster Whisper的CUDA实现不是线程安全的**

**证据**:
1. 从Rust实现来看，每次调用都创建新的`state`，这是线程安全的做法
2. Python的`faster-whisper`库可能没有实现类似的线程安全机制
3. CUDA上下文通常不是线程安全的，需要串行化访问
4. 崩溃发生在`transcribe()`调用时，且退出代码是访问违规错误

---

## 实施的修复

### 1. 添加并发保护锁 ✅

**方案**: 使用`threading.Lock`串行化`transcribe()`调用

**代码位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**修改内容**:
```python
# 全局锁
asr_model_lock = threading.Lock()

# 在transcribe调用时使用锁
lock_acquire_start = time.time()
try:
    with asr_model_lock:
        # 记录锁等待时间
        lock_acquire_time = time.time() - lock_acquire_start
        logger.info(f"[{trace_id}] Acquired asr_model_lock (waited {lock_acquire_time:.3f}s)")
        
        # 调用transcribe
        segments, info = asr_model.transcribe(...)
        
        # 记录总锁时间
        lock_total_time = time.time() - lock_acquire_start
        logger.info(f"[{trace_id}] Released asr_model_lock (total: {lock_total_time:.3f}s)")
except RuntimeError as e:
    # 错误处理...
except Exception as e:
    # 错误处理...
```

**影响**:
- ✅ **防止并发崩溃**: 通过串行化transcribe调用，避免CUDA上下文冲突
- ⚠️ **性能影响**: 并发性能会下降（但稳定性更重要）
- ✅ **锁持有时间**: 只包括transcribe调用本身，最小化性能影响

### 2. 增强诊断日志 ✅

**添加的日志**:
- 锁获取尝试时间
- 锁等待时间（如果有其他请求在等待）
- transcribe调用时间
- 锁总持有时间

**目的**: 帮助诊断：
- 是否有并发请求在等待锁
- transcribe调用本身是否耗时过长
- 崩溃是否发生在锁内或锁外

---

## 预期效果

1. **防止并发崩溃**: ✅ 通过串行化transcribe调用，避免CUDA上下文冲突
2. **更好的诊断**: ✅ 详细的日志帮助定位问题
3. **性能影响**: ⚠️ 并发性能会下降，但稳定性更重要

---

## 验证步骤

1. ✅ **代码修复**: 已完成
2. ⏳ **重启服务**: 需要重启服务以应用修复
3. ⏳ **重新测试**: 运行集成测试，观察：
   - 是否还有崩溃
   - 日志中的锁等待时间
   - 是否有并发请求

---

## 如果仍然崩溃

如果添加锁后仍然崩溃，可能的原因：

1. **崩溃发生在锁外**: 检查日志，看崩溃是否发生在锁获取之前
2. **CUDA驱动问题**: 可能需要更新CUDA驱动或faster-whisper版本
3. **内存问题**: 可能需要限制音频长度或使用更小的模型
4. **特定音频触发**: 某些音频数据可能触发bug

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/CRASH_ROOT_CAUSE_ANALYSIS.md` - 根本原因分析
- `electron_node/services/faster_whisper_vad/docs/ASR_CRASH_FIX.md` - 初始修复说明
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 修复后的代码

