//! 推理服务核心类型和实现

use anyhow::Result;
use serde::{Deserialize, Serialize};  // Deserialize 在 InferenceRequest/InferenceResult 中使用（用于 JSON 反序列化）
use std::path::PathBuf;

use crate::modules::{FeatureSet, ModuleManager, InferenceModule};
use crate::asr;
use crate::nmt;
use crate::tts;
use crate::vad;
use crate::speaker;
use crate::speech_rate;
use crate::language_detector;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    pub job_id: String,
    pub src_lang: String,  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
    pub tgt_lang: String,
    pub audio_data: Vec<u8>, // PCM audio data
    pub features: Option<FeatureSet>, // 可选功能请求
    /// 翻译模式："one_way" | "two_way_auto"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// 双向模式的语言 A（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_a: Option<String>,
    /// 双向模式的语言 B（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_b: Option<String>,
    /// 自动识别时限制的语言范围（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_langs: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceResult {
    pub transcript: String,
    pub translation: String,
    pub audio: Vec<u8>, // TTS audio data
    // 可选结果
    pub speaker_id: Option<String>,
    pub speech_rate: Option<f32>,
    pub emotion: Option<String>,
}

pub struct InferenceService {
    // 核心模块（必需）
    asr_engine: asr::ASREngine,
    nmt_engine: nmt::NMTEngine,
    tts_engine: tts::TTSEngine,
    #[allow(dead_code)]
    vad_engine: vad::VADEngine,  // VAD 用于节点端 Level 2 断句，当前在 process 中暂未使用
    
    // 语言检测器（可选，用于自动语种识别）
    language_detector: Option<language_detector::LanguageDetector>,
    
    // 可选模块（使用 Arc<RwLock<>> 以支持并发访问和动态修改）
    speaker_identifier: Option<std::sync::Arc<tokio::sync::RwLock<speaker::SpeakerIdentifier>>>,
    voice_cloner: Option<std::sync::Arc<tokio::sync::RwLock<speaker::VoiceCloner>>>,
    speech_rate_detector: Option<std::sync::Arc<tokio::sync::RwLock<speech_rate::SpeechRateDetector>>>,
    speech_rate_controller: Option<std::sync::Arc<tokio::sync::RwLock<speech_rate::SpeechRateController>>>,
    
    // 模块管理器
    module_manager: ModuleManager,
}

impl InferenceService {
    pub fn new(models_dir: PathBuf) -> Result<Self> {
        let asr_engine = asr::ASREngine::new(models_dir.join("asr"))?;
        // 使用 HTTP 客户端方式初始化 NMT（推荐）
        let nmt_engine = nmt::NMTEngine::new_with_http_client(None)?;
        let tts_engine = tts::TTSEngine::new(None)?;
        let vad_engine = vad::VADEngine::new(models_dir.join("vad"))?;

        // 初始化语言检测器（复用 ASR 引擎的 Whisper 上下文）
        // TODO: 从 ASR 引擎获取 Whisper 上下文（需要 ASR 引擎暴露 ctx）
        // 当前先设为 None，待 ASR 引擎支持共享上下文后再启用
        let language_detector: Option<language_detector::LanguageDetector> = None;

        let module_manager = ModuleManager::new();

        Ok(Self {
            asr_engine,
            nmt_engine,
            tts_engine,
            vad_engine,
            language_detector,
            speaker_identifier: None,
            voice_cloner: None,
            speech_rate_detector: None,
            speech_rate_controller: None,
            module_manager,
        })
    }

    pub async fn enable_module(&self, module_name: &str) -> Result<()> {
        // 注意：当前实现中，模块需要在初始化时创建
        // 实际使用时，应该使用 Arc<Mutex<InferenceService>> 或类似设计
        match module_name {
            "speaker_identification" => {
                if let Some(ref m) = self.speaker_identifier {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                } else {
                    return Err(anyhow::anyhow!("Module {} not initialized. Please initialize it first.", module_name));
                }
                self.module_manager.enable_module(module_name).await?;
            }
            "voice_cloning" => {
                if let Some(ref m) = self.voice_cloner {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                }
                self.module_manager.enable_module(module_name).await?;
            }
            "speech_rate_detection" => {
                if let Some(ref m) = self.speech_rate_detector {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                }
                self.module_manager.enable_module(module_name).await?;
            }
            "speech_rate_control" => {
                if let Some(ref m) = self.speech_rate_controller {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                }
                self.module_manager.enable_module(module_name).await?;
            }
            _ => return Err(anyhow::anyhow!("Unknown module: {}", module_name)),
        }
        Ok(())
    }

    pub async fn disable_module(&self, module_name: &str) -> Result<()> {
        match module_name {
            "speaker_identification" => {
                if let Some(ref m) = self.speaker_identifier {
                    let mut module = m.write().await;
                    InferenceModule::disable(&mut *module).await?;
                }
            }
            "voice_cloning" => {
                if let Some(ref m) = self.voice_cloner {
                    let mut module = m.write().await;
                    InferenceModule::disable(&mut *module).await?;
                }
            }
            "speech_rate_detection" => {
                if let Some(ref m) = self.speech_rate_detector {
                    let mut module = m.write().await;
                    InferenceModule::disable(&mut *module).await?;
                }
            }
            "speech_rate_control" => {
                if let Some(ref m) = self.speech_rate_controller {
                    let mut module = m.write().await;
                    InferenceModule::disable(&mut *module).await?;
                }
            }
            _ => return Err(anyhow::anyhow!("Unknown module: {}", module_name)),
        }
        self.module_manager.disable_module(module_name).await?;
        Ok(())
    }

    pub async fn process(&self, request: InferenceRequest) -> Result<InferenceResult> {
        let features = request.features.as_ref();
        
        // 将 PCM 16-bit 转换为 f32（用于语言检测和 ASR）
        let audio_f32: Vec<f32> = request.audio_data
            .chunks_exact(2)
            .map(|chunk| {
                let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f32;
                sample / 32768.0
            })
            .collect();
        
        let mut src_lang = request.src_lang.clone();
        let mut tgt_lang = request.tgt_lang.clone();
        
        // 1. 语言检测（如果 src_lang == "auto"）
        if src_lang == "auto" {
            if let Some(ref detector) = self.language_detector {
                match detector.detect(&audio_f32, 16000).await {
                    Ok(detection) => {
                        use tracing::info;
                        info!("Language detected: {} (confidence: {:.2})", detection.lang, detection.confidence);
                        src_lang = detection.lang.clone();
                        
                        // 双向模式：根据检测结果选择翻译方向
                        if let Some(ref mode) = request.mode {
                            if mode == "two_way_auto" {
                                if let (Some(ref lang_a), Some(ref lang_b)) = (&request.lang_a, &request.lang_b) {
                                    if src_lang == *lang_a {
                                        tgt_lang = lang_b.clone();
                                        info!("Two-way mode: {} -> {}", src_lang, tgt_lang);
                                    } else if src_lang == *lang_b {
                                        tgt_lang = lang_a.clone();
                                        info!("Two-way mode: {} -> {}", src_lang, tgt_lang);
                                    } else {
                                        // 非主要语言，使用默认目标语言或 lang_a
                                        use tracing::warn;
                                        tgt_lang = lang_a.clone();
                                        warn!("Detected language {} not in two-way pair, using default target: {}", src_lang, tgt_lang);
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        use tracing::warn;
                        warn!("Language detection failed: {}, using default language: {}", e, src_lang);
                        // 使用默认语言（如果配置了 auto_langs，使用第一个）
                        if let Some(ref auto_langs) = request.auto_langs {
                            if !auto_langs.is_empty() {
                                src_lang = auto_langs[0].clone();
                            }
                        }
                    }
                }
            } else {
                use tracing::warn;
                warn!("Language detection requested but detector not available, using default language");
                // 如果没有语言检测器，使用默认语言
                if let Some(ref auto_langs) = request.auto_langs {
                    if !auto_langs.is_empty() {
                        src_lang = auto_langs[0].clone();
                    }
                }
            }
        }
        
        // 2. ASR: 语音识别（必需，使用检测到的语言）
        let transcript = self.asr_engine.transcribe_f32(&audio_f32, &src_lang).await?;

        // 2. 可选：音色识别
        #[allow(unused_variables)]  // audio_data 在可选模块中使用，如果模块未启用则未使用
        let speaker_id = if features.map(|f| f.speaker_identification).unwrap_or(false) {
            if let Some(ref m) = self.speaker_identifier {
                let module = m.read().await;
                if InferenceModule::is_enabled(&*module) {
                    module.identify(&request.audio_data).await.ok()
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        // 3. 可选：语速识别
        #[allow(unused_variables)]  // audio_data 在可选模块中使用，如果模块未启用则未使用
        let speech_rate = if features.map(|f| f.speech_rate_detection).unwrap_or(false) {
            // 估算音频时长（简化实现）
            let duration = request.audio_data.len() as f32 / 16000.0 / 2.0; // 假设 16kHz, 16bit
            if let Some(ref m) = self.speech_rate_detector {
                let module = m.read().await;
                if InferenceModule::is_enabled(&*module) {
                    module.detect(&request.audio_data, duration).await.ok()
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        // 3. NMT: 机器翻译（必需，使用动态确定的翻译方向）
        let translation = self.nmt_engine.translate(&transcript, &src_lang, &tgt_lang).await?;

        // 4. TTS: 语音合成（必需，使用目标语言）
        let audio = self.tts_engine.synthesize(&translation, &tgt_lang).await?;

        // 6. 可选：语速控制
        let mut final_audio = audio;
        if features.map(|f| f.speech_rate_control).unwrap_or(false) && speech_rate.is_some() {
            if let Some(ref controller) = self.speech_rate_controller {
                let module = controller.read().await;
                if InferenceModule::is_enabled(&*module) {
                    // 假设目标语速为 1.0（正常速度）
                    let target_rate = 1.0;
                    final_audio = module.adjust_audio(&final_audio, target_rate, speech_rate.unwrap())?;
                }
            }
        }

        // 7. 可选：音色克隆
        if features.map(|f| f.voice_cloning).unwrap_or(false) && speaker_id.is_some() {
            if let Some(ref cloner) = self.voice_cloner {
                let module = cloner.read().await;
                if InferenceModule::is_enabled(&*module) {
                    final_audio = module.clone_voice(&translation, &speaker_id.as_ref().unwrap()).await?;
                }
            }
        }

        Ok(InferenceResult {
            transcript,
            translation,
            audio: final_audio,
            speaker_id,
            speech_rate,
            emotion: None, // TODO: 实现情感分析
        })
    }
}

