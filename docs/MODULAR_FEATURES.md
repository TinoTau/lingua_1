# 模块化功能设计文档

## 概述

本文档描述如何实现**实时停用或切换可选功能模块**，确保各模块之间互不影响。

## 设计原则

1. **模块化设计**: 每个功能模块独立，可插拔
2. **运行时切换**: 支持不重启服务的情况下启用/禁用模块
3. **优雅降级**: 模块禁用时，系统仍能正常工作
4. **配置驱动**: 通过配置和运行时命令控制模块状态

## 支持的可选功能模块

### 核心模块（必需）
- ✅ **ASR** (语音识别) - Whisper
- ✅ **NMT** (机器翻译) - M2M100
- ✅ **TTS** (语音合成) - Piper TTS
- ✅ **VAD** (语音活动检测) - Silero VAD

### 可选模块（可动态启用/禁用）
- 🔧 **Speaker Identification** (音色识别)
- 🔧 **Voice Cloning** (音色生成/克隆)
- 🔧 **Speech Rate Detection** (语速识别)
- 🔧 **Speech Rate Control** (语速生成/控制)
- 🔧 **Emotion Detection** (情感分析) - 已有基础
- 🔧 **Persona Adaptation** (个性化适配) - 已有基础

## 架构设计

### 1. 节点能力注册

节点在注册时上报支持的功能模块：

```rust
// scheduler/src/node_registry.rs
pub struct NodeCapabilities {
    // 核心能力（必需）
    pub asr: bool,
    pub nmt: bool,
    pub tts: bool,
    pub vad: bool,
    
    // 可选能力
    pub speaker_identification: bool,
    pub voice_cloning: bool,
    pub speech_rate_detection: bool,
    pub speech_rate_control: bool,
    pub emotion_detection: bool,
    pub persona_adaptation: bool,
}
```

### 2. 模块状态管理

每个节点维护模块的启用/禁用状态：

```rust
pub struct ModuleState {
    pub enabled: bool,
    pub model_loaded: bool,
    pub last_used: Option<chrono::DateTime<chrono::Utc>>,
}
```

### 3. 任务请求中的功能标记

客户端在发送任务时指定需要的可选功能：

```typescript
interface UtteranceMessage {
    type: 'utterance';
    session_id: string;
    utterance_index: number;
    src_lang: string;
    tgt_lang: string;
    audio: string;
    
    // 可选功能请求
    features?: {
        speaker_identification?: boolean;
        voice_cloning?: boolean;
        speech_rate_detection?: boolean;
        speech_rate_control?: boolean;
        emotion_detection?: boolean;
        persona_adaptation?: boolean;
    };
}
```

### 4. 节点选择策略

调度服务器根据任务需求和节点能力选择节点：

```rust
fn select_node(
    &self,
    required_features: &FeatureSet,
    src_lang: &str,
    tgt_lang: &str,
) -> Option<String> {
    // 1. 筛选支持所有必需功能的节点
    // 2. 优先选择已启用相关模块的节点
    // 3. 负载均衡
}
```

## 实现方案

### 方案一：插件式架构（推荐）

#### 节点推理服务改造

```rust
// node-inference/src/main.rs
pub trait InferenceModule: Send + Sync {
    fn name(&self) -> &str;
    fn is_enabled(&self) -> bool;
    fn enable(&mut self) -> Result<()>;
    fn disable(&mut self) -> Result<()>;
    fn process(&self, input: &ModuleInput) -> Result<ModuleOutput>;
}

pub struct InferenceService {
    // 核心模块（必需）
    asr: Arc<dyn ASREngine>,
    nmt: Arc<dyn NMTEngine>,
    tts: Arc<dyn TTSEngine>,
    vad: Arc<dyn VADEngine>,
    
    // 可选模块（可动态启用/禁用）
    speaker_identifier: Option<Arc<dyn SpeakerIdentifier>>,
    voice_cloner: Option<Arc<dyn VoiceCloner>>,
    speech_rate_detector: Option<Arc<dyn SpeechRateDetector>>,
    speech_rate_controller: Option<Arc<dyn SpeechRateController>>,
    emotion_detector: Option<Arc<dyn EmotionDetector>>,
    persona_adapter: Option<Arc<dyn PersonaAdapter>>,
    
    // 模块状态管理
    module_states: Arc<RwLock<HashMap<String, ModuleState>>>,
}
```

#### 动态启用/禁用模块

```rust
impl InferenceService {
    pub async fn enable_module(&self, module_name: &str) -> Result<()> {
        let mut states = self.module_states.write().await;
        
        match module_name {
            "speaker_identification" => {
                if self.speaker_identifier.is_none() {
                    // 加载模型
                    let module = SpeakerIdentifier::new().await?;
                    // 更新状态
                    states.insert(module_name.to_string(), ModuleState {
                        enabled: true,
                        model_loaded: true,
                        last_used: None,
                    });
                }
            }
            // ... 其他模块
            _ => return Err(anyhow!("Unknown module: {}", module_name)),
        }
        
        Ok(())
    }
    
    pub async fn disable_module(&self, module_name: &str) -> Result<()> {
        let mut states = self.module_states.write().await;
        
        // 标记为禁用（不立即卸载模型，保留在内存中以便快速重新启用）
        if let Some(state) = states.get_mut(module_name) {
            state.enabled = false;
        }
        
        Ok(())
    }
}
```

#### 处理流程中的条件调用

```rust
impl InferenceService {
    pub async fn process(&self, request: InferenceRequest) -> Result<InferenceResult> {
        // 1. ASR (必需)
        let transcript = self.asr.transcribe(&request.audio_data, &request.src_lang).await?;
        
        // 2. 可选：音色识别
        let speaker_id = if request.features.speaker_identification {
            self.speaker_identifier.as_ref()
                .and_then(|m| m.identify(&request.audio_data).ok())
        } else {
            None
        };
        
        // 3. 可选：语速识别
        let speech_rate = if request.features.speech_rate_detection {
            self.speech_rate_detector.as_ref()
                .and_then(|m| m.detect(&request.audio_data).ok())
        } else {
            None
        };
        
        // 4. 可选：情感分析
        let emotion = if request.features.emotion_detection {
            self.emotion_detector.as_ref()
                .and_then(|m| m.detect(&transcript).ok())
        } else {
            None
        };
        
        // 5. 可选：个性化适配
        let adapted_text = if request.features.persona_adaptation {
            self.persona_adapter.as_ref()
                .map(|m| m.adapt(&transcript, &emotion))
                .unwrap_or(transcript)
        } else {
            transcript
        };
        
        // 6. NMT (必需)
        let translation = self.nmt.translate(&adapted_text, &request.src_lang, &request.tgt_lang).await?;
        
        // 7. 可选：语速控制
        let tts_params = if request.features.speech_rate_control && speech_rate.is_some() {
            TtsParams {
                speech_rate: speech_rate.unwrap(),
                ..Default::default()
            }
        } else {
            TtsParams::default()
        };
        
        // 8. 可选：音色克隆
        let voice_id = if request.features.voice_cloning && speaker_id.is_some() {
            speaker_id
        } else {
            None
        };
        
        // 9. TTS (必需)
        let audio = self.tts.synthesize(&translation, &request.tgt_lang, &tts_params, voice_id).await?;
        
        Ok(InferenceResult {
            transcript,
            translation,
            audio,
            // 可选结果
            speaker_id,
            speech_rate,
            emotion,
        })
    }
}
```

### 方案二：事件驱动架构

参考之前版本的事件驱动设计，使用 EventBus 实现模块解耦：

```rust
// 事件类型
pub enum InferenceEvent {
    ASRComplete { transcript: String },
    SpeakerIdentified { speaker_id: String },
    SpeechRateDetected { rate: f32 },
    EmotionDetected { emotion: String },
    PersonaAdapted { text: String },
    NMTComplete { translation: String },
    TTSComplete { audio: Vec<u8> },
}

// 模块订阅事件
impl InferenceService {
    pub fn setup_event_handlers(&self) {
        // 核心流程
        self.event_bus.subscribe("asr.complete", |event| {
            // 触发后续处理
        });
        
        // 可选模块只在启用时订阅
        if self.is_module_enabled("speaker_identification") {
            self.event_bus.subscribe("audio.received", |event| {
                // 音色识别
            });
        }
    }
}
```

## Electron Node 客户端 UI

### 模块管理界面

```typescript
// electron-node/renderer/src/components/ModuleManagement.tsx
export function ModuleManagement() {
    const [modules, setModules] = useState<Module[]>([]);
    
    const toggleModule = async (moduleName: string, enabled: boolean) => {
        if (enabled) {
            await window.electronAPI.enableModule(moduleName);
        } else {
            await window.electronAPI.disableModule(moduleName);
        }
        loadModules();
    };
    
    return (
        <div className="module-management">
            <h2>功能模块管理</h2>
            {modules.map(module => (
                <div key={module.name} className="module-item">
                    <div className="module-info">
                        <h3>{module.displayName}</h3>
                        <p>{module.description}</p>
                        <span className="module-status">
                            {module.enabled ? '已启用' : '已禁用'}
                        </span>
                    </div>
                    <label className="switch">
                        <input
                            type="checkbox"
                            checked={module.enabled}
                            onChange={(e) => toggleModule(module.name, e.target.checked)}
                        />
                        <span className="slider"></span>
                    </label>
                </div>
            ))}
        </div>
    );
}
```

### IPC 接口

```typescript
// electron-node/main/src/index.ts
ipcMain.handle('enable-module', async (_, moduleName: string) => {
    return inferenceService.enableModule(moduleName).await;
});

ipcMain.handle('disable-module', async (_, moduleName: string) => {
    return inferenceService.disableModule(moduleName).await;
});

ipcMain.handle('get-module-status', async () => {
    return inferenceService.getModuleStatuses().await;
});
```

## 调度服务器支持

### 节点能力查询

```rust
// scheduler/src/dispatcher.rs
pub async fn select_node_with_features(
    &self,
    required_features: &FeatureSet,
    src_lang: &str,
    tgt_lang: &str,
) -> Option<String> {
    let nodes = self.node_registry.get_available_nodes().await;
    
    // 筛选支持所需功能的节点
    let candidates: Vec<_> = nodes
        .iter()
        .filter(|node| {
            // 检查核心能力
            node.capabilities.asr && node.capabilities.nmt && node.capabilities.tts
            // 检查可选功能
            && (!required_features.speaker_identification || node.capabilities.speaker_identification)
            && (!required_features.voice_cloning || node.capabilities.voice_cloning)
            // ... 其他功能检查
        })
        .collect();
    
    // 负载均衡选择
    select_best_node(candidates)
}
```

## 移动端客户端支持

### 功能选择界面

```typescript
// mobile-app/src/components/FeatureSelector.tsx
export function FeatureSelector({ onFeaturesChange }: Props) {
    const [features, setFeatures] = useState({
        speaker_identification: false,
        voice_cloning: false,
        speech_rate_detection: false,
        speech_rate_control: false,
        emotion_detection: false,
        persona_adaptation: false,
    });
    
    return (
        <View>
            <Text>可选功能</Text>
            <Switch
                value={features.speaker_identification}
                onValueChange={(value) => {
                    setFeatures({ ...features, speaker_identification: value });
                    onFeaturesChange(features);
                }}
            />
            <Text>音色识别</Text>
            {/* 其他功能开关 */}
        </View>
    );
}
```

## 优势

1. **模块独立性**: 每个模块可以独立启用/禁用，互不影响
2. **运行时切换**: 无需重启服务即可切换模块状态
3. **资源优化**: 禁用模块不占用计算资源
4. **灵活配置**: 客户端可以按需选择功能
5. **优雅降级**: 模块不可用时，系统仍能正常工作

## 实施步骤

1. **阶段一**: 实现模块接口和状态管理
2. **阶段二**: 实现核心可选模块（音色识别、语速识别）
3. **阶段三**: 实现高级可选模块（音色生成、语速控制）
4. **阶段四**: 完善 UI 和配置管理
5. **阶段五**: 测试和优化

## 总结

当前架构**完全支持**实时停用或切换可选功能模块。通过插件式设计和运行时状态管理，可以实现：

- ✅ 动态启用/禁用模块
- ✅ 不影响核心功能
- ✅ 不影响其他可选模块
- ✅ 客户端按需选择功能
- ✅ 节点按能力提供服务

