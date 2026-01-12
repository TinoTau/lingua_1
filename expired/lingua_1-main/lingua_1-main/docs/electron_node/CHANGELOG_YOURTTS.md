# YourTTS 集成更新日志

## 2024-12-19: YourTTS 服务集成完成

### 新增功能

1. **YourTTS HTTP 客户端模块**
   - 创建 `electron_node/services/node-inference/src/yourtts.rs`
   - 实现 `YourTTSEngine` 结构体，封装 YourTTS 服务调用
   - 支持音频格式转换（f32 → PCM16）和重采样（22050Hz → 16000Hz）

2. **VoiceCloner 模块实现**
   - 更新 `electron_node/services/node-inference/src/speaker.rs`
   - 实现 `VoiceCloner::clone_voice()` 方法，调用 YourTTS 服务
   - 支持通过 `speaker_id` 进行音色克隆

3. **动态 TTS 服务选择**
   - 更新 `electron_node/services/node-inference/src/inference.rs`
   - 根据 `features.voice_cloning` 自动选择 YourTTS 或 Piper TTS
   - 实现优雅降级机制：YourTTS 不可用时自动使用 Piper TTS

4. **模块注册**
   - 更新 `electron_node/services/node-inference/src/lib.rs`
   - 注册 `yourtts` 模块并导出相关类型

### 任务链流程

**标准流程**（无音色克隆）:
```
调度服务器 → ASR → NMT → Piper TTS → 返回音频
```

**音色克隆流程**（启用 voice_cloning）:
```
调度服务器 → ASR → NMT → YourTTS → 返回音频
```

### 文档更新

- ✅ `electron_node/docs/SERVICE_HOT_PLUG_VERIFICATION.md` - 更新为已完成状态
- ✅ `electron_node/docs/YOURTTS_INTEGRATION_IMPLEMENTATION.md` - 新增实现文档
- ✅ `electron_node/services/README.md` - 更新服务说明
- ✅ `electron_node/README.md` - 更新节点端说明
- ✅ `electron_node/docs/README.md` - 更新文档索引
- ✅ `docs/PROJECT_STRUCTURE.md` - 更新项目结构说明
- ✅ `docs/README.md` - 更新项目文档索引

### 技术细节

- **YourTTS 服务端口**: 5004
- **Piper TTS 服务端口**: 5006
- **NMT 服务端口**: 5008
- **节点推理服务端口**: 5009

### 使用方式

1. 启动 YourTTS 服务：
   ```typescript
   await pythonServiceManager.startService('yourtts');
   ```

2. 在任务请求中启用音色克隆：
   ```json
   {
     "features": {
       "voice_cloning": true,
       "speaker_identification": true
     }
   }
   ```

### 特性

- ✅ 动态服务选择：根据任务需求自动选择 TTS 服务
- ✅ 优雅降级：YourTTS 不可用时自动使用 Piper TTS
- ✅ 错误处理：完善的错误处理和日志记录
- ✅ 热插拔支持：服务可以动态启动/停止

---

**更新日期**: 2024-12-19  
**状态**: ✅ 已完成

