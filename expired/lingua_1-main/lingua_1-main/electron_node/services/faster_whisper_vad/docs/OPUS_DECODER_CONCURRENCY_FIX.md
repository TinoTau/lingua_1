# Opus解码器并发保护修复

**日期**: 2025-12-25  
**状态**: ✅ **已添加全局锁保护**

---

## 问题分析

### 崩溃特征

从测试日志发现：
- 前4个请求成功（segments迭代器修复生效）
- 第5个请求开始出现Opus解码器内存访问违规错误

**错误信息**:
```
OSError: exception: access violation writing 0x0000008953AF0000
ERROR:opus_packet_decoder:Opus decode_float call failed: exception: access violation writing 0x0000008953AF0000, packet_len=51
```

### 根本原因

**问题**: `pyogg`的Opus解码器（底层C库`libopus`）可能不是线程安全的。

**证据**:
1. 错误发生在`opus.opus_decode_float()`调用时
2. 是内存访问违规（access violation），典型的并发访问问题
3. 在并发情况下更容易发生
4. 导致大量连续解码失败（consecutive_fails >= 3）

**崩溃位置**:
```python
# opus_packet_decoder.py - OpusPacketDecoder.decode()
num_samples = opus.opus_decode_float(
    decoder_ptr,
    audio_ptr,
    len(opus_packet),
    pcm_ptr,
    max_frame_samples,
    0  # no FEC
)
```

---

## 实施的修复

### 添加全局锁保护Opus解码调用

**方案**: 使用`threading.Lock`串行化所有`opus_decode_float()`调用

**代码修改**:
```python
# 添加全局锁
import threading
_opus_decode_lock = threading.Lock()

# 在decode方法中使用锁
def decode(self, opus_packet: bytes) -> bytes:
    # ... 验证和准备 ...
    
    # 关键修复：在锁内执行解码调用
    with _opus_decode_lock:
        num_samples = opus.opus_decode_float(
            decoder_ptr,
            audio_ptr,
            len(opus_packet),
            pcm_ptr,
            max_frame_samples,
            0  # no FEC
        )
```

**影响**:
- ✅ **防止崩溃**: 通过串行化Opus解码调用，避免并发访问导致内存访问违规
- ⚠️ **性能影响**: 并发性能会下降（但稳定性更重要）
- ✅ **锁持有时间**: 只包括`opus_decode_float()`调用本身，最小化性能影响

---

## 与ASR锁的区别

### ASR锁 (`asr_model_lock`)
- **保护对象**: Faster Whisper的`transcribe()`调用
- **锁持有时间**: 较长（包括整个transcribe过程，可能几秒）
- **影响**: 显著降低并发性能

### Opus解码锁 (`_opus_decode_lock`)
- **保护对象**: `pyogg`的`opus_decode_float()`调用
- **锁持有时间**: 很短（每次解码调用通常<1ms）
- **影响**: 对并发性能影响较小

---

## 测试验证

### 预期结果

1. **所有请求都能成功完成Opus解码**
2. **不再出现内存访问违规错误**
3. **并发测试通过率提高**

### 验证步骤

1. 重启服务
2. 运行并发测试：`python test_concurrency_fix.py`
3. 检查日志，确认：
   - 没有`access violation`错误
   - 所有请求都能成功解码Opus数据
   - 所有请求都能成功完成处理

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/SEGMENTS_ITERATOR_FIX.md` - Segments迭代器修复
- `electron_node/services/faster_whisper_vad/docs/TEST_RESULTS_SEGMENTS_FIX.md` - Segments修复测试结果
- `electron_node/services/faster_whisper_vad/docs/CRASH_ROOT_CAUSE_ANALYSIS.md` - 崩溃根本原因分析
- `electron_node/services/faster_whisper_vad/opus_packet_decoder.py` - Opus解码器实现

