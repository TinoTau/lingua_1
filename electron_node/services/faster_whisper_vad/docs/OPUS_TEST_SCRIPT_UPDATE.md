# Opus格式测试脚本更新

**日期**: 2025-12-25  
**状态**: ✅ **已更新为使用Opus格式数据**

---

## 更新内容

### 修改文件
- `electron_node/services/faster_whisper_vad/test_concurrency_fix.py`

### 主要变更

1. **使用Opus格式数据** ✅
   - 从PCM16格式改为Opus格式（Plan A格式）
   - 使用`pyogg`库编码PCM16音频为Opus packets
   - 按照Plan A格式添加长度前缀（`uint16_le packet_len + packet_bytes`）

2. **Opus编码实现** ✅
   - 生成正弦波测试音频（440Hz，0.5秒）
   - 使用`opus_encoder_init`初始化编码器
   - 每20ms编码一帧（320 samples at 16kHz）
   - 将所有packets组合成Plan A格式

3. **回退机制** ✅
   - 如果`pyogg`不可用，使用模拟的Plan A格式数据
   - 如果编码失败，使用模拟数据
   - 确保测试脚本可以运行（即使无法生成真实Opus数据）

---

## Plan A格式说明

### 格式结构

```
[uint16_le packet_len_1][packet_bytes_1]
[uint16_le packet_len_2][packet_bytes_2]
...
```

### 示例

对于3个Opus packets：
- Packet 1: 60 bytes
- Packet 2: 65 bytes  
- Packet 3: 58 bytes

Plan A格式数据：
```
[0x3C 0x00] [60 bytes of packet 1]
[0x41 0x00] [65 bytes of packet 2]
[0x3A 0x00] [58 bytes of packet 3]
```

---

## 测试流程

1. **生成测试音频**: 正弦波（440Hz，0.5秒）
2. **编码为Opus**: 使用pyogg编码为多个Opus packets
3. **构建Plan A格式**: 为每个packet添加长度前缀
4. **Base64编码**: 转换为base64字符串
5. **发送请求**: 使用`audio_format="opus"`发送到服务

---

## 预期结果

- ✅ 服务能够正确解码Plan A格式的Opus数据
- ✅ 并发测试能够验证锁机制的有效性
- ✅ 测试更接近实际使用场景

---

## 注意事项

1. **需要pyogg库**: 如果pyogg不可用，会使用模拟数据（可能无法正确解码）
2. **服务必须运行**: 测试需要服务在`http://127.0.0.1:6007`运行
3. **并发测试**: 测试会发送多个并发请求，验证锁机制

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/PLAN_A_Node_RealTime_Opus_Decoding_Technical_Design.md` - Plan A技术设计
- `electron_node/services/faster_whisper_vad/docs/CONCURRENCY_FIX_SUMMARY.md` - 并发保护修复总结
- `electron_node/services/faster_whisper_vad/test_concurrency_fix.py` - 更新后的测试脚本

