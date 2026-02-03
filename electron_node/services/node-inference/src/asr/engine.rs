//! Whisper ASR 推理引擎

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::info;
use whisper_rs::{WhisperContext, WhisperContextParameters};

use super::whisper_run;

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
    audio_buffer: Arc<tokio::sync::Mutex<Vec<f32>>>,
    streaming_enabled: Arc<tokio::sync::Mutex<bool>>,
    partial_update_interval_ms: Arc<tokio::sync::Mutex<u64>>,
    last_partial_update_ms: Arc<tokio::sync::Mutex<u64>>,
}

impl ASREngine {
    pub fn new(model_dir: PathBuf) -> Result<Self> {
        let possible_names = ["ggml-base.bin", "model.ggml", "ggml-model.bin"];
        let model_path = possible_names
            .iter()
            .find_map(|name| {
                let path = model_dir.join(name);
                if path.exists() {
                    Some(path)
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                anyhow!(
                    "No Whisper model file found in directory: {}. Tried: {:?}",
                    model_dir.display(),
                    possible_names
                )
            })?;

        Self::new_from_model_path(&model_path)
    }

    pub fn new_from_model_path(model_path: &Path) -> Result<Self> {
        if !model_path.exists() {
            return Err(anyhow!("Model file not found: {}", model_path.display()));
        }

        info!("Loading Whisper model from: {}", model_path.display());

        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(
            model_path
                .to_str()
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
            partial_update_interval_ms: Arc::new(tokio::sync::Mutex::new(1000)),
            last_partial_update_ms: Arc::new(tokio::sync::Mutex::new(0)),
        })
    }

    pub fn set_language(&mut self, language: Option<String>) {
        self.language = language;
    }

    pub async fn set_language_async(&self, _language: Option<String>) {}

    pub fn get_language(&self) -> Option<String> {
        self.language.clone()
    }

    pub async fn transcribe(&self, audio_data: &[u8], lang: &str) -> Result<String> {
        let audio_f32: Vec<f32> = audio_data
            .chunks_exact(2)
            .map(|chunk| {
                let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as f32;
                sample / 32768.0
            })
            .collect();

        self.transcribe_f32(&audio_f32, lang).await
    }

    pub async fn transcribe_f32(&self, audio_data: &[f32], lang: &str) -> Result<String> {
        let ctx = self.ctx.clone();
        let language = if lang.is_empty() {
            self.language.clone()
        } else {
            Some(lang.to_string())
        };
        let audio_data = audio_data.to_vec();

        let text = tokio::task::spawn_blocking(move || whisper_run::run_whisper_sync(ctx, audio_data, language))
            .await
            .map_err(|e| anyhow!("Whisper inference task panicked: {}", e))??;

        let filtered_text = crate::text_filter::filter_asr_text(&text);
        if text != filtered_text {
            tracing::info!(
                "[ASR] Final text filtered in transcribe_f32: \"{}\" -> \"{}\"",
                text,
                filtered_text
            );
        }
        if !filtered_text.is_empty()
            && (filtered_text.contains('(')
                || filtered_text.contains('（')
                || filtered_text.contains('[')
                || filtered_text.contains('【'))
        {
            tracing::warn!(
                "[ASR] ⚠️ Final text in transcribe_f32 still contains brackets: \"{}\"",
                filtered_text
            );
        }
        Ok(filtered_text)
    }

    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    pub async fn enable_streaming(&self, partial_update_interval_ms: u64) {
        *self.streaming_enabled.lock().await = true;
        *self.partial_update_interval_ms.lock().await = partial_update_interval_ms;
        info!(
            "ASR streaming enabled with interval: {}ms",
            partial_update_interval_ms
        );
    }

    pub async fn disable_streaming(&self) {
        *self.streaming_enabled.lock().await = false;
        self.clear_buffer().await;
    }

    pub async fn is_streaming_enabled(&self) -> bool {
        *self.streaming_enabled.lock().await
    }

    pub async fn accumulate_audio(&self, audio_data: &[f32]) {
        let mut buffer = self.audio_buffer.lock().await;
        buffer.extend_from_slice(audio_data);
    }

    pub async fn clear_buffer(&self) {
        let mut buffer = self.audio_buffer.lock().await;
        buffer.clear();
        *self.last_partial_update_ms.lock().await = 0;
    }

    pub async fn get_partial_result(&self, current_timestamp_ms: u64, lang: &str) -> Result<Option<ASRPartialResult>> {
        let streaming_enabled = *self.streaming_enabled.lock().await;
        if !streaming_enabled {
            return Ok(None);
        }

        let partial_interval = *self.partial_update_interval_ms.lock().await;
        let last_update = *self.last_partial_update_ms.lock().await;

        if current_timestamp_ms < last_update + partial_interval {
            return Ok(None);
        }

        *self.last_partial_update_ms.lock().await = current_timestamp_ms;

        let audio_data = {
            let buffer = self.audio_buffer.lock().await;
            buffer.clone()
        };

        if audio_data.is_empty() {
            return Ok(None);
        }

        let language = if lang.is_empty() {
            self.language.clone()
        } else {
            Some(lang.to_string())
        };
        let ctx = self.ctx.clone();

        let text = tokio::task::spawn_blocking(move || whisper_run::run_whisper_sync(ctx, audio_data, language))
            .await
            .map_err(|e| anyhow!("Whisper inference task panicked: {}", e))??;

        let filtered_text = crate::text_filter::filter_asr_text(&text);
        if text != filtered_text {
            tracing::info!(
                "[ASR] Partial text filtered: \"{}\" -> \"{}\"",
                text,
                filtered_text
            );
        }
        if !filtered_text.is_empty()
            && (filtered_text.contains('(')
                || filtered_text.contains('（')
                || filtered_text.contains('[')
                || filtered_text.contains('【'))
        {
            tracing::warn!(
                "[ASR] ⚠️ Partial filtered text still contains brackets: \"{}\"",
                filtered_text
            );
        }
        if filtered_text.is_empty() {
            Ok(None)
        } else {
            Ok(Some(ASRPartialResult {
                text: filtered_text,
                confidence: 0.90,
                is_final: false,
            }))
        }
    }

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

        let text = tokio::task::spawn_blocking(move || whisper_run::run_whisper_sync(ctx, audio_data, language))
            .await
            .map_err(|e| anyhow!("Whisper inference task panicked: {}", e))??;

        let filtered_text = crate::text_filter::filter_asr_text(&text);
        if text != filtered_text {
            tracing::info!(
                "[ASR] Final result text filtered: \"{}\" -> \"{}\"",
                text,
                filtered_text
            );
        }
        if !filtered_text.is_empty()
            && (filtered_text.contains('(')
                || filtered_text.contains('（')
                || filtered_text.contains('[')
                || filtered_text.contains('【'))
        {
            tracing::warn!(
                "[ASR] ⚠️ Final result filtered text still contains brackets: \"{}\"",
                filtered_text
            );
        }
        Ok(filtered_text)
    }

    pub fn get_whisper_ctx(&self) -> Arc<WhisperContext> {
        self.ctx.clone()
    }
}
