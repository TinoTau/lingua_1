//! 推理请求与结果类型

use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::asr;

/// 部分结果回调函数类型
pub type PartialResultCallback = Arc<dyn Fn(asr::ASRPartialResult) + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    pub job_id: String,
    pub src_lang: String,
    pub tgt_lang: String,
    pub audio_data: Vec<u8>,
    pub features: Option<crate::modules::FeatureSet>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_a: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_b: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_langs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_streaming_asr: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_update_interval_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceResult {
    pub transcript: String,
    pub translation: String,
    pub audio: Vec<u8>,
    pub speaker_id: Option<String>,
    pub speech_rate: Option<f32>,
    pub emotion: Option<String>,
}
