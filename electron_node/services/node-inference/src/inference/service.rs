//! 推理服务结构体与生命周期方法

use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

use crate::asr;
use crate::language_detector;
use crate::modules::{InferenceModule, ModuleManager};
use crate::nmt;
use crate::speaker;
use crate::speech_rate;
use crate::tts;
use crate::vad;

use super::types::{InferenceRequest, InferenceResult, PartialResultCallback};

/// 推理服务（字段 pub(crate) 供 process 子模块访问，不改变对外 API）
pub struct InferenceService {
    pub(crate) asr_engine: asr::ASREngine,
    pub(crate) nmt_engine: nmt::NMTEngine,
    pub(crate) tts_engine: tts::TTSEngine,
    pub(crate) vad_engine: vad::VADEngine,
    pub(crate) language_detector: Option<language_detector::LanguageDetector>,
    pub(crate) speaker_identifier: Option<Arc<tokio::sync::RwLock<speaker::SpeakerIdentifier>>>,
    pub(crate) voice_cloner: Option<Arc<tokio::sync::RwLock<speaker::VoiceCloner>>>,
    pub(crate) speech_rate_detector: Option<Arc<tokio::sync::RwLock<speech_rate::SpeechRateDetector>>>,
    pub(crate) speech_rate_controller: Option<Arc<tokio::sync::RwLock<speech_rate::SpeechRateController>>>,
    pub(crate) module_manager: ModuleManager,
    pub(crate) context_buffer: Arc<tokio::sync::Mutex<Vec<f32>>>,
}

impl InferenceService {
    pub fn new(models_dir: PathBuf) -> Result<Self> {
        let asr_engine = asr::ASREngine::new(models_dir.join("asr").join("whisper-base"))?;
        let nmt_engine = nmt::NMTEngine::new_with_http_client(None)?;
        let tts_engine = tts::TTSEngine::new(None)?;
        let vad_engine = vad::VADEngine::new(models_dir.join("vad").join("silero"))?;

        let whisper_ctx = asr_engine.get_whisper_ctx();
        let language_detector = Some(language_detector::LanguageDetector::new(
            whisper_ctx,
            None,
        ));

        let module_manager = ModuleManager::new();

        let speaker_identifier = Some(Arc::new(tokio::sync::RwLock::new(speaker::SpeakerIdentifier::new())));
        let voice_cloner = Some(Arc::new(tokio::sync::RwLock::new(speaker::VoiceCloner::new())));

        Ok(Self {
            asr_engine,
            nmt_engine,
            tts_engine,
            vad_engine,
            language_detector,
            speaker_identifier,
            voice_cloner,
            speech_rate_detector: None,
            speech_rate_controller: None,
            module_manager,
            context_buffer: Arc::new(tokio::sync::Mutex::new(Vec::new())),
        })
    }

    pub async fn enable_module(&self, module_name: &str) -> Result<()> {
        self.module_manager.enable_module(module_name).await?;

        match module_name {
            "speaker_identification" => {
                if let Some(ref m) = self.speaker_identifier {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                } else {
                    return Err(anyhow::anyhow!("Module {} not initialized. Please initialize it first.", module_name));
                }
            }
            "voice_cloning" => {
                if let Some(ref m) = self.voice_cloner {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                } else {
                    return Err(anyhow::anyhow!("Module {} not initialized. Please initialize it first.", module_name));
                }
            }
            "speech_rate_detection" => {
                if let Some(ref m) = self.speech_rate_detector {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                } else {
                    return Err(anyhow::anyhow!("Module {} not initialized. Please initialize it first.", module_name));
                }
            }
            "speech_rate_control" => {
                if let Some(ref m) = self.speech_rate_controller {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                } else {
                    return Err(anyhow::anyhow!("Module {} not initialized. Please initialize it first.", module_name));
                }
            }
            "emotion_detection" => {
                return Err(anyhow::anyhow!("Module {} not yet implemented.", module_name));
            }
            "persona_adaptation" => {
                return Err(anyhow::anyhow!("Module {} not yet implemented.", module_name));
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

    pub async fn clear_context_buffer(&self) {
        let mut context = self.context_buffer.lock().await;
        let previous_size = context.len();
        context.clear();
        if let Err(e) = self.vad_engine.reset_state() {
            tracing::warn!("重置VAD状态失败: {}", e);
        }
        info!(
            previous_context_samples = previous_size,
            previous_context_duration_sec = (previous_size as f32 / 16000.0),
            "🗑️ 上下文缓冲区和VAD状态已清空"
        );
    }

    pub async fn get_context_buffer_size(&self) -> usize {
        let context = self.context_buffer.lock().await;
        context.len()
    }

    pub async fn process(&self, request: InferenceRequest, partial_callback: Option<PartialResultCallback>) -> Result<InferenceResult> {
        super::process::run_process(self, request, partial_callback).await
    }
}
