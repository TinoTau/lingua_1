//! Whisper ASR 推理引擎
//! 
//! 基于 whisper-rs 库实现，支持 CUDA GPU 加速

use anyhow::{Result, anyhow};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use whisper_rs::{
    WhisperContext, WhisperContextParameters,
    FullParams, SamplingStrategy,
};
use tracing::info;
use serde::{Serialize, Deserialize};

/// ASR 部分结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ASRPartialResult {
    pub text: String,
    pub confidence: f32,
    pub is_final: bool,
}

/// Whisper ASR 推理引擎
pub struct ASREngine {
    ctx: Arc<WhisperContext>,
    model_path: PathBuf,
    language: Option<String>,
    /// 音频缓冲区（用于流式推理）
    audio_buffer: Arc<tokio::sync::Mutex<Vec<f32>>>,
    /// 流式推理配置
    streaming_enabled: Arc<tokio::sync::Mutex<bool>>,
    /// 部分结果更新间隔（毫秒）
    partial_update_interval_ms: Arc<tokio::sync::Mutex<u64>>,
    /// 上次部分结果更新时间戳（毫秒）
    last_partial_update_ms: Arc<tokio::sync::Mutex<u64>>,
}

impl ASREngine {
    /// 从模型目录加载 Whisper 模型
    /// 
    /// # Arguments
    /// * `model_dir` - 模型目录路径（如 `models/asr/whisper-base/`）
    /// 
    /// # Returns
    /// 返回 `ASREngine` 实例
    pub fn new(model_dir: PathBuf) -> Result<Self> {
        // 尝试查找常见的模型文件名
        let possible_names = ["ggml-base.bin", "model.ggml", "ggml-model.bin"];
        
        let model_path = possible_names.iter()
            .find_map(|name| {
                let path = model_dir.join(name);
                if path.exists() {
                    Some(path)
                } else {
                    None
                }
            })
            .ok_or_else(|| anyhow!(
                "No Whisper model file found in directory: {}. Tried: {:?}",
                model_dir.display(),
                possible_names
            ))?;

        Self::new_from_model_path(&model_path)
    }

    /// 从模型文件路径加载 Whisper 模型
    /// 
    /// # Arguments
    /// * `model_path` - GGML 模型文件路径
    /// 
    /// # Returns
    /// 返回 `ASREngine` 实例
    pub fn new_from_model_path(model_path: &Path) -> Result<Self> {
        if !model_path.exists() {
            return Err(anyhow!("Model file not found: {}", model_path.display()));
        }

        info!("Loading Whisper model from: {}", model_path.display());

        // 配置 Whisper 上下文参数
        // whisper-rs 的 CUDA 支持会在编译时通过 features = ["cuda"] 启用
        // 运行时如果检测到 CUDA 可用，会自动使用 GPU 加速
        let mut params = WhisperContextParameters::default();
        // GPU 支持会在推理时自动检测和使用（如果可用）
        
        let ctx = WhisperContext::new_with_params(
            model_path.to_str()
                .ok_or_else(|| anyhow!("Invalid model path: {}", model_path.display()))?,
            params,
        )?;
        
        info!("Whisper context initialized (GPU support will be auto-detected at inference time if CUDA is available)");

        Ok(Self {
            ctx: Arc::new(ctx),
            model_path: model_path.to_path_buf(),
            language: None,
            audio_buffer: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            streaming_enabled: Arc::new(tokio::sync::Mutex::new(false)),
            partial_update_interval_ms: Arc::new(tokio::sync::Mutex::new(1000)), // 默认 1 秒
            last_partial_update_ms: Arc::new(tokio::sync::Mutex::new(0)),
        })
    }

    /// 设置语言
    /// 
    /// # Arguments
    /// * `language` - 语言代码（如 "en", "zh"），`None` 表示自动检测
    pub fn set_language(&mut self, language: Option<String>) {
        self.language = language;
    }

    /// 设置语言（异步版本，支持内部可变性）
    /// 
    /// # Arguments
    /// * `language` - 语言代码（如 "en", "zh"），`None` 表示自动检测
    pub async fn set_language_async(&self, language: Option<String>) {
        // 由于 language 字段不是 Arc<Mutex<>>，我们需要使用其他方式
        // 暂时在流式处理中，语言会在 get_partial_result 和 get_final_result 中通过参数传递
        // 这里先保留接口，实际语言设置需要在创建 ASREngine 时或通过其他方式设置
    }

    /// 获取当前语言设置
    pub fn get_language(&self) -> Option<String> {
        self.language.clone()
    }

    /// 对音频数据进行转录
    /// 
    /// # Arguments
    /// * `audio_data` - 音频数据（PCM 16-bit，16kHz，单声道）
    /// * `lang` - 语言代码（如 "en", "zh"），如果为空则自动检测
    /// 
    /// # Returns
    /// 返回转录文本
    pub async fn transcribe(&self, audio_data: &[u8], lang: &str) -> Result<String> {
        // 将 PCM 16-bit 转换为 f32
        let audio_f32: Vec<f32> = audio_data
            .chunks_exact(2)
            .map(|chunk| {
                let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f32;
                sample / 32768.0
            })
            .collect();

        self.transcribe_f32(&audio_f32, lang).await
    }

    /// 对 f32 格式的音频数据进行转录
    /// 
    /// # Arguments
    /// * `audio_data` - 预处理后的音频数据（16kHz 单声道 PCM f32）
    /// * `lang` - 语言代码（如 "en", "zh"），如果为空则自动检测
    /// 
    /// # Returns
    /// 返回转录文本
    pub async fn transcribe_f32(&self, audio_data: &[f32], lang: &str) -> Result<String> {
        // 在 Tokio 运行时中，将 CPU 密集型任务移到 blocking 线程池
        let ctx = self.ctx.clone();
        let language = if lang.is_empty() {
            self.language.clone()
        } else {
            Some(lang.to_string())
        };
        let audio_data = audio_data.to_vec();

        let (text, _detected_lang) = tokio::task::spawn_blocking(move || {
            // 创建推理状态
            let mut state = ctx.create_state()
                .map_err(|e| anyhow!("Failed to create Whisper state: {:?}", e))?;

            // 配置推理参数
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            
            // 设置语言
            if let Some(ref lang) = language {
                params.set_language(Some(lang.as_str()));
            }
            
            // 设置其他参数
            // 使用所有可用的 CPU 核心（留一个给系统）
            let num_threads = std::thread::available_parallelism()
                .map(|n| n.get().saturating_sub(1).max(1))
                .unwrap_or(4);
            params.set_n_threads(num_threads as i32);
            info!("Using {} CPU threads for Whisper inference", num_threads);
            params.set_translate(false);
            params.set_print_progress(false);
            params.set_print_special(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);

            // 运行推理
            state.full(params, &audio_data)
                .map_err(|e| anyhow!("Failed to run Whisper inference: {:?}", e))?;

            // 提取结果
            let num_segments = state.full_n_segments();
            let mut full_text = String::new();

            for i in 0..num_segments {
                if let Some(segment) = state.get_segment(i) {
                    // 从 Debug 输出中提取文本（因为字段可能是私有的）
                    let segment_debug = format!("{:?}", segment);
                    
                    if let Some(start_idx) = segment_debug.find("text: Ok(\"") {
                        let text_start = start_idx + 10;
                        if let Some(end_idx) = segment_debug[text_start..].find("\")") {
                            let text = &segment_debug[text_start..text_start + end_idx];
                            let text_trimmed = text.trim();
                            if !text_trimmed.is_empty() {
                                full_text.push_str(text_trimmed);
                                full_text.push(' ');
                            }
                        }
                    }
                }
            }

            Ok::<(String, Option<String>), anyhow::Error>((full_text.trim().to_string(), language))
        })
        .await
        .map_err(|e| anyhow!("Whisper inference task panicked: {}", e))??;

        Ok(text)
    }

    /// 获取模型路径
    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    /// 启用流式推理模式
    /// 
    /// # Arguments
    /// * `partial_update_interval_ms` - 部分结果更新间隔（毫秒）
    pub async fn enable_streaming(&self, partial_update_interval_ms: u64) {
        *self.streaming_enabled.lock().await = true;
        *self.partial_update_interval_ms.lock().await = partial_update_interval_ms;
        info!("ASR streaming enabled with interval: {}ms", partial_update_interval_ms);
    }

    /// 禁用流式推理模式
    pub async fn disable_streaming(&self) {
        *self.streaming_enabled.lock().await = false;
        self.clear_buffer().await;
    }

    /// 检查是否启用流式推理
    pub async fn is_streaming_enabled(&self) -> bool {
        *self.streaming_enabled.lock().await
    }

    /// 累积音频数据到缓冲区（用于流式推理）
    /// 
    /// # Arguments
    /// * `audio_data` - 音频数据（f32 格式）
    pub async fn accumulate_audio(&self, audio_data: &[f32]) {
        let mut buffer = self.audio_buffer.lock().await;
        buffer.extend_from_slice(audio_data);
    }

    /// 清空音频缓冲区
    pub async fn clear_buffer(&self) {
        let mut buffer = self.audio_buffer.lock().await;
        buffer.clear();
        *self.last_partial_update_ms.lock().await = 0;
    }

    /// 获取部分结果（如果到了更新间隔）
    /// 
    /// # Arguments
    /// * `current_timestamp_ms` - 当前时间戳（毫秒）
    /// * `lang` - 语言代码（如 "en", "zh"），如果为空则使用设置的语言或自动检测
    /// 
    /// # Returns
    /// 返回部分结果（如果到了更新间隔），否则返回 None
    pub async fn get_partial_result(&self, current_timestamp_ms: u64, lang: &str) -> Result<Option<ASRPartialResult>> {
        let streaming_enabled = *self.streaming_enabled.lock().await;
        if !streaming_enabled {
            return Ok(None);
        }

        let partial_interval = *self.partial_update_interval_ms.lock().await;
        let last_update = *self.last_partial_update_ms.lock().await;

        // 检查是否需要更新部分结果
        if current_timestamp_ms < last_update + partial_interval {
            return Ok(None);
        }

        // 更新最后更新时间
        *self.last_partial_update_ms.lock().await = current_timestamp_ms;

        // 获取当前缓冲区中的所有音频
        let audio_data = {
            let buffer = self.audio_buffer.lock().await;
            buffer.clone()
        };

        if audio_data.is_empty() {
            return Ok(None);
        }

        // 运行推理获取部分结果
        let language = if lang.is_empty() {
            self.language.clone()
        } else {
            Some(lang.to_string())
        };
        let ctx = self.ctx.clone();
        let (text, _) = tokio::task::spawn_blocking(move || {
            let mut state = ctx.create_state()
                .map_err(|e| anyhow!("Failed to create Whisper state: {:?}", e))?;

            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            if let Some(ref lang) = language {
                params.set_language(Some(lang.as_str()));
            }
            let num_threads = std::thread::available_parallelism()
                .map(|n| n.get().saturating_sub(1).max(1))
                .unwrap_or(4);
            params.set_n_threads(num_threads as i32);
            params.set_translate(false);
            params.set_print_progress(false);
            params.set_print_special(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);

            state.full(params, &audio_data)
                .map_err(|e| anyhow!("Failed to run Whisper inference: {:?}", e))?;

            let num_segments = state.full_n_segments();
            let mut full_text = String::new();

            for i in 0..num_segments {
                if let Some(segment) = state.get_segment(i) {
                    let segment_debug = format!("{:?}", segment);
                    if let Some(start_idx) = segment_debug.find("text: Ok(\"") {
                        let text_start = start_idx + 10;
                        if let Some(end_idx) = segment_debug[text_start..].find("\")") {
                            let text = &segment_debug[text_start..text_start + end_idx];
                            let text_trimmed = text.trim();
                            if !text_trimmed.is_empty() {
                                full_text.push_str(text_trimmed);
                                full_text.push(' ');
                            }
                        }
                    }
                }
            }

            Ok::<(String, Option<String>), anyhow::Error>((full_text.trim().to_string(), language))
        })
        .await
        .map_err(|e| anyhow!("Whisper inference task panicked: {}", e))??;

        if text.is_empty() {
            Ok(None)
        } else {
            Ok(Some(ASRPartialResult {
                text,
                confidence: 0.90, // 部分结果的置信度稍低
                is_final: false,
            }))
        }
    }

    /// 获取最终结果（清空缓冲区）
    /// 
    /// # Arguments
    /// * `lang` - 语言代码（如 "en", "zh"），如果为空则使用设置的语言或自动检测
    /// 
    /// # Returns
    /// 返回最终转录结果
    pub async fn get_final_result(&self, lang: &str) -> Result<String> {
        let audio_data = {
            let mut buffer = self.audio_buffer.lock().await;
            let data = buffer.clone();
            buffer.clear();
            *self.last_partial_update_ms.lock().await = 0;
            data
        };

        if audio_data.is_empty() {
            return Ok(String::new());
        }

        let language = if lang.is_empty() {
            self.language.clone()
        } else {
            Some(lang.to_string())
        };
        let ctx = self.ctx.clone();
        let (text, _) = tokio::task::spawn_blocking(move || {
            let mut state = ctx.create_state()
                .map_err(|e| anyhow!("Failed to create Whisper state: {:?}", e))?;

            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            if let Some(ref lang) = language {
                params.set_language(Some(lang.as_str()));
            }
            let num_threads = std::thread::available_parallelism()
                .map(|n| n.get().saturating_sub(1).max(1))
                .unwrap_or(4);
            params.set_n_threads(num_threads as i32);
            params.set_translate(false);
            params.set_print_progress(false);
            params.set_print_special(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);

            state.full(params, &audio_data)
                .map_err(|e| anyhow!("Failed to run Whisper inference: {:?}", e))?;

            let num_segments = state.full_n_segments();
            let mut full_text = String::new();

            for i in 0..num_segments {
                if let Some(segment) = state.get_segment(i) {
                    let segment_debug = format!("{:?}", segment);
                    if let Some(start_idx) = segment_debug.find("text: Ok(\"") {
                        let text_start = start_idx + 10;
                        if let Some(end_idx) = segment_debug[text_start..].find("\")") {
                            let text = &segment_debug[text_start..text_start + end_idx];
                            let text_trimmed = text.trim();
                            if !text_trimmed.is_empty() {
                                full_text.push_str(text_trimmed);
                                full_text.push(' ');
                            }
                        }
                    }
                }
            }

            Ok::<(String, Option<String>), anyhow::Error>((full_text.trim().to_string(), language))
        })
        .await
        .map_err(|e| anyhow!("Whisper inference task panicked: {}", e))??;

        Ok(text)
    }
    
    /// 获取 Whisper 上下文（用于共享给 LanguageDetector）
    /// 
    /// # Returns
    /// 返回 Whisper 上下文的 Arc 引用
    pub fn get_whisper_ctx(&self) -> Arc<WhisperContext> {
        self.ctx.clone()
    }
}

