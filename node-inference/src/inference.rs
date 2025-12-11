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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    pub job_id: String,
    pub src_lang: String,
    pub tgt_lang: String,
    pub audio_data: Vec<u8>, // PCM audio data
    pub features: Option<FeatureSet>, // 可选功能请求
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

        let module_manager = ModuleManager::new();

        Ok(Self {
            asr_engine,
            nmt_engine,
            tts_engine,
            vad_engine,
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
        
        // 1. ASR: 语音识别（必需）
        let transcript = self.asr_engine.transcribe(&request.audio_data, &request.src_lang).await?;

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

        // 4. NMT: 机器翻译（必需）
        let translation = self.nmt_engine.translate(&transcript, &request.src_lang, &request.tgt_lang).await?;

        // 5. TTS: 语音合成（必需）
        let audio = self.tts_engine.synthesize(&translation, &request.tgt_lang).await?;

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

