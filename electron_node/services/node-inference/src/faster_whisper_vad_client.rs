//! Faster Whisper + Silero VAD HTTP 客户端
//! 
//! 用于调用 Python HTTP 服务进行 ASR 和 VAD 处理

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use reqwest::Client;
use tracing::{info, error, debug};
use hound::{WavWriter, WavSpec};
use std::io::Cursor;
use base64::{Engine as _, engine::general_purpose};

/// Faster Whisper VAD 服务配置
#[derive(Debug, Clone)]
pub struct FasterWhisperVADClientConfig {
    /// HTTP 服务端点（例如：http://127.0.0.1:6007）
    pub endpoint: String,
    /// 请求超时时间（毫秒）
    pub timeout_ms: u64,
}

impl Default for FasterWhisperVADClientConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://127.0.0.1:6007".to_string(),
            timeout_ms: 30000,  // 30秒，ASR 可能需要较长时间
        }
    }
}

/// Utterance 请求（与 node-inference 的 HttpInferenceRequest 保持一致）
#[derive(Debug, Serialize)]
struct UtteranceRequest {
    job_id: String,
    src_lang: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tgt_lang: Option<String>,
    audio: String,  // Base64 encoded audio（与 node-inference 一致）
    #[serde(skip_serializing_if = "Option::is_none")]
    audio_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_rate: Option<u32>,
    // ASR 特定参数
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    task: String,
    beam_size: i32,  // 增加到10以提高准确度（从5增加到10，减少同音字错误）
    condition_on_previous_text: bool,
    use_context_buffer: bool,
    use_text_context: bool,
    // 新增：提高准确度的参数（可选，使用默认值）
    #[serde(skip_serializing_if = "Option::is_none")]
    best_of: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    patience: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    compression_ratio_threshold: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    log_prob_threshold: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    no_speech_threshold: Option<f32>,
    // 其他参数（与 node-inference 保持一致，但 ASR 服务不使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    features: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lang_a: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lang_b: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_langs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_streaming_asr: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    partial_update_interval_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_text: Option<String>,
}

/// Utterance 响应
#[derive(Debug, Deserialize)]
struct UtteranceResponse {
    text: String,
    segments: Vec<String>,
    language: Option<String>,
    duration: f64,
    vad_segments: Vec<[usize; 2]>,  // 语音段（样本索引）
}

/// 重置请求
#[derive(Debug, Serialize)]
struct ResetRequest {
    reset_vad: bool,
    reset_context: bool,
    reset_text_context: bool,
}

/// Faster Whisper VAD HTTP 客户端
pub struct FasterWhisperVADClient {
    client: Client,
    config: FasterWhisperVADClientConfig,
}

impl FasterWhisperVADClient {
    /// 创建新的 Faster Whisper VAD HTTP 客户端
    pub fn new(config: FasterWhisperVADClientConfig) -> Result<Self> {
        let timeout = Duration::from_millis(config.timeout_ms);
        let client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?;

        Ok(Self { client, config })
    }

    /// 使用默认配置创建客户端
    pub fn with_default_config() -> Result<Self> {
        Self::new(FasterWhisperVADClientConfig::default())
    }

    /// 创建使用服务 URL 的客户端
    pub fn new_with_url(service_url: Option<String>) -> Result<Self> {
        let url = service_url
            .or_else(|| std::env::var("FASTER_WHISPER_VAD_SERVICE_URL").ok())
            .unwrap_or_else(|| "http://127.0.0.1:6007".to_string());

        let config = FasterWhisperVADClientConfig {
            endpoint: url,
            timeout_ms: 30000,
        };

        Self::new(config)
    }

    /// 将音频数据转换为 WAV 字节
    fn audio_to_wav_bytes(&self, audio_data: &[f32]) -> Result<Vec<u8>> {
        let spec = WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let mut buffer = Vec::new();
        {
            let mut writer = WavWriter::new(Cursor::new(&mut buffer), spec)
                .map_err(|e| anyhow!("Failed to create WAV writer: {}", e))?;
            
            for &sample in audio_data {
                // 将 f32 (-1.0 到 1.0) 转换为 i16
                let sample_i16 = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
                writer.write_sample(sample_i16)
                    .map_err(|e| anyhow!("Failed to write WAV sample: {}", e))?;
            }
            
            writer.finalize()
                .map_err(|e| anyhow!("Failed to finalize WAV: {}", e))?;
        }

        Ok(buffer)
    }

    /// 处理 Utterance 任务
    /// 
    /// # Arguments
    /// * `job_id` - 任务 ID
    /// * `src_lang` - 源语言（支持 "auto" | "zh" | "en" | "ja" | "ko"）
    /// * `audio` - 音频数据（16kHz 单声道，f32）
    /// * `audio_format` - 音频格式（可选，默认 "pcm16"）
    /// * `sample_rate` - 采样率（可选，默认 16000）
    /// * `trace_id` - 追踪 ID（可选）
    /// * `use_context_buffer` - 是否使用音频上下文缓冲区
    /// * `use_text_context` - 是否使用文本上下文
    /// 
    /// # Returns
    /// 返回识别结果
    pub async fn process_utterance(
        &self,
        job_id: &str,
        src_lang: &str,
        audio: &[f32],
        audio_format: Option<&str>,
        sample_rate: Option<u32>,
        trace_id: Option<&str>,
        use_context_buffer: bool,
        use_text_context: bool,
    ) -> Result<UtteranceResult> {
        use std::time::Instant;
        let start_time = Instant::now();
        
        info!("[FasterWhisperVAD] Processing utterance: {} samples ({:.2}s @ 16kHz)", 
              audio.len(), audio.len() as f32 / 16000.0);
        
        // 转换为 WAV 字节
        let wav_bytes = self.audio_to_wav_bytes(audio)?;
        let audio_b64 = general_purpose::STANDARD.encode(&wav_bytes);
        
        debug!("[FasterWhisperVAD] Converted audio to WAV: {} bytes, base64: {} chars", 
               wav_bytes.len(), audio_b64.len());
        
        // 确定语言（如果 src_lang == "auto"，则使用 None 让 Faster Whisper 自动检测）
        let language = if src_lang == "auto" {
            None
        } else {
            Some(src_lang.to_string())
        };
        
        // 构建请求（与 node-inference 接口保持一致）
        // 注意：beam_size 增加到 10 以提高准确度（减少同音字错误）
        // 其他优化参数使用默认值（由 Python 服务处理）
        let request = UtteranceRequest {
            job_id: job_id.to_string(),
            src_lang: src_lang.to_string(),
            tgt_lang: None,  // ASR 服务不使用
            audio: audio_b64,
            audio_format: audio_format.map(|s| s.to_string()),
            sample_rate,
            language,
            task: "transcribe".to_string(),
            beam_size: 10,  // 增加到10以提高准确度（从5增加到10，减少同音字错误）
            condition_on_previous_text: true,
            use_context_buffer,
            use_text_context,
            // 新增：提高准确度的参数（使用默认值，由 Python 服务处理）
            best_of: None,  // 使用 Python 服务默认值
            temperature: None,  // 使用 Python 服务默认值 (0.0)
            patience: None,  // 使用 Python 服务默认值 (1.0)
            compression_ratio_threshold: None,  // 使用 Python 服务默认值 (2.4)
            log_prob_threshold: None,  // 使用 Python 服务默认值 (-1.0)
            no_speech_threshold: None,  // 使用 Python 服务默认值 (0.6)
            features: None,  // ASR 服务不使用
            mode: None,  // ASR 服务不使用
            lang_a: None,  // ASR 服务不使用
            lang_b: None,  // ASR 服务不使用
            auto_langs: None,  // ASR 服务不使用
            enable_streaming_asr: Some(false),  // 当前不支持
            partial_update_interval_ms: None,  // 当前不支持
            trace_id: trace_id.map(|s| s.to_string()),
            context_text: None,  // ASR 服务不使用（使用内部文本上下文）
        };
        
        let request_start = Instant::now();
        
        // 发送请求
        let response = self.client
            .post(&format!("{}/utterance", self.config.endpoint))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                let elapsed = start_time.elapsed().as_millis() as u64;
                error!("[FasterWhisperVAD] HTTP request failed after {}ms: {}", elapsed, e);
                anyhow!("HTTP request failed: {}", e)
            })?;
        
        let request_ms = request_start.elapsed().as_millis() as u64;
        
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("[FasterWhisperVAD] HTTP error {}: {}", status, error_text);
            return Err(anyhow!("HTTP error {}: {}", status, error_text));
        }
        
        // 解析响应
        let utterance_response: UtteranceResponse = response.json().await
            .map_err(|e| {
                let elapsed = start_time.elapsed().as_millis() as u64;
                error!("[FasterWhisperVAD] Failed to parse response after {}ms: {}", elapsed, e);
                anyhow!("Failed to parse response: {}", e)
            })?;
        
        let total_ms = start_time.elapsed().as_millis() as u64;
        
        info!("[FasterWhisperVAD] Utterance processed in {}ms (request: {}ms): {} chars, {} segments", 
              total_ms, request_ms, utterance_response.text.len(), utterance_response.segments.len());
        
        // 转换 VAD 段
        let vad_segments: Vec<(usize, usize)> = utterance_response.vad_segments
            .into_iter()
            .map(|seg| (seg[0], seg[1]))
            .collect();
        
        Ok(UtteranceResult {
            text: utterance_response.text,
            segments: utterance_response.segments,
            language: utterance_response.language,
            duration: utterance_response.duration,
            vad_segments,
        })
    }

    /// 重置服务状态
    pub async fn reset(
        &self,
        reset_vad: bool,
        reset_context: bool,
        reset_text_context: bool,
    ) -> Result<()> {
        let request = ResetRequest {
            reset_vad,
            reset_context,
            reset_text_context,
        };
        
        let response = self.client
            .post(&format!("{}/reset", self.config.endpoint))
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("HTTP request failed: {}", e))?;
        
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow!("HTTP error {}: {}", status, error_text));
        }
        
        info!("[FasterWhisperVAD] Service state reset (vad: {}, context: {}, text_context: {})", 
              reset_vad, reset_context, reset_text_context);
        
        Ok(())
    }

    /// 健康检查
    pub async fn health_check(&self) -> Result<bool> {
        let response = self.client
            .get(&format!("{}/health", self.config.endpoint))
            .send()
            .await
            .map_err(|e| anyhow!("HTTP request failed: {}", e))?;
        
        Ok(response.status().is_success())
    }
}

/// Utterance 处理结果
#[derive(Debug, Clone)]
pub struct UtteranceResult {
    pub text: String,
    pub segments: Vec<String>,
    pub language: Option<String>,
    pub duration: f64,
    pub vad_segments: Vec<(usize, usize)>,
}

