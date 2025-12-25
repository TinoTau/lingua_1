# Opus 比特率配置

**日期**: 2025-12-25  
**状态**: ✅ **已配置推荐比特率**

---

## 配置总结

### Web 端 ✅

**文件**: `webapp/web-client/src/websocket_client.ts`

**配置**:
```typescript
const codecConfig: AudioCodecConfig = {
  codec: 'opus',
  sampleRate: 16000,
  channelCount: 1,
  frameSizeMs: 20,
  application: 'voip',
  bitrate: 24000, // ✅ 24 kbps for VOIP（推荐值）
};
```

**实现**: `webapp/web-client/src/audio_codec.ts`
- 在编码器初始化后尝试设置比特率
- 支持通过 `setBitrate()` 方法或 `bitrate` 属性设置
- 如果库不支持，会记录警告但继续使用默认值

### 节点端（测试代码）✅

**文件**: `electron_node/services/faster_whisper_vad/test_integration_wav.py`

**配置**:
```python
# 设置比特率为 24 kbps（与 Web 端一致）
bitrate = 24000  # 24 kbps
error = opus.opus_encoder_ctl(
    opus.cast(opus.pointer(encoder_state), opus.oe_p),
    opus.OPUS_SET_BITRATE_REQUEST,
    bitrate
)
```

**注意**: 
- 节点端的解码器不需要设置比特率（自动从 packet 读取）
- 只有测试代码中的编码器需要设置，确保与 Web 端一致

---

## 比特率选择

### 推荐值：24 kbps

**原因**:
- ✅ **平衡质量和带宽**: 16-32 kbps 是 VOIP 的推荐范围
- ✅ **适合短音频**: 对于 0.24 秒的短音频，24 kbps 提供更好的质量
- ✅ **网络友好**: 不会占用过多带宽
- ✅ **质量保证**: 足够支持清晰的语音识别

### 其他选项

- **16 kbps**: 最低推荐值，带宽更省，但质量略低
- **32 kbps**: 更高质量，但带宽占用更高
- **默认（64 kbps）**: 对短音频可能不友好，导致质量下降

---

## 验证

### Web 端

1. **检查控制台日志**:
   ```
   OpusEncoder initialized { sampleRate: 16000, application: 'voip', bitrate: 24000 }
   OpusEncoder bitrate set to 24000 bps
   ```

2. **如果库不支持设置比特率**:
   ```
   OpusEncoder initialized { sampleRate: 16000, application: 'voip', bitrate: 'default' }
   OpusEncoder does not support setting bitrate, using default
   ```

### 节点端（测试）

1. **检查日志**:
   ```
   Opus encoder bitrate set to 24000 bps (24 kbps for VOIP)
   ```

2. **如果设置失败**:
   ```
   Failed to set Opus encoder bitrate to 24000 bps: [error message]
   ```

---

## 预期效果

### 修复前

- 音频质量差（std: 0.0121-0.0898）
- ASR 无法识别，返回空文本
- 节点端继续调用 NMT/TTS，生成 "The" 语音

### 修复后

- ✅ 音频质量改善（std 应该 > 0.1）
- ✅ ASR 能够识别，返回有意义的文本
- ✅ 不再生成 "The" 语音

---

## 下一步

1. ✅ **重新编译 Web 端**
   ```bash
   cd webapp/web-client
   npm run build
   ```

2. ✅ **重启 Web 端服务**
   - 应用新的比特率配置

3. ✅ **测试验证**
   - 验证音频质量是否改善
   - 验证 ASR 识别率是否提高
   - 验证不再生成 "The" 语音

---

**配置完成时间**: 2025-12-25  
**状态**: ✅ **已配置推荐比特率（24 kbps for VOIP）**

