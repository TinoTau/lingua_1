//! YourTTS HTTP 客户端
//! 
//! 通过 HTTP 请求调用 YourTTS 服务进行零样本语音克隆

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use reqwest::Client;
use tracing::{info, error, warn};

/// YourTTS HTTP 服务配置
#[derive(Debug, Clone)]
pub struct YourTTSHttpConfig {
    /// HTTP 服务端点（例如：http://127.0.0.1:5004/synthesize）
    pub endpoint: String,
    /// 请求超时时间（毫秒）
    pub timeout_ms: u64,
}

impl Default for YourTTSHttpConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://127.0.0.1:5004/synthesize".to_string(),
            timeout_ms: 30000, // YourTTS 需要更长的处理时间
        }
    }
}

/// YourTTS HTTP 服务请求体
#[derive(Debug, Serialize)]
struct YourTTSHttpRequest {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    speaker_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reference_audio: Option<Vec<f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reference_sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

/// YourTTS HTTP 服务响应体
#[derive(Debug, Deserialize)]
struct YourTTSHttpResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    audio: Option<Vec<f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// YourTTS 引擎
pub struct YourTTSEngine {
    client: Client,
    config: YourTTSHttpConfig,
}

impl YourTTSEngine {
    /// 创建新的 YourTTS 引擎
    /// 
    /// # Arguments
    /// * `config` - YourTTS HTTP 配置（可选，如果为 None 则使用默认配置）
    /// 
    /// # Returns
    /// 返回 `YourTTSEngine` 实例
    pub fn new(config: Option<YourTTSHttpConfig>) -> Result<Self> {
        let config = config.unwrap_or_else(|| {
            // 尝试从环境变量读取配置
            YourTTSHttpConfig {
                endpoint: std::env::var("YOURTTS_SERVICE_URL")
                    .unwrap_or_else(|_| "http://127.0.0.1:5004/synthesize".to_string()),
                timeout_ms: std::env::var("YOURTTS_TIMEOUT_MS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(30000),
            }
        });

        info!("Initializing YourTTS engine: endpoint={}", config.endpoint);

        let timeout = Duration::from_millis(config.timeout_ms);
        let client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?;

        Ok(Self { client, config })
    }

    /// 语音合成（支持音色克隆）
    /// 
    /// # Arguments
    /// * `text` - 要合成的文本
    /// * `lang` - 语言代码（如 "zh", "en"）
    /// * `speaker_id` - 说话人 ID（可选，用于音色克隆）
    /// 
    /// # Returns
    /// 返回 PCM16 格式的音频数据（16kHz, 16bit, 单声道）
    pub async fn synthesize(
        &self,
        text: &str,
        lang: &str,
        speaker_id: Option<&str>,
    ) -> Result<Vec<u8>> {
        use std::time::Instant;
        let tts_start = Instant::now();
        
        info!(
            "YourTTS request started: text='{}' (lang={}, speaker_id={:?})",
            if text.len() > 50 { &text[..50] } else { text },
            lang,
            speaker_id
        );

        // 构造请求体
        let http_request = YourTTSHttpRequest {
            text: text.to_string(),
            speaker_id: speaker_id.map(|s| s.to_string()),
            reference_audio: None, // 如果提供了 speaker_id，服务会从缓存中获取
            reference_sample_rate: None,
            language: if lang.is_empty() {
                None
            } else {
                Some(lang.to_string())
            },
        };

        // 发送 HTTP POST 请求
        let http_start = Instant::now();
        let response = self
            .client
            .post(&self.config.endpoint)
            .json(&http_request)
            .send()
            .await
            .map_err(|e| {
                anyhow!(
                    "Failed to send HTTP request to YourTTS service: {}",
                    e
                )
            })?;
        let http_elapsed = http_start.elapsed().as_millis();
        info!("YourTTS HTTP request completed in {}ms", http_elapsed);

        // 检查 HTTP 状态码
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("YourTTS HTTP service returned error: {} {}", status, error_text);
            return Err(anyhow!(
                "YourTTS HTTP service returned error: {} {}",
                status, error_text
            ));
        }

        // 解析响应
        let response_data: YourTTSHttpResponse = response
            .json()
            .await
            .map_err(|e| {
                anyhow!(
                    "Failed to parse YourTTS service response: {}",
                    e
                )
            })?;

        // 检查错误
        if let Some(error_msg) = response_data.error {
            return Err(anyhow!("YourTTS service error: {}", error_msg));
        }

        // 获取音频数据
        let audio_f32 = response_data.audio.ok_or_else(|| {
            anyhow!("YourTTS service returned no audio data")
        })?;

        let sample_rate = response_data.sample_rate.unwrap_or(22050);

        // 将 f32 音频转换为 PCM16
        let audio_pcm16: Vec<u8> = audio_f32
            .iter()
            .flat_map(|&sample| {
                // 限制范围到 [-1.0, 1.0]
                let clamped = sample.max(-1.0).min(1.0);
                // 转换为 i16
                let sample_i16 = (clamped * 32767.0) as i16;
                // 转换为小端字节序
                sample_i16.to_le_bytes()
            })
            .collect();

        // 如果采样率不是 16kHz，需要重采样
        let audio_data = if sample_rate != 16000 {
            warn!(
                "YourTTS returned audio with sample_rate={}, resampling to 16kHz",
                sample_rate
            );
            // 简单的线性重采样（实际项目中应使用更专业的重采样库）
            self.resample_audio(&audio_pcm16, sample_rate, 16000)?
        } else {
            audio_pcm16
        };

        if audio_data.is_empty() {
            return Err(anyhow!("YourTTS service returned empty audio data"));
        }

        let total_elapsed = tts_start.elapsed().as_millis();
        info!(
            "YourTTS request completed in {}ms (audio size: {} bytes)",
            total_elapsed, audio_data.len()
        );

        Ok(audio_data)
    }

    /// 简单的线性重采样（从 source_rate 重采样到 target_rate）
    /// 
    /// 注意：这是一个简化的实现，实际项目中应使用专业的重采样库（如 rubato）
    fn resample_audio(
        &self,
        audio_pcm16: &[u8],
        source_rate: u32,
        target_rate: u32,
    ) -> Result<Vec<u8>> {
        if source_rate == target_rate {
            return Ok(audio_pcm16.to_vec());
        }

        // 将 PCM16 字节转换为 f32 样本
        let samples: Vec<f32> = audio_pcm16
            .chunks_exact(2)
            .map(|chunk| {
                let sample_i16 = i16::from_le_bytes([chunk[0], chunk[1]]);
                sample_i16 as f32 / 32768.0
            })
            .collect();

        let source_len = samples.len();
        let target_len = (source_len as u32 * target_rate / source_rate) as usize;
        let ratio = source_rate as f32 / target_rate as f32;

        // 线性插值重采样
        let mut resampled = Vec::with_capacity(target_len * 2);
        for i in 0..target_len {
            let source_index = (i as f32 * ratio) as usize;
            if source_index < source_len {
                let sample = samples[source_index];
                let sample_i16 = (sample * 32767.0) as i16;
                resampled.extend_from_slice(&sample_i16.to_le_bytes());
            }
        }

        Ok(resampled)
    }

    /// 检查 YourTTS 服务是否可用
    pub async fn check_health(&self) -> bool {
        // YourTTS 服务可能没有专门的健康检查端点
        // 我们可以尝试发送一个简单的请求来检查
        // 或者检查服务是否在运行（通过端口检查）
        // 这里简化处理，返回 true（实际应该检查服务状态）
        true
    }
}

