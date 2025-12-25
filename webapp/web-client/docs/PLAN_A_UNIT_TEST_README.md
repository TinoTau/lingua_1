# Plan A Opus Packet格式单元测试

**日期**: 2025-12-24  
**测试文件**: `tests/phase2/plan_a_opus_packet_test.ts`

---

## 1. 测试概述

本测试套件验证Web端按照Plan A规范发送Opus packet的功能，确保与节点端的解码规范兼容。

---

## 2. 测试内容

### 2.1 `encodePackets()` 方法测试

- ✅ **单帧packet**: 验证单个20ms帧编码为1个packet
- ✅ **多帧packet**: 验证多个帧编码为多个packet
- ✅ **不完整帧处理**: 验证不完整帧会被填充为完整帧
- ✅ **空输入处理**: 验证空输入返回空数组

### 2.2 Plan A格式打包测试

- ✅ **单packet打包**: 验证单个packet正确添加长度前缀
- ✅ **多packet打包**: 验证多个packet正确打包
- ✅ **空packet跳过**: 验证空packet被正确跳过
- ✅ **最大packet大小**: 验证支持最大65535字节的packet

### 2.3 端到端测试

- ✅ **完整流程**: 验证从音频编码到Plan A格式打包的完整流程
- ✅ **节点端兼容性**: 验证打包格式可以被节点端PacketFramer正确解析
- ✅ **Base64编码兼容性**: 验证打包后的数据可以正确进行Base64编码/解码

---

## 3. 运行测试

### 3.1 运行所有测试

```bash
cd webapp/web-client
npm test
```

### 3.2 运行Plan A测试

```bash
cd webapp/web-client
npm test -- plan_a_opus_packet_test
```

### 3.3 监视模式

```bash
cd webapp/web-client
npm run test:watch -- plan_a_opus_packet_test
```

### 3.4 覆盖率测试

```bash
cd webapp/web-client
npm run test:coverage -- plan_a_opus_packet_test
```

---

## 4. 测试覆盖

### 4.1 功能覆盖

| 功能 | 测试用例数 | 状态 |
|------|-----------|------|
| `encodePackets()` 方法 | 4 | ✅ |
| Plan A格式打包 | 4 | ✅ |
| 端到端流程 | 3 | ✅ |
| **总计** | **11** | ✅ |

### 4.2 边界情况

- ✅ 空输入
- ✅ 不完整帧
- ✅ 最大packet大小（65535字节）
- ✅ 多个packet连续打包
- ✅ Base64编码/解码

---

## 5. 测试验证点

### 5.1 格式验证

- ✅ 每个packet前有2字节长度前缀（uint16_le）
- ✅ 长度前缀正确（little-endian）
- ✅ 数据内容完整
- ✅ 空packet被跳过

### 5.2 兼容性验证

- ✅ 节点端PacketFramer可以正确解析
- ✅ Base64编码/解码不丢失数据
- ✅ 与节点端解码规范完全兼容

---

## 6. 预期结果

所有测试应该通过，验证：

1. ✅ `encodePackets()` 方法正确返回packet数组
2. ✅ Plan A格式打包正确（每个packet前有长度前缀）
3. ✅ 节点端可以正确解析打包后的数据
4. ✅ Base64编码/解码不丢失数据

---

## 7. 相关文档

- `electron_node/services/faster_whisper_vad/docs/PLAN_A_Node_RealTime_Opus_Decoding_Technical_Design.md`
- `electron_node/services/faster_whisper_vad/opus_packet_decoder.py`
- `webapp/web-client/docs/PLAN_A_OPUS_PACKET_FORMAT_IMPLEMENTATION.md`

---

**测试状态**: ✅ 已创建  
**运行状态**: ⚠️ 待运行

