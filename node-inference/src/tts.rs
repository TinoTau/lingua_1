//! Piper TTS HTTP 客户端
//! 
//! 通过 HTTP 请求调用 WSL2 中运行的 Piper TTS 服务

use anyhow::{Result, anyhow};
use serde::Serialize;
use std::time::Duration;
use reqwest::Client;
use tracing::{info, error};

/// Piper HTTP 服务配置
#[derive(Debug, Clone)]
pub struct PiperHttpConfig {
    /// HTTP 服务端点（例如：http://127.0.0.1:5006/tts）
    pub endpoint: String,
    /// 默认语音名称（例如：zh_CN-huayan-medium）
    pub default_voice: String,
    /// 请求超时时间（毫秒）
    pub timeout_ms: u64,
}

impl Default for PiperHttpConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://127.0.0.1:5006/tts".to_string(),
            default_voice: "zh_CN-huayan-medium".to_string(),
            timeout_ms: 8000,
        }
    }
}

/// Piper HTTP 服务请求体
#[derive(Debug, Serialize)]
struct PiperHttpRequest {
    text: String,
    voice: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

/// Piper TTS 引擎
pub struct TTSEngine {
    client: Client,
    config: PiperHttpConfig,
}

impl TTSEngine {
    /// 创建新的 Piper TTS 引擎
    /// 
    /// # Arguments
    /// * `config` - Piper HTTP 配置（可选，如果为 None 则使用默认配置）
    /// 
    /// # Returns
    /// 返回 `TTSEngine` 实例
    pub fn new(config: Option<PiperHttpConfig>) -> Result<Self> {
        let config = config.unwrap_or_else(|| {
            // 尝试从环境变量读取配置
            PiperHttpConfig {
                endpoint: std::env::var("TTS_SERVICE_URL")
                    .unwrap_or_else(|_| "http://127.0.0.1:5006/tts".to_string()),
                default_voice: std::env::var("TTS_DEFAULT_VOICE")
                    .unwrap_or_else(|_| "zh_CN-huayan-medium".to_string()),
                timeout_ms: std::env::var("TTS_TIMEOUT_MS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(8000),
            }
        });

        info!("Initializing Piper TTS engine: endpoint={}, default_voice={}", 
            config.endpoint, config.default_voice);

        let timeout = Duration::from_millis(config.timeout_ms);
        let client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?;

        Ok(Self { client, config })
    }

    /// 语音合成
    /// 
    /// # Arguments
    /// * `text` - 要合成的文本
    /// * `lang` - 语言代码（如 "zh", "en"）
    /// 
    /// # Returns
    /// 返回 WAV 格式的音频数据
    pub async fn synthesize(&self, text: &str, lang: &str) -> Result<Vec<u8>> {
        use std::time::Instant;
        let tts_start = Instant::now();
        
        info!("Piper TTS request started: text='{}' (lang={})", 
            if text.len() > 50 { &text[..50] } else { text },
            lang);
        
        // 确定使用的语音
        let voice = self.determine_voice(lang);
        
        // 构造请求体
        let http_request = PiperHttpRequest {
            text: text.to_string(),
            voice: voice.clone(),
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
                    "Failed to send HTTP request to Piper service: {}",
                    e
                )
            })?;
        let http_elapsed = http_start.elapsed().as_millis();
        info!("Piper TTS HTTP request completed in {}ms", http_elapsed);

        // 检查 HTTP 状态码
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("Piper HTTP service returned error: {} {}", status, error_text);
            return Err(anyhow!(
                "Piper HTTP service returned error: {} {}",
                status, error_text
            ));
        }

        // 读取音频数据（WAV 格式）
        let audio_data = response
            .bytes()
            .await
            .map_err(|e| {
                anyhow!(
                    "Failed to read audio data from Piper service: {}",
                    e
                )
            })?
            .to_vec();

        if audio_data.is_empty() {
            return Err(anyhow!(
                "Piper service returned empty audio data"
            ));
        }

        let total_elapsed = tts_start.elapsed().as_millis();
        info!("Piper TTS request completed in {}ms (audio size: {} bytes)", 
            total_elapsed, audio_data.len());

        Ok(audio_data)
    }

    /// 根据语言确定使用的语音
    fn determine_voice(&self, lang: &str) -> String {
        let lang_lower = lang.to_lowercase();
        
        if lang_lower.starts_with("en") {
            // 英文语音
            "en_US-lessac-medium".to_string()
        } else if lang_lower.starts_with("zh") {
            // 中文语音
            self.config.default_voice.clone()
        } else {
            // 默认使用配置的语音
            self.config.default_voice.clone()
        }
    }
}

