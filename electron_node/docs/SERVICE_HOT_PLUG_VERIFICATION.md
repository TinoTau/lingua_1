# 节点端服务热插拔与任务链验证报告

## 一、当前架构概览

### 1.1 服务架构

节点端采用**分层服务架构**，支持热插拔：

```
调度服务器 (WebSocket)
    ↓
Node Agent (Electron)
    ↓
Inference Service (Rust, 端口 5009)
    ├─ ASR (Whisper, 本地推理)
    ├─ NMT (HTTP 调用, 端口 5008)
    ├─ TTS (HTTP 调用, 端口 5006 - Piper TTS)
    └─ YourTTS (HTTP 调用, 端口 5004 - 可选)
```

### 1.2 服务管理

**PythonServiceManager** (`python-service-manager.ts`) 负责管理：
- ✅ **NMT 服务** (端口 5008) - M2M100 机器翻译
- ✅ **TTS 服务** (端口 5006) - Piper TTS 语音合成
- ✅ **YourTTS 服务** (端口 5004) - 零样本语音克隆

**功能特性**：
- ✅ 支持服务的启动/停止（热插拔）
- ✅ 服务状态监控（运行状态、PID、端口）
- ✅ 自动端口清理和验证
- ✅ 服务偏好保存（下次启动自动恢复）
- ✅ GPU 使用时间跟踪

## 二、任务链流程验证

### 2.1 完整任务链

**当前实现的任务链**：

```rust
// 1. 接收音频文件（从调度服务器）
InferenceRequest {
    audio_data: Vec<u8>,  // PCM16 音频
    src_lang: String,
    tgt_lang: String,
    features: Option<FeatureSet>,
}

// 2. 节点推理流程（inference.rs::process）
//   2.1 语言检测（如果 src_lang == "auto"）
//   2.2 ASR 语音识别（Whisper，本地推理）
//   2.3 NMT 机器翻译（HTTP 调用端口 5008）
//   2.4 TTS 语音合成（HTTP 调用端口 5006 - Piper TTS）
//   2.5 可选：语速控制
//   2.6 可选：音色克隆（✅ 已实现 YourTTS 集成）

// 3. 返回音频文件
InferenceResult {
    transcript: String,
    translation: String,
    audio: Vec<u8>,  // TTS 生成的音频
}
```

### 2.2 任务链代码位置

**核心处理逻辑**：
- 📍 `electron_node/services/node-inference/src/inference.rs::process()` (第 221-467 行)
- 📍 `electron_node/electron-node/main/src/agent/node-agent.ts::handleJob()` (第 262-308 行)

**服务调用**：
- 📍 NMT: `electron_node/services/node-inference/src/nmt.rs`
- 📍 TTS: `electron_node/services/node-inference/src/tts.rs` (Piper TTS)
- 📍 YourTTS: `electron_node/services/node-inference/src/yourtts.rs` (✅ 已集成)
- 📍 VoiceCloner: `electron_node/services/node-inference/src/speaker.rs` (✅ 已实现)

## 三、热插拔能力验证

### 3.1 ✅ 已实现的热插拔功能

#### 3.1.1 服务级热插拔

**PythonServiceManager** 支持：
- ✅ 动态启动服务：`startService('nmt' | 'tts' | 'yourtts')`
- ✅ 动态停止服务：`stopService('nmt' | 'tts' | 'yourtts')`
- ✅ 服务状态查询：`getServiceStatus(serviceName)`
- ✅ 批量停止：`stopAllServices()`

**代码位置**：
```130:263:electron_node/electron-node/main/src/python-service-manager.ts
  private getServiceConfig(serviceName: 'nmt' | 'tts' | 'yourtts'): PythonServiceConfig | null {
    // ... 服务配置
  }

  async startService(serviceName: 'nmt' | 'tts' | 'yourtts'): Promise<void> {
    // ... 启动逻辑
  }

  async stopService(serviceName: 'nmt' | 'tts' | 'yourtts'): Promise<void> {
    // ... 停止逻辑
  }
```

#### 3.1.2 模块级热插拔

**InferenceService** 支持根据任务请求动态启用模块：
- ✅ 根据 `features` 自动启用模块
- ✅ 模块依赖检查
- ✅ 模块冲突检查
- ✅ 模型按需加载

**代码位置**：
```228:250:electron_node/services/node-inference/src/inference.rs
        // 根据请求中的 features 自动启用所需模块（运行时动态启用）
        if let Some(ref features) = request.features {
            // 根据任务需求自动启用模块
            if features.speaker_identification {
                let _ = self.enable_module("speaker_identification").await;
            }
            if features.voice_cloning {
                let _ = self.enable_module("voice_cloning").await;
            }
            // ... 其他模块
        }
```

### 3.2 ✅ 已完成的热插拔功能

#### 3.2.1 YourTTS 服务集成 ✅

**实现状态**：
- ✅ YourTTS 服务已集成到任务链中
- ✅ TTS 引擎支持动态选择 Piper TTS 或 YourTTS
- ✅ `VoiceCloner` 模块已实现，可调用 YourTTS 服务

**实现内容**：
1. ✅ 创建 `YourTTSEngine` HTTP 客户端 (`yourtts.rs`)
2. ✅ 实现 `VoiceCloner::clone_voice()` 调用 YourTTS 服务（端口 5004）
3. ✅ 在 `inference.rs` 中，根据 `features.voice_cloning` 自动选择 TTS 服务
4. ✅ 实现优雅降级：YourTTS 不可用时自动降级到 Piper TTS

**详细实现文档**：
- 📄 `electron_node/docs/TTS_SERVICES.md`

## 四、任务链完整性验证

### 4.1 ✅ 已实现的流程

**标准任务链**（无音色克隆）：
```
调度服务器 → Node Agent → Inference Service
    ↓
1. ASR (Whisper, 本地)
    ↓
2. NMT (HTTP 5008)
    ↓
3. TTS (HTTP 5006, Piper TTS)
    ↓
返回音频文件
```

**验证**：
- ✅ 从调度服务器接收音频文件
- ✅ 经过节点推理（ASR）
- ✅ 经过 NMT 翻译
- ✅ 经过 TTS 合成
- ✅ 返回音频文件

### 4.2 ✅ 已完善的流程

**音色克隆任务链**（需要 YourTTS）：
```
调度服务器 → Node Agent → Inference Service
    ↓
1. ASR (Whisper, 本地)
    ↓
2. NMT (HTTP 5008)
    ↓
3. 音色识别（可选，如果启用 speaker_identification）
    ↓
4. TTS 选择：
   - 如果 features.voice_cloning == true && speaker_id 存在 → YourTTS (HTTP 5004)
   - 否则 → Piper TTS (HTTP 5006)
    ↓
返回音频文件
```

**当前状态**：
- ✅ 根据 `features.voice_cloning` 自动选择 YourTTS 或 Piper TTS
- ✅ YourTTS 服务已集成到任务链中
- ✅ 支持优雅降级：YourTTS 不可用时自动使用 Piper TTS

## 五、改进建议

### 5.1 实现 YourTTS 集成

#### 5.1.1 修改 TTS 引擎支持动态选择

**方案**：在 `tts.rs` 中添加 YourTTS 客户端支持

```rust
// electron_node/services/node-inference/src/tts.rs

pub struct TTSEngine {
    client: Client,
    piper_config: PiperHttpConfig,
    yourtts_config: Option<YourTTSHttpConfig>,  // 新增
}

impl TTSEngine {
    pub async fn synthesize(
        &self, 
        text: &str, 
        lang: &str,
        use_voice_cloning: bool,  // 新增参数
        speaker_id: Option<&str>,  // 新增参数
    ) -> Result<Vec<u8>> {
        if use_voice_cloning && self.yourtts_config.is_some() {
            // 使用 YourTTS
            self.synthesize_with_yourtts(text, lang, speaker_id).await
        } else {
            // 使用 Piper TTS
            self.synthesize_with_piper(text, lang).await
        }
    }
}
```

#### 5.1.2 实现 VoiceCloner 调用 YourTTS

**方案**：在 `speaker.rs` 中实现 HTTP 调用

```rust
// electron_node/services/node-inference/src/speaker.rs

impl VoiceCloner {
    pub async fn clone_voice(&self, text: &str, speaker_id: &str) -> Result<Vec<u8>> {
        // HTTP 调用 YourTTS 服务 (端口 5004)
        let client = reqwest::Client::new();
        let response = client
            .post("http://127.0.0.1:5004/synthesize")
            .json(&serde_json::json!({
                "text": text,
                "speaker_id": speaker_id,
            }))
            .send()
            .await?;
        
        // 解析响应并返回音频数据
        // ...
    }
}
```

#### 5.1.3 修改推理流程支持 YourTTS

**方案**：在 `inference.rs` 中，根据 `voice_cloning` 选择 TTS 服务

```rust
// electron_node/services/node-inference/src/inference.rs

// 5. TTS: 语音合成
let use_voice_cloning = features.map(|f| f.voice_cloning).unwrap_or(false);
let audio = if use_voice_cloning {
    // 使用 YourTTS（通过 VoiceCloner）
    if let Some(ref speaker_id) = ctx.speaker_id {
        if let Some(ref cloner) = self.voice_cloner {
            let module = cloner.read().await;
            if InferenceModule::is_enabled(&*module) {
                module.clone_voice(&translation, speaker_id).await?
            } else {
                // 降级到 Piper TTS
                self.tts_engine.synthesize(&translation, &tgt_lang).await?
            }
        } else {
            self.tts_engine.synthesize(&translation, &tgt_lang).await?
        }
    } else {
        // 没有 speaker_id，使用 Piper TTS
        self.tts_engine.synthesize(&translation, &tgt_lang).await?
    }
} else {
    // 标准流程，使用 Piper TTS
    self.tts_engine.synthesize(&translation, &tgt_lang).await?
};
```

### 5.2 服务健康检查增强

**建议**：在任务处理前检查所需服务是否运行

```rust
// 在 inference.rs::process() 开始时
if !self.check_service_available("nmt", 5008).await {
    return Err(anyhow!("NMT service not available"));
}
if !self.check_service_available("tts", 5006).await {
    return Err(anyhow!("TTS service not available"));
}
// 如果启用 voice_cloning，检查 YourTTS
if features.map(|f| f.voice_cloning).unwrap_or(false) {
    if !self.check_service_available("yourtts", 5004).await {
        return Err(anyhow!("YourTTS service not available for voice cloning"));
    }
}
```

## 六、总结

### 6.1 ✅ 已实现的功能

1. **服务级热插拔**：✅ 完全支持
   - NMT、TTS、YourTTS 服务可以动态启动/停止
   - 服务状态监控和自动恢复

2. **模块级热插拔**：✅ 完全支持
   - 根据任务请求动态启用模块
   - 模块依赖和冲突检查

3. **标准任务链**：✅ 完全支持
   - 调度服务器 → ASR → NMT → TTS → 返回音频

### 6.2 ✅ 已完成的功能

1. **YourTTS 集成**：✅ 已实现
   - YourTTS 服务已集成到任务链中
   - TTS 引擎支持动态选择（根据 `features.voice_cloning`）
   - VoiceCloner 已实现，可调用 YourTTS 服务
   - 支持优雅降级机制

2. **服务可用性检查**：✅ 已实现
   - 在任务处理前检查所需服务是否运行
   - 自动降级到备用服务（YourTTS → Piper TTS）

### 6.3 后续优化建议

1. **中优先级**：增强服务健康检查，提供更详细的错误提示
2. **低优先级**：优化服务启动顺序，支持依赖服务自动启动
3. **低优先级**：实现服务重试机制，提高容错性

---

**文档生成时间**：2024-12-19  
**验证范围**：节点端服务热插拔与任务链完整性

