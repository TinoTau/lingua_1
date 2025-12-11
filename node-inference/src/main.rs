use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

mod asr;
mod nmt;
mod tts;
mod vad;
mod modules;
mod speaker;
mod speech_rate;

use modules::{FeatureSet, ModuleManager};

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
    vad_engine: vad::VADEngine,
    
    // 可选模块（使用 Arc<RwLock<>> 以支持并发访问和动态修改）
    speaker_identifier: Option<std::sync::Arc<tokio::sync::RwLock<speaker::SpeakerIdentifier>>>,
    voice_cloner: Option<std::sync::Arc<tokio::sync::RwLock<speaker::VoiceCloner>>>,
    speech_rate_detector: Option<std::sync::Arc<tokio::sync::RwLock<speech_rate::SpeechRateDetector>>>,
    speech_rate_controller: Option<std::sync::Arc<tokio::sync::RwLock<speech_rate::SpeechRateController>>>,
    
    // 模块管理器
    module_manager: modules::ModuleManager,
}

impl InferenceService {
    pub fn new(models_dir: PathBuf) -> Result<Self> {
        let asr_engine = asr::ASREngine::new(models_dir.join("asr"))?;
        let nmt_engine = nmt::NMTEngine::new(models_dir.join("nmt"))?;
        let tts_engine = tts::TTSEngine::new()?;
        let vad_engine = vad::VADEngine::new(models_dir.join("vad"))?;

        let module_manager = modules::ModuleManager::new();

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
                    module.enable().await?;
                } else {
                    return Err(anyhow::anyhow!("Module {} not initialized. Please initialize it first.", module_name));
                }
                self.module_manager.enable_module(module_name).await?;
            }
            "voice_cloning" => {
                if let Some(ref m) = self.voice_cloner {
                    let mut module = m.write().await;
                    module.enable().await?;
                }
                self.module_manager.enable_module(module_name).await?;
            }
            "speech_rate_detection" => {
                if let Some(ref m) = self.speech_rate_detector {
                    let mut module = m.write().await;
                    module.enable().await?;
                }
                self.module_manager.enable_module(module_name).await?;
            }
            "speech_rate_control" => {
                if let Some(ref m) = self.speech_rate_controller {
                    let mut module = m.write().await;
                    module.enable().await?;
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
                    module.disable().await?;
                }
            }
            "voice_cloning" => {
                if let Some(ref m) = self.voice_cloner {
                    let mut module = m.write().await;
                    module.disable().await?;
                }
            }
            "speech_rate_detection" => {
                if let Some(ref m) = self.speech_rate_detector {
                    let mut module = m.write().await;
                    module.disable().await?;
                }
            }
            "speech_rate_control" => {
                if let Some(ref m) = self.speech_rate_controller {
                    let mut module = m.write().await;
                    module.disable().await?;
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
        let speaker_id = if features.map(|f| f.speaker_identification).unwrap_or(false) {
            if let Some(ref m) = self.speaker_identifier {
                let module = m.read().await;
                if module.is_enabled() {
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
        let speech_rate = if features.map(|f| f.speech_rate_detection).unwrap_or(false) {
            // 估算音频时长（简化实现）
            let duration = request.audio_data.len() as f32 / 16000.0 / 2.0; // 假设 16kHz, 16bit
            if let Some(ref m) = self.speech_rate_detector {
                let module = m.read().await;
                if module.is_enabled() {
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
        let mut audio = self.tts_engine.synthesize(&translation, &request.tgt_lang).await?;

        // 6. 可选：语速控制
        if features.map(|f| f.speech_rate_control).unwrap_or(false) && speech_rate.is_some() {
            if let Some(ref controller) = self.speech_rate_controller {
                let module = controller.read().await;
                if module.is_enabled() {
                    // 假设目标语速为 1.0（正常速度）
                    let target_rate = 1.0;
                    audio = module.adjust_audio(&audio, target_rate, speech_rate.unwrap())?;
                }
            }
        }

        // 7. 可选：音色克隆
        if features.map(|f| f.voice_cloning).unwrap_or(false) && speaker_id.is_some() {
            if let Some(ref cloner) = self.voice_cloner {
                let module = cloner.read().await;
                if module.is_enabled() {
                    audio = module.clone_voice(&translation, &speaker_id.as_ref().unwrap()).await?;
                }
            }
        }

        Ok(InferenceResult {
            transcript,
            translation,
            audio,
            speaker_id,
            speech_rate,
            emotion: None, // TODO: 实现情感分析
        })
    }
}

// 主函数（用于独立运行推理服务）
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let models_dir = PathBuf::from(std::env::var("MODELS_DIR").unwrap_or_else(|_| "./models".to_string()));
    let service = InferenceService::new(models_dir)?;

    // TODO: 实现 HTTP/gRPC 服务接口，供 Electron 节点调用
    // 当前作为库使用，由 Electron 节点直接调用

    Ok(())
}

