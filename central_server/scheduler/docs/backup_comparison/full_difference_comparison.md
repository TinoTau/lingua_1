# 备份代码 vs 当前代码完整差异对比

**日期**: 2026-01-23  
**目的**: 全面对比备份代码和当前代码的所有差异，找出可能影响ASR性能的因素

---

## 一、已调整的差异 ✅

### 1.1 beam_size配置

| 文件 | 备份代码 | 当前代码（调整前） | 当前代码（调整后） |
|------|---------|------------------|------------------|
| `config.py` | `beam_size=10` | `beam_size=5` | ✅ `beam_size=10` |
| `asr_worker_process.py` | `beam_size=10` | `beam_size=5` | ✅ `beam_size=10` |
| `api_models.py` | `beam_size=10` | `beam_size=5` | ✅ `beam_size=10` |

### 1.2 预加载逻辑

| 特性 | 备份代码 | 当前代码（调整前） | 当前代码（调整后） |
|------|---------|------------------|------------------|
| **ASR预加载/预热** | ❌ 无 | ✅ 有 | ✅ **已移除** |
| **ready_event** | ❌ 无 | ✅ 有 | ✅ **已移除** |
| **model_ready_event** | ❌ 无 | ✅ 有 | ✅ **已移除** |

---

## 二、其他发现的差异 ⚠️

### 2.1 依赖版本差异

| 依赖 | 备份代码 | 当前代码 | 影响 |
|------|---------|---------|------|
| **onnxruntime-gpu** | `>=1.16.0` | `==1.23.2` | ⚠️ 可能影响VAD性能 |
| **faster-whisper** | `>=1.0.0` | `>=1.0.0` | ✅ 相同 |

**潜在影响**:
- ONNX Runtime版本差异可能影响VAD模型的推理性能
- 但VAD处理时间通常很短（<1秒），不太可能是主要瓶颈

### 2.2 VAD预热差异

**备份代码** (`api_routes.py:startup`):
```python
async def startup():
    """启动ASR Worker Manager"""
    manager = get_asr_worker_manager()
    await manager.start()
    logger.info("✅ ASR Worker Manager started on startup")
```

**当前代码** (`api_routes.py:startup`):
```python
async def startup():
    """启动ASR Worker Manager"""
    # 预热VAD模型（避免首次推理慢，触发ONNX Runtime的JIT编译和CUDA上下文初始化）
    try:
        logger.info("[VAD_PRELOAD] Warming up VAD model...")
        from vad import detect_voice_activity_frame
        from config import VAD_FRAME_SIZE
        import numpy as np
        test_frame = np.zeros(VAD_FRAME_SIZE, dtype=np.float32)
        _ = detect_voice_activity_frame(test_frame)
        logger.info("[VAD_PRELOAD] VAD model warmup completed")
    except Exception as e:
        logger.warning(f"[VAD_PRELOAD] VAD warmup failed (non-fatal): {e}")
    
    manager = get_asr_worker_manager()
    await manager.start()
    logger.info("[ASR_PRELOAD] FastAPI startup: worker ready...")
    logger.info("✅ ASR Worker Manager started on startup")
    print("[SERVICE_READY]", flush=True)
```

**差异**:
- 备份代码：无VAD预热
- 当前代码：有VAD预热

**影响**:
- VAD预热可能影响启动时间，但不应该影响ASR处理性能
- 备份代码没有VAD预热，但性能仍然很好

---

## 三、关键差异总结

### 3.1 已调整（关键）✅

1. **beam_size**: 从5改为10
2. **ASR预加载**: 已移除
3. **ready_event**: 已移除

### 3.2 已调整（次要）✅

1. ✅ **VAD预热**: 已移除（按照备份代码）
2. ✅ **性能检测日志**: 已移除（按照备份代码）
3. ✅ **health_check**: 已简化（按照备份代码）

### 3.3 未调整（环境相关）⚠️

1. **onnxruntime-gpu版本**: 备份代码 `>=1.16.0`，当前代码 `==1.23.2`
   - 可能影响VAD性能，但VAD处理时间通常很短
   - 建议：如果性能仍不理想，可以尝试降级到 `>=1.16.0`

---

**文档版本**: v1.0  
**最后更新**: 2026-01-23  
**状态**: 归档文档（历史记录）
