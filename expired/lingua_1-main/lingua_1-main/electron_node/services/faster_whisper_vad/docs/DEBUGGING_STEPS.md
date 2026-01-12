# 调试步骤指南

**日期**: 2025-12-24  
**问题**: 404/400错误，数据格式不一致  

---

## 立即执行的调试步骤

### 步骤1: 检查Web端发送的数据格式

**在浏览器控制台中添加日志**：

```typescript
// 在 sendUtterance() 方法中添加
console.log('=== Sending Utterance ===');
console.log('Using encodePackets:', encoder.encodePackets && typeof encoder.encodePackets === 'function');
console.log('Audio data length:', audioData.length);
console.log('Opus packets count:', opusPackets.length);
console.log('First packet length:', opusPackets[0]?.length);
console.log('Total encoded size:', encodedAudio.length);
console.log('First 10 bytes (hex):', Array.from(encodedAudio.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '));
```

### 步骤2: 检查服务端接收的数据格式

**在 audio_decoder.py 中添加日志**：

```python
def decode_opus_audio(audio_bytes: bytes, sample_rate: int, trace_id: str):
    # 添加数据格式检查日志
    logger.info(f"[{trace_id}] Received audio data: {len(audio_bytes)} bytes")
    if len(audio_bytes) >= 10:
        first_10_bytes = audio_bytes[:10]
        hex_str = ' '.join([f'{b:02x}' for b in first_10_bytes])
        logger.info(f"[{trace_id}] First 10 bytes (hex): {hex_str}")
        
        # 检查是否是packet格式
        if len(audio_bytes) >= 2:
            packet_len = struct.unpack_from("<H", audio_bytes, 0)[0]
            logger.info(f"[{trace_id}] First 2 bytes as uint16_le: {packet_len}")
```

### 步骤3: 检查Base64编码/解码

**在调度服务器中添加日志**：

检查`utterance.rs`中的Base64解码逻辑，确保数据没有被修改。

### 步骤4: 检查节点端转发数据

**在 task-router.ts 中添加日志**：

```typescript
// 在 routeASRTask() 方法中添加
logger.debug({
  serviceId: endpoint.serviceId,
  audioFormat: task.audio_format,
  audioSize: task.audio?.length,
  audioPreview: task.audio?.substring(0, 20), // Base64预览
}, 'Forwarding audio data to service');
```

---

## 预期发现

### 如果Web端问题：
- 日志显示某些请求使用了`encode()`而不是`encodePackets()`
- 数据格式不一致

### 如果传输问题：
- Web端发送的数据格式正确
- 但服务端接收到的数据格式不正确
- 说明数据在传输过程中被修改

### 如果Base64问题：
- Base64编码/解码导致数据格式变化

---

## 修复优先级

1. **高优先级**：修复Web端回退逻辑，确保始终使用`encodePackets()`
2. **中优先级**：增强服务端数据格式检测和日志
3. **低优先级**：检查Base64编码/解码逻辑

