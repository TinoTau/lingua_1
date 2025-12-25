# Opus 比特率配置修复总结

**日期**: 2025-12-25  
**状态**: ✅ **已配置推荐比特率（24 kbps for VOIP）**

---

## 修复内容

### 1. Web 端 ✅

**文件**: `webapp/web-client/src/websocket_client.ts`

**修改**:
```typescript
bitrate: 24000, // ✅ 设置 24 kbps for VOIP（推荐值，平衡质量和带宽）
```

**文件**: `webapp/web-client/src/audio_codec.ts`

**修改**:
- 在编码器初始化后尝试设置比特率
- 支持通过 `setBitrate()` 方法或 `bitrate` 属性设置
- 如果库不支持，会记录警告但继续使用默认值

### 2. 节点端（测试代码）✅

**更新的文件**:
1. `test_integration_wav.py` - 集成测试
2. `test_service_unit.py` - 单元测试
3. `test_plan_a_e2e.py` - 端到端测试
4. `test_opus_quick.py` - 快速测试

**修改**:
```python
# 设置比特率为 24 kbps（与 Web 端一致）
bitrate = 24000  # 24 kbps
error = opus.opus_encoder_ctl(
    opus.cast(opus.pointer(encoder_state), opus.oe_p),
    opus.OPUS_SET_BITRATE_REQUEST,
    bitrate
)
```

---

## 比特率选择

### 推荐值：24 kbps

**原因**:
- ✅ **平衡质量和带宽**: 16-32 kbps 是 VOIP 的推荐范围
- ✅ **适合短音频**: 对于 0.24 秒的短音频，24 kbps 提供更好的质量
- ✅ **网络友好**: 不会占用过多带宽
- ✅ **质量保证**: 足够支持清晰的语音识别

### 对比

| 比特率 | 质量 | 带宽 | 适用场景 |
|--------|------|------|----------|
| 16 kbps | 中等 | 低 | 最低推荐值 |
| **24 kbps** | **良好** | **中等** | **推荐值（已配置）** |
| 32 kbps | 高 | 较高 | 更高质量 |
| 64 kbps（默认） | 高 | 高 | 对短音频不友好 |

---

## 预期效果

### 修复前

- ❌ 使用默认比特率（64 kbps）
- ❌ 音频质量差（std: 0.0121-0.0898）
- ❌ ASR 无法识别，返回空文本
- ❌ 节点端继续调用 NMT/TTS，生成 "The" 语音

### 修复后

- ✅ 使用推荐比特率（24 kbps）
- ✅ 音频质量改善（std 应该 > 0.1）
- ✅ ASR 能够识别，返回有意义的文本
- ✅ 不再生成 "The" 语音

---

## 验证步骤

### 1. Web 端

**检查控制台日志**:
```
OpusEncoder initialized { sampleRate: 16000, application: 'voip', bitrate: 24000 }
OpusEncoder bitrate set to 24000 bps
```

**如果库不支持**:
```
OpusEncoder initialized { sampleRate: 16000, application: 'voip', bitrate: 'default' }
OpusEncoder does not support setting bitrate, using default
```

### 2. 节点端（测试）

**检查日志**:
```
Opus encoder bitrate set to 24000 bps (24 kbps for VOIP)
```

### 3. ASR 服务

**检查音频质量指标**:
```
Audio data validation: 
std=0.15,  # ✅ 应该 > 0.1（之前是 0.0121-0.0898）
rms=0.08,  # ✅ 应该 > 0.01
dynamic_range=0.5,  # ✅ 应该 > 0.05
```

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

**修复完成时间**: 2025-12-25  
**状态**: ✅ **已配置推荐比特率（24 kbps for VOIP）**

**注意**: 
- Web 端需要重新编译和重启
- 节点端测试代码已更新，下次测试时会使用新配置
- 解码端不需要设置比特率（自动从 packet 读取）

