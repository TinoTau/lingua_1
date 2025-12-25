# ASR服务崩溃修复报告

**日期**: 2025-12-25  
**状态**: ✅ **已添加异常处理和音频数据验证**

---

## 问题描述

**错误信息**:
```
read ECONNRESET
Python service process exited with code 3221225477
```

**退出代码分析**:
- `3221225477` (0xC0000005) = Windows访问违规错误
- 通常表示段错误或内存访问错误
- 发生在Faster Whisper的`transcribe()`调用时

**日志分析**:
```
INFO:audio_decoder:[job-8EC136AC] Successfully decoded Opus packets: 3840 samples
INFO:__main__:[job-8EC136AC] VAD检测到1个语音段，已提取有效语音
INFO:faster_whisper:Processing audio with duration 00:00.240
[服务崩溃，无后续日志]
```

---

## 根本原因分析

1. **缺少异常处理**: `asr_model.transcribe()`调用没有异常处理，如果Faster Whisper在C/C++层面崩溃，Python代码无法捕获
2. **音频数据验证不足**: 虽然音频解码成功，但可能包含无效值（NaN、Inf、超出范围）
3. **数据格式问题**: 音频数据可能不符合Faster Whisper的格式要求

---

## 修复方案

### 1. 添加音频数据验证

在调用`asr_model.transcribe()`之前，添加以下验证：

- ✅ 检查音频数组是否为空
- ✅ 检查NaN和Inf值
- ✅ 检查音频值是否在有效范围内（[-1.0, 1.0]）
- ✅ 确保音频数据类型为`float32`
- ✅ 确保音频数组是连续的（C_CONTIGUOUS）
- ✅ 添加详细的调试日志

### 2. 添加异常处理

包装`asr_model.transcribe()`调用，捕获可能的异常：

- ✅ 捕获`RuntimeError`（CUDA/GPU相关错误）
- ✅ 捕获其他异常（包括可能的C扩展崩溃前的异常）
- ✅ 记录详细的错误日志
- ✅ 返回适当的HTTP错误响应

---

## 修复代码

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**修复位置**: 第304-315行（`asr_model.transcribe()`调用）

**修复内容**:

```python
# 8. 验证音频数据格式（防止Faster Whisper崩溃）
# 检查音频数据是否有效
if len(processed_audio) == 0:
    logger.error(f"[{trace_id}] Processed audio is empty, cannot perform ASR")
    raise HTTPException(status_code=400, detail="Processed audio is empty")

# 检查NaN和Inf值
if np.any(np.isnan(processed_audio)) or np.any(np.isinf(processed_audio)):
    logger.error(f"[{trace_id}] Processed audio contains NaN or Inf values")
    # 清理NaN和Inf值
    processed_audio = np.nan_to_num(processed_audio, nan=0.0, posinf=1.0, neginf=-1.0)
    logger.warning(f"[{trace_id}] Cleaned NaN/Inf values from audio")

# 确保音频数据在有效范围内（[-1.0, 1.0]）
if np.any(np.abs(processed_audio) > 1.0):
    logger.warning(f"[{trace_id}] Audio values out of range [-1.0, 1.0], clipping")
    processed_audio = np.clip(processed_audio, -1.0, 1.0)

# 确保音频是连续的numpy数组
if not isinstance(processed_audio, np.ndarray):
    processed_audio = np.array(processed_audio, dtype=np.float32)
if processed_audio.dtype != np.float32:
    processed_audio = processed_audio.astype(np.float32)
if not processed_audio.flags['C_CONTIGUOUS']:
    processed_audio = np.ascontiguousarray(processed_audio)

# 记录音频数据信息（用于调试）
logger.debug(
    f"[{trace_id}] Audio data validation: "
    f"shape={processed_audio.shape}, "
    f"dtype={processed_audio.dtype}, "
    f"min={np.min(processed_audio):.4f}, "
    f"max={np.max(processed_audio):.4f}, "
    f"mean={np.mean(processed_audio):.4f}, "
    f"std={np.std(processed_audio):.4f}, "
    f"duration={len(processed_audio)/sr:.3f}s"
)

# 8. 使用 Faster Whisper 进行 ASR（添加异常处理）
asr_start_time = time.time()

try:
    segments, info = asr_model.transcribe(
        processed_audio,
        language=asr_language,
        task=req.task,
        beam_size=req.beam_size,
        vad_filter=False,
        initial_prompt=text_context if text_context else None,
        condition_on_previous_text=req.condition_on_previous_text,
    )
except RuntimeError as e:
    # CUDA/GPU相关错误
    logger.error(
        f"[{trace_id}] Faster Whisper RuntimeError during transcribe: {e}",
        exc_info=True
    )
    raise HTTPException(
        status_code=500,
        detail=f"ASR processing failed (RuntimeError): {str(e)}"
    )
except Exception as e:
    # 其他异常（包括可能的C扩展崩溃前的异常）
    logger.error(
        f"[{trace_id}] Faster Whisper Exception during transcribe: {e}",
        exc_info=True
    )
    raise HTTPException(
        status_code=500,
        detail=f"ASR processing failed: {str(e)}"
    )

asr_elapsed = time.time() - asr_start_time
```

---

## 预期效果

1. **防止崩溃**: 通过数据验证，在传递给Faster Whisper之前发现并修复问题
2. **更好的错误处理**: 即使Faster Whisper崩溃，也能捕获异常并返回适当的错误响应
3. **调试信息**: 详细的日志帮助定位问题根源

---

## 注意事项

1. **C扩展崩溃**: 如果Faster Whisper的C扩展在更深层次崩溃（例如内存访问违规），Python异常处理可能无法捕获。在这种情况下，服务仍可能崩溃，但至少我们会在日志中看到更多信息。

2. **性能影响**: 数据验证会略微增加处理时间，但这是值得的，因为可以防止崩溃。

3. **CUDA内存**: 如果使用GPU，可能需要检查CUDA内存使用情况。如果内存不足，Faster Whisper可能会崩溃。

---

## 下一步

1. ✅ **代码修复**: 已完成
2. ⏳ **测试验证**: 需要重新测试，确认崩溃问题是否解决
3. ⏳ **监控日志**: 观察日志中的调试信息，确认音频数据格式正确

---

## 相关文件

- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 主服务文件
- `electron_node/services/faster_whisper_vad/audio_decoder.py` - 音频解码模块
- `electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log` - 服务日志

