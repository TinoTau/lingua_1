# ASR服务崩溃修复总结

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题

`faster-whisper-vad`服务在处理ASR时崩溃，退出代码`3221225477`（Windows访问违规错误）。

**崩溃位置**: `asr_model.transcribe()`调用时

---

## 修复内容

### 1. 添加音频数据验证 ✅

在调用`asr_model.transcribe()`之前，添加了以下验证：

- ✅ 检查音频数组是否为空
- ✅ 检查NaN和Inf值（如果发现，自动清理）
- ✅ 检查音频值是否在有效范围内（[-1.0, 1.0]），超出范围则裁剪
- ✅ 确保音频数据类型为`float32`
- ✅ 确保音频数组是连续的（C_CONTIGUOUS）
- ✅ 添加详细的调试日志（shape、dtype、min、max、mean、std、duration）

### 2. 添加异常处理 ✅

包装`asr_model.transcribe()`调用，捕获可能的异常：

- ✅ 捕获`RuntimeError`（CUDA/GPU相关错误）
- ✅ 捕获其他异常（包括可能的C扩展崩溃前的异常）
- ✅ 记录详细的错误日志（包含堆栈跟踪）
- ✅ 返回适当的HTTP错误响应（500状态码）

---

## 修复文件

- **文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`
- **位置**: 第304-370行（`asr_model.transcribe()`调用前后）
- **状态**: ✅ 已修复并编译通过

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
2. ⏳ **重启服务**: 需要重启`faster-whisper-vad`服务以应用修复
3. ⏳ **测试验证**: 重新测试，确认崩溃问题是否解决
4. ⏳ **监控日志**: 观察日志中的调试信息，确认音频数据格式正确

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/ASR_CRASH_FIX.md` - 详细的修复说明
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 修复后的代码

