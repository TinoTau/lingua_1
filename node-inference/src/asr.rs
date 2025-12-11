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

/// Whisper ASR 推理引擎
pub struct ASREngine {
    ctx: Arc<WhisperContext>,
    model_path: PathBuf,
    language: Option<String>,
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
        })
    }

    /// 设置语言
    /// 
    /// # Arguments
    /// * `language` - 语言代码（如 "en", "zh"），`None` 表示自动检测
    pub fn set_language(&mut self, language: Option<String>) {
        self.language = language;
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
}

