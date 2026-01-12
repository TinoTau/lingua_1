# node-inference 内部模块列表

## 模块总数：11 个

### 一、核心模块（4 个，必需）

这些模块在 `InferenceService` 初始化时自动加载，**不在 MODULE_TABLE 中**（因为它们总是启用的）：

| 模块名称 | 实现位置 | 功能 | 实现方式 |
|---------|---------|------|---------|
| **ASR** | `src/asr.rs` | 语音识别 | 本地推理 (whisper-rs) |
| **NMT** | `src/nmt.rs` | 机器翻译 | HTTP 客户端 (Python 服务，端口 5008) |
| **TTS** | `src/tts.rs` | 语音合成 | HTTP 客户端 (Python 服务，端口 5006) |
| **VAD** | `src/vad.rs` | 语音活动检测 | 本地推理 (ONNX Runtime) |

**代码位置**：`src/inference.rs` 第 67-71 行

```rust
pub struct InferenceService {
    // 核心模块（必需）
    asr_engine: asr::ASREngine,
    nmt_engine: nmt::NMTEngine,
    tts_engine: tts::TTSEngine,
    vad_engine: vad::VADEngine,
    // ...
}
```

### 二、可选模块（6 个，热插拔）

这些模块在 `MODULE_TABLE` 中注册，可以通过 `enable_module()` 动态启用：

| 模块名称 | 注册名称 | 实现位置 | 功能 | 依赖 |
|---------|---------|---------|------|------|
| **情感检测** | `emotion_detection` | `src/emotion_adapter/` | 检测语音情感 | ASR |
| **音色识别** | `speaker_identification` | `src/speaker.rs` | 识别说话者 | 无 |
| **音色克隆** | `voice_cloning` | `src/speaker.rs` | 克隆说话者音色 | 音色识别 |
| **语速识别** | `speech_rate_detection` | `src/speech_rate.rs` | 检测语速 | ASR |
| **语速控制** | `speech_rate_control` | `src/speech_rate.rs` | 控制 TTS 语速 | 语速识别、TTS |
| **个性化适配** | `persona_adaptation` | `src/persona_adapter/` | 个性化风格转换 | ASR |

**代码位置**：`src/modules.rs` 第 294-386 行

```rust
lazy_static! {
    pub static ref MODULE_TABLE: HashMap<&'static str, ModuleMetadata> = {
        let mut m = HashMap::new();
        
        m.insert("emotion_detection", ModuleMetadata { ... });
        m.insert("speaker_identification", ModuleMetadata { ... });
        m.insert("voice_cloning", ModuleMetadata { ... });
        m.insert("speech_rate_detection", ModuleMetadata { ... });
        m.insert("speech_rate_control", ModuleMetadata { ... });
        m.insert("persona_adaptation", ModuleMetadata { ... });
        
        m
    };
}
```

**在 InferenceService 中的字段**：`src/inference.rs` 第 77-80 行

```rust
// 可选模块（使用 Arc<RwLock<>> 以支持并发访问和动态修改）
speaker_identifier: Option<Arc<RwLock<speaker::SpeakerIdentifier>>>,
voice_cloner: Option<Arc<RwLock<speaker::VoiceCloner>>>,
speech_rate_detector: Option<Arc<RwLock<speech_rate::SpeechRateDetector>>>,
speech_rate_controller: Option<Arc<RwLock<speech_rate::SpeechRateController>>>,
```

### 三、辅助模块（1 个）

这些模块不在 `MODULE_TABLE` 中，但存在于 `InferenceService` 中：

| 模块名称 | 实现位置 | 功能 | 说明 |
|---------|---------|------|------|
| **语言检测器** | `src/language_detector.rs` | 自动语种识别 | 复用 ASR 的 Whisper 上下文 |

**代码位置**：`src/inference.rs` 第 74 行

```rust
// 语言检测器（可选，用于自动语种识别）
language_detector: Option<language_detector::LanguageDetector>,
```

## 模块依赖关系

```
核心模块（必需）
├── ASR ──────────┐
├── NMT           │
├── TTS ──────────┼──┐
└── VAD           │  │
                  │  │
可选模块（热插拔）│  │
├── emotion_detection ──┘
├── speaker_identification
├── voice_cloning ────────┐
│   └── 依赖: speaker_identification
├── speech_rate_detection ─┘
├── speech_rate_control ────┐
│   ├── 依赖: speech_rate_detection
│   └── 依赖: TTS
└── persona_adaptation ─────┘
    └── 依赖: ASR
```

## 模块启用方式

### 核心模块
- **自动启用**：在 `InferenceService::new()` 时自动初始化
- **无需手动启用**

### 可选模块
- **手动启用**：通过 `InferenceService::enable_module(module_name)` 启用
- **依赖检查**：`ModuleManager` 会自动检查依赖、冲突和模型可用性

**示例**：
```rust
// 启用音色识别模块
inference_service.enable_module("speaker_identification").await?;

// 启用音色克隆模块（会自动检查 speaker_identification 是否已启用）
inference_service.enable_module("voice_cloning").await?;
```

## FeatureSet 对应关系

`FeatureSet` 结构体（`src/modules.rs` 第 389-397 行）定义了可选模块的功能标志：

```rust
pub struct FeatureSet {
    pub speaker_identification: bool,    // → speaker_identification
    pub voice_cloning: bool,              // → voice_cloning
    pub speech_rate_detection: bool,      // → speech_rate_detection
    pub speech_rate_control: bool,        // → speech_rate_control
    pub emotion_detection: bool,           // → emotion_detection
    pub persona_adaptation: bool,         // → persona_adaptation
}
```

## 总结

- **核心模块**：4 个（ASR、NMT、TTS、VAD）
- **可选模块**：6 个（在 MODULE_TABLE 中注册）
- **辅助模块**：1 个（语言检测器）
- **总计**：11 个模块

**热插拔支持**：
- ✅ 可选模块（6 个）：完全支持热插拔
- ❌ 核心模块（4 个）：不支持热插拔（总是启用）
- ⚠️ 辅助模块（1 个）：不支持热插拔（可选但总是可用）

