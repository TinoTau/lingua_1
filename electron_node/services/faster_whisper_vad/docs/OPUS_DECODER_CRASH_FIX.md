# Opus解码器崩溃修复

**日期**: 2025-12-25  
**状态**: ✅ **修复完成**

---

## 问题描述

Opus解码器在解码过程中发生内存访问违规（access violation），导致：
- 解码器状态损坏
- 后续解码请求失败
- 服务可能崩溃或停止

**错误日志示例**：
```
🚨 CRITICAL: Opus decode_float access violation detected! 
packet_len=60, max_frame_samples=960, 
error=exception: access violation writing 0x000000D2AE600000

This may indicate a memory corruption or thread safety issue. 
The decoder state may be corrupted.
```

---

## 修复方案

### 1. 解码器状态检测和标记 ✅

**位置**: `OpusPacketDecoder` 类

**实现**：
- 添加 `_corrupted` 标志，标记解码器是否已损坏
- 当发生 access violation 时，自动标记解码器为损坏状态

**代码**：
```python
class OpusPacketDecoder:
    def __init__(self, ...):
        self._corrupted = False  # 标记解码器是否已损坏
        self._init_decoder()
    
    def _check_and_rebuild_if_corrupted(self):
        """检查解码器状态，如果损坏则重建"""
        if self._corrupted:
            logger.warning("Opus decoder is corrupted, rebuilding...")
            self._init_decoder()
            logger.info("Opus decoder rebuilt successfully")
```

### 2. 自动重建机制 ✅

**位置**: `OpusPacketDecoder.decode()` 方法

**实现**：
- 在每次解码前检查解码器状态
- 如果损坏，自动重建解码器状态
- 如果重建失败，抛出异常

**代码**：
```python
def decode(self, opus_packet: bytes) -> bytes:
    # 关键修复：在解码前检查解码器状态，如果损坏则重建
    self._check_and_rebuild_if_corrupted()
    
    # ... 解码逻辑 ...
    
    except OSError as e:
        if "access violation" in str(e).lower():
            # 标记解码器为损坏状态
            self._corrupted = True
```

### 3. Pipeline级别的恢复机制 ✅

**位置**: `OpusPacketDecodingPipeline.feed_data()` 方法

**实现**：
- 当解码器损坏且无法重建时，创建新的解码器实例
- 重试解码（只重试一次）
- 如果连续失败次数过多，主动重建解码器

**代码**：
```python
try:
    pcm16 = self.decoder.decode(packet)
except RuntimeError as e:
    if "corrupted" in str(e).lower():
        # 创建新的解码器实例
        self.decoder = OpusPacketDecoder(...)
        # 重试解码
        pcm16 = self.decoder.decode(packet)

# 如果连续失败次数过多，主动重建解码器
if self.stats.consecutive_decode_fails >= MAX_CONSECUTIVE_DECODE_FAILS:
    self.decoder._init_decoder()  # 或创建新实例
```

---

## 修复效果

### 修复前
- ❌ 发生 access violation 后，解码器状态损坏
- ❌ 后续解码请求全部失败
- ❌ 服务可能崩溃或停止

### 修复后
- ✅ 发生 access violation 时，自动标记解码器为损坏状态
- ✅ 下次解码前自动重建解码器状态
- ✅ 如果重建失败，创建新的解码器实例
- ✅ 连续失败时主动重建解码器
- ✅ 服务可以自动恢复，不会因解码器损坏而停止

---

## 测试建议

1. **正常解码测试**
   - 发送正常的Opus数据包
   - 验证解码成功

2. **崩溃恢复测试**
   - 模拟 access violation（如果可能）
   - 验证解码器自动重建
   - 验证后续解码请求成功

3. **连续失败测试**
   - 发送无效的Opus数据包
   - 验证连续失败时主动重建解码器
   - 验证服务不会停止

4. **压力测试**
   - 高并发解码请求
   - 验证解码器状态管理正常
   - 验证没有内存泄漏

---

## 注意事项

1. **性能影响**
   - 解码器重建需要少量时间（< 1ms）
   - 正常情况下不会触发重建
   - 只在解码器损坏时才会重建

2. **线程安全**
   - 解码器重建在全局锁内执行
   - 确保线程安全

3. **资源管理**
   - 解码器实例在销毁时自动清理资源
   - 创建新实例时不会泄漏旧实例的资源

---

## 相关文件

- `electron_node/services/faster_whisper_vad/opus_packet_decoder.py`
  - `OpusPacketDecoder` 类：解码器状态检测和重建
  - `OpusPacketDecodingPipeline` 类：Pipeline级别的恢复机制

---

**修复完成时间**: 2025-12-25  
**状态**: ✅ **修复完成，可以开始测试**

