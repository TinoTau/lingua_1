use anyhow::Result;
use reqwest::Client;

pub struct TTSEngine {
    client: Client,
    tts_service_url: String,
}

impl TTSEngine {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: Client::new(),
            tts_service_url: std::env::var("TTS_SERVICE_URL")
                .unwrap_or_else(|_| "http://localhost:5005/tts".to_string()),
        })
    }

    pub async fn synthesize(&self, text: &str, lang: &str) -> Result<Vec<u8>> {
        // TODO: 调用 TTS 服务（Piper TTS）
        // 1. 发送 HTTP 请求到 TTS 服务
        // 2. 接收音频数据
        // 3. 返回音频字节

        let response = self
            .client
            .post(&self.tts_service_url)
            .json(&serde_json::json!({
                "text": text,
                "lang": lang,
            }))
            .send()
            .await?;

        let audio_data = response.bytes().await?.to_vec();
        Ok(audio_data)
    }
}

