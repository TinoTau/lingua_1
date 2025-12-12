//! 推理服务核心类型和实现

use anyhow::Result;
use serde::{Deserialize, Serialize};  // Deserialize 在 InferenceRequest/InferenceResult 中使用（用于 JSON 反序列化）
use std::path::PathBuf;

use crate::modules::{FeatureSet, ModuleManager, InferenceModule};
use crate::pipeline::PipelineContext;
use crate::asr;
use crate::nmt;
use crate::tts;
use crate::vad;
use crate::speaker;
use crate::speech_rate;
use crate::language_detector;
use std::sync::Arc;

/// 部分结果回调函数类型
pub type PartialResultCallback = Arc<dyn Fn(asr::ASRPartialResult) + Send + Sync>;

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
    /// 是否启用流式 ASR（部分结果输出）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_streaming_asr: Option<bool>,
    /// 部分结果更新间隔（毫秒），仅在 enable_streaming_asr 为 true 时有效
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_update_interval_ms: Option<u64>,
    /// 追踪 ID（用于全链路日志追踪）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
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
        let whisper_ctx = asr_engine.get_whisper_ctx();
        let language_detector = Some(language_detector::LanguageDetector::new(
            whisper_ctx,
            None,  // 使用默认配置
        ));

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

    /// 启用模块（完整流程）
    /// 
    /// 按照 v2 技术说明书的要求：
    /// 1. 使用 ModuleManager 进行依赖检查、冲突检查、模型检查
    /// 2. 如果检查通过，加载模块模型
    /// 3. 标记模块为已启用
    pub async fn enable_module(&self, module_name: &str) -> Result<()> {
        // 步骤 1: 使用 ModuleManager 进行所有检查（依赖、冲突、模型）
        self.module_manager.enable_module(module_name).await?;
        
        // 步骤 2: 如果检查通过，加载模块模型
        match module_name {
            "speaker_identification" => {
                if let Some(ref m) = self.speaker_identifier {
                    let mut module = m.write().await;
                    InferenceModule::enable(&mut *module).await?;
                } else {
                    // 模块未初始化，尝试创建（cold-load）
                    // TODO: 实现模块的延迟初始化逻辑
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
                // TODO: 实现情感检测模块
                return Err(anyhow::anyhow!("Module {} not yet implemented.", module_name));
            }
            "persona_adaptation" => {
                // TODO: 实现个性化适配模块
                return Err(anyhow::anyhow!("Module {} not yet implemented.", module_name));
            }
            _ => return Err(anyhow::anyhow!("Unknown module: {}", module_name)),
        }
        
        // 步骤 3: 更新模块状态为 model_loaded
        // 注意：ModuleManager 的 states 是私有的，我们需要通过其他方式更新
        // 当前实现中，ModuleManager::enable_module 已经更新了状态
        // 我们只需要确保模块的 model_loaded 标志正确设置
        
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

    /// 处理推理请求（支持部分结果回调）
    /// 
    /// # Arguments
    /// * `request` - 推理请求
    /// * `partial_callback` - 部分结果回调（可选）
    pub async fn process(&self, request: InferenceRequest, partial_callback: Option<PartialResultCallback>) -> Result<InferenceResult> {
        // 使用 trace_id 进行日志记录（如果提供）
        let trace_id = request.trace_id.as_deref().unwrap_or("unknown");
        use tracing::{info, warn, debug};
        
        debug!(trace_id = %trace_id, job_id = %request.job_id, "开始处理推理请求");
        
        // 根据请求中的 features 自动启用所需模块（运行时动态启用）
        if let Some(ref features) = request.features {
            // 根据任务需求自动启用模块
            if features.speaker_identification {
                let _ = self.enable_module("speaker_identification").await;
            }
            if features.voice_cloning {
                let _ = self.enable_module("voice_cloning").await;
            }
            if features.speech_rate_detection {
                let _ = self.enable_module("speech_rate_detection").await;
            }
            if features.speech_rate_control {
                let _ = self.enable_module("speech_rate_control").await;
            }
            // TODO: 当实现情感检测和个性化适配模块时，添加相应的启用逻辑
            // if features.emotion_detection {
            //     let _ = self.enable_module("emotion_detection").await;
            // }
            // if features.persona_adaptation {
            //     let _ = self.enable_module("persona_adaptation").await;
            // }
        }
        
        // 使用 PipelineContext 统一管理数据流
        let mut ctx = PipelineContext::from_audio(request.audio_data.clone());
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
            debug!(trace_id = %trace_id, "开始语言检测");
            if let Some(ref detector) = self.language_detector {
                match detector.detect(&audio_f32, 16000).await {
                    Ok(detection) => {
                        info!(trace_id = %trace_id, lang = %detection.lang, confidence = %detection.confidence, "语言检测完成");
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
                        warn!(trace_id = %trace_id, error = %e, default_lang = %src_lang, "语言检测失败，使用默认语言");
                        // 使用默认语言（如果配置了 auto_langs，使用第一个）
                        if let Some(ref auto_langs) = request.auto_langs {
                            if !auto_langs.is_empty() {
                                src_lang = auto_langs[0].clone();
                            }
                        }
                    }
                }
            } else {
                warn!(trace_id = %trace_id, "语言检测请求但检测器不可用，使用默认语言");
                // 如果没有语言检测器，使用默认语言
                if let Some(ref auto_langs) = request.auto_langs {
                    if !auto_langs.is_empty() {
                        src_lang = auto_langs[0].clone();
                    }
                }
            }
        }
        
        // 2. ASR: 语音识别（必需，使用检测到的语言）
        debug!(trace_id = %trace_id, src_lang = %src_lang, "开始 ASR 语音识别");
        // 如果启用了流式 ASR，使用流式处理；否则使用一次性处理
        let transcript = if request.enable_streaming_asr.unwrap_or(false) {
            // 启用流式 ASR
            let interval_ms = request.partial_update_interval_ms.unwrap_or(1000);
            self.asr_engine.enable_streaming(interval_ms).await;
            
            // 设置语言（需要在流式处理前设置）
            // 注意：ASREngine 的 set_language 需要 &mut，但这里我们使用内部可变性
            // 由于 ASREngine 内部使用 Arc，我们需要修改设计或使用其他方式
            // 暂时在流式处理中，语言会在 get_partial_result 和 get_final_result 中使用 self.language
            
            // 将音频数据分块处理（模拟流式输入）
            // 每块约 0.5 秒（8000 个样本 @ 16kHz）
            let chunk_size = 8000;
            let mut current_timestamp_ms = 0u64;
            let sample_rate = 16000u32;
            let chunk_duration_ms = (chunk_size * 1000) / sample_rate;
            
            // 清空缓冲区
            self.asr_engine.clear_buffer().await;
            
            // 分块累积音频并定期获取部分结果
            for chunk in audio_f32.chunks(chunk_size as usize) {
                // 累积音频块
                self.asr_engine.accumulate_audio(chunk).await;
                
                // 检查是否需要输出部分结果
                if let Some(partial) = self.asr_engine.get_partial_result(current_timestamp_ms, &src_lang).await? {
                    // 通过回调发送部分结果
                    if let Some(ref callback) = partial_callback {
                        callback(partial.clone());
                    }
                }
                
                current_timestamp_ms += chunk_duration_ms as u64;
            }
            
            // 获取最终结果
            let final_text = self.asr_engine.get_final_result(&src_lang).await?;
            // 禁用流式模式
            self.asr_engine.disable_streaming().await;
            final_text
        } else {
            // 一次性处理
            self.asr_engine.transcribe_f32(&audio_f32, &src_lang).await?
        };
        
        // 将 ASR 结果写入 PipelineContext
        ctx.set_transcript(transcript.clone());
        info!(trace_id = %trace_id, transcript_len = transcript.len(), "ASR 识别完成");

        // 3. 可选模块处理（使用 PipelineContext）
        // 3.1 音色识别
        if features.map(|f| f.speaker_identification).unwrap_or(false) {
            if let Some(ref m) = self.speaker_identifier {
                let module = m.read().await;
                if InferenceModule::is_enabled(&*module) {
                    if let Ok(speaker_id) = module.identify(&request.audio_data).await {
                        ctx.set_speaker_id(speaker_id);
                    }
                }
            }
        }

        // 3.2 语速识别
        if features.map(|f| f.speech_rate_detection).unwrap_or(false) {
            // 估算音频时长（简化实现）
            let duration = request.audio_data.len() as f32 / 16000.0 / 2.0; // 假设 16kHz, 16bit
            if let Some(ref m) = self.speech_rate_detector {
                let module = m.read().await;
                if InferenceModule::is_enabled(&*module) {
                    if let Ok(rate) = module.detect(&request.audio_data, duration).await {
                        ctx.set_speech_rate(rate);
                    }
                }
            }
        }

        // 3.3 情感检测（需要 transcript）
        if features.map(|f| f.emotion_detection).unwrap_or(false) {
            // TODO: 实现情感检测模块
            // 当前先跳过，待实现 emotion_detection 模块
        }

        // 3.4 个性化适配（需要 transcript）
        if features.map(|f| f.persona_adaptation).unwrap_or(false) {
            // TODO: 实现个性化适配模块
            // 当前先跳过，待实现 persona_adaptation 模块
        }

        // 4. NMT: 机器翻译（必需，使用动态确定的翻译方向）
        debug!(trace_id = %trace_id, src_lang = %src_lang, tgt_lang = %tgt_lang, "开始机器翻译");
        let translation = self.nmt_engine.translate(&transcript, &src_lang, &tgt_lang).await?;
        
        // 将翻译结果写入 PipelineContext
        ctx.set_translation(translation.clone());
        info!(trace_id = %trace_id, translation_len = translation.len(), "机器翻译完成");

        // 5. TTS: 语音合成（必需，使用目标语言）
        debug!(trace_id = %trace_id, tgt_lang = %tgt_lang, "开始语音合成");
        let mut audio = self.tts_engine.synthesize(&translation, &tgt_lang).await?;
        info!(trace_id = %trace_id, audio_len = audio.len(), "语音合成完成");

        // 6. 可选：语速控制（需要语速识别结果）
        if features.map(|f| f.speech_rate_control).unwrap_or(false) {
            if let Some(rate) = ctx.speech_rate {
                if let Some(ref controller) = self.speech_rate_controller {
                    let module = controller.read().await;
                    if InferenceModule::is_enabled(&*module) {
                        // 假设目标语速为 1.0（正常速度）
                        let target_rate = 1.0;
                        if let Ok(adjusted) = module.adjust_audio(&audio, target_rate, rate) {
                            audio = adjusted;
                        }
                    }
                }
            }
        }

        // 7. 可选：音色克隆（需要音色识别结果）
        if features.map(|f| f.voice_cloning).unwrap_or(false) {
            if let Some(ref speaker_id) = ctx.speaker_id {
                if let Some(ref cloner) = self.voice_cloner {
                    let module = cloner.read().await;
                    if InferenceModule::is_enabled(&*module) {
                        if let Ok(cloned) = module.clone_voice(&translation, speaker_id).await {
                            audio = cloned;
                        }
                    }
                }
            }
        }
        
        // 将最终 TTS 音频写入 PipelineContext
        ctx.set_tts_audio(audio.clone());

        // 从 PipelineContext 构建 InferenceResult
        info!(trace_id = %trace_id, job_id = %request.job_id, "推理请求处理完成");
        Ok(InferenceResult {
            transcript: ctx.transcript.unwrap_or_default(),
            translation: ctx.translation.unwrap_or_default(),
            audio,
            speaker_id: ctx.speaker_id,
            speech_rate: ctx.speech_rate,
            emotion: ctx.emotion,
        })
    }
}

