use serde_json::json;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct SchedulerClient {
    scheduler_url: String,
}

#[derive(Debug, Clone)]
pub struct TranslationResult {
    pub text_asr: String,
    pub text_translated: String,
    pub tts_audio: String,
    pub processing_time_ms: Option<u64>,
}

impl SchedulerClient {
    pub fn new(scheduler_url: String) -> Self {
        Self { scheduler_url }
    }

    pub async fn create_session(
        &self,
        tenant_id: String,
        src_lang: String,
        tgt_lang: String,
        dialect: Option<String>,
        features: Option<serde_json::Value>,
    ) -> anyhow::Result<String> {
        let (ws_stream, _) = connect_async(&self.scheduler_url).await?;
        let (mut write, mut read) = ws_stream.split();

        let init_msg = json!({
            "type": "session_init",
            "tenant_id": tenant_id,
            "client_version": "1.0.0",
            "platform": "api-gateway",
            "src_lang": src_lang,
            "tgt_lang": tgt_lang,
            "dialect": dialect,
            "features": features,
        });

        write.send(Message::Text(init_msg.to_string())).await?;

        if let Some(Ok(Message::Text(text))) = read.next().await {
            let ack: serde_json::Value = serde_json::from_str(&text)?;
            if let Some(session_id) = ack["session_id"].as_str() {
                return Ok(session_id.to_string());
            }
        }

        Err(anyhow::anyhow!("Failed to get session_id"))
    }

    pub async fn send_utterance(
        &self,
        session_id: String,
        utterance_index: u64,
        audio_data: Vec<u8>,
        src_lang: String,
        tgt_lang: String,
        dialect: Option<String>,
        features: Option<serde_json::Value>,
        audio_format: String,
        sample_rate: u32,
    ) -> anyhow::Result<TranslationResult> {
        let (ws_stream, _) = connect_async(&self.scheduler_url).await?;
        let (mut write, mut read) = ws_stream.split();

        let audio_base64 = base64::encode(&audio_data);

        let utterance_msg = json!({
            "type": "utterance",
            "session_id": session_id,
            "utterance_index": utterance_index,
            "manual_cut": false,
            "src_lang": src_lang,
            "tgt_lang": tgt_lang,
            "dialect": dialect,
            "features": features,
            "audio": audio_base64,
            "audio_format": audio_format,
            "sample_rate": sample_rate,
        });

        write.send(Message::Text(utterance_msg.to_string())).await?;

        // 等待翻译结果
        while let Some(Ok(Message::Text(text))) = read.next().await {
            let result: serde_json::Value = serde_json::from_str(&text)?;
            if result["type"] == "translation_result" {
                return Ok(TranslationResult {
                    text_asr: result["text_asr"].as_str().unwrap_or("").to_string(),
                    text_translated: result["text_translated"].as_str().unwrap_or("").to_string(),
                    tts_audio: result["tts_audio"].as_str().unwrap_or("").to_string(),
                    processing_time_ms: result["processing_time_ms"].as_u64(),
                });
            }
        }

        Err(anyhow::anyhow!("Failed to get translation result"))
    }
}

