# Plan A Opus Packet格式实现

**日期**: 2025-12-24  
**状态**: ✅ 已实现

---

## 1. 概述

本文档描述了Web端如何按照Plan A规范发送Opus音频数据，确保与节点端的解码规范兼容。

---

## 2. Plan A协议规范

### 2.1 协议格式

根据节点端的设计文档（`PLAN_A_Node_RealTime_Opus_Decoding_Technical_Design.md`），Plan A格式要求：

```
| Field        | Size       | Description |
|-------------|------------|-------------|
| packet_len  | uint16_le  | Opus packet 字节长度 |
| packet_data | N bytes    | 单个完整 Opus packet |
| seq (可选)  | uint32_le  | 序号（调试/诊断） |
```

### 2.2 音频参数

- **Sample Rate**: 16,000 Hz
- **Channels**: 1 (mono)
- **Frame Duration**: 20 ms
- **PCM Format**: int16 little-endian

---

## 3. Web端实现

### 3.1 修改内容

#### 3.1.1 Opus编码器增强

**文件**: `webapp/web-client/src/audio_codec.ts`

添加了 `encodePackets()` 方法，返回packet数组而不是合并后的单个数组：

```typescript
async encodePackets(audioData: Float32Array): Promise<Uint8Array[]> {
  // 按20ms帧编码，返回packet数组
  // 每个packet对应一个20ms的音频帧
}
```

#### 3.1.2 发送逻辑修改

**文件**: `webapp/web-client/src/websocket_client.ts`

修改了 `sendUtterance()` 方法，按照Plan A格式打包：

```typescript
// 1. 获取packet数组
const opusPackets = await encoder.encodePackets(audioData);

// 2. 为每个packet添加长度前缀（uint16_le）
for (const packet of opusPackets) {
  const lenBuffer = new ArrayBuffer(2);
  const lenView = new DataView(lenBuffer);
  lenView.setUint16(0, packet.length, true); // little-endian
  
  // 3. 合并所有packet数据
  // packet_len (2 bytes) + packet_data (N bytes)
}
```

### 3.2 数据流程

```
[Web端录音]
  ↓ Float32Array (16kHz, mono)
  ↓ Opus编码（20ms帧）
  ↓ Uint8Array[] (packet数组)
  ↓ 添加长度前缀 (uint16_le)
  ↓ 合并所有packet
  ↓ Base64编码
  ↓ JSON消息发送
  ↓
[调度服务器]
  ↓ 转发（不修改数据）
  ↓
[节点端]
  ↓ Base64解码
  ↓ PacketFramer解析
  ↓ Opus解码
  ↓ PCM16
```

---

## 4. 兼容性

### 4.1 向后兼容

- ✅ 如果编码器不支持 `encodePackets()` 方法，会回退到旧方法
- ⚠️ 回退方法可能无法正确工作（因为无法确定packet边界）
- ✅ 建议所有Opus编码器都实现 `encodePackets()` 方法

### 4.2 节点端兼容

- ✅ 节点端已实现Plan A解码（`opus_packet_decoder.py`）
- ✅ 节点端会自动检测packet格式
- ✅ 如果格式不正确，节点端会报错（不会静默失败）

---

## 5. 测试验证

### 5.1 单元测试

需要添加测试验证：
1. ✅ `encodePackets()` 方法返回正确的packet数组
2. ✅ 每个packet的长度前缀正确（uint16_le）
3. ✅ 节点端能够正确解析和解码

### 5.2 集成测试

需要验证：
1. ✅ Web端发送的数据能被节点端正确解码
2. ✅ 解码后的音频质量正常
3. ✅ 延迟在可接受范围内

---

## 6. 注意事项

### 6.1 性能考虑

- 每个packet添加2字节长度前缀，开销很小
- Base64编码会增加约33%的数据大小（这是JSON传输的固有开销）

### 6.2 错误处理

- 如果packet长度为0，会跳过该packet
- 如果编码器不支持 `encodePackets()`，会回退到旧方法并发出警告
- 节点端会验证packet格式，如果格式错误会报错

---

## 7. 后续改进

### 7.1 可选功能

- [ ] 添加序列号（seq）支持（用于调试）
- [ ] 支持Binary Frame协议（减少Base64开销）
- [ ] 添加packet统计信息（用于监控）

### 7.2 优化建议

- [ ] 考虑使用Binary Frame协议替代JSON+Base64
- [ ] 添加packet压缩（如果需要）
- [ ] 优化大数组的Base64编码性能

---

## 8. 相关文档

- `electron_node/services/faster_whisper_vad/docs/PLAN_A_Node_RealTime_Opus_Decoding_Technical_Design.md`
- `electron_node/services/faster_whisper_vad/docs/SOLUTION_ANALYSIS_PLAN_A.md`
- `electron_node/services/faster_whisper_vad/opus_packet_decoder.py`

---

**实现状态**: ✅ 已完成  
**测试状态**: ⚠️ 待测试  
**文档状态**: ✅ 已完成

