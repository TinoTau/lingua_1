// WebSocket 消息协议定义（与 docs/PROTOCOLS.md 对应）
use serde::{Deserialize, Serialize};

// ===== 通用类型 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFlags {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emotion_detection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_style_detection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_rate_detection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_rate_control: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker_identification: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persona_adaptation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineConfig {
    pub use_asr: bool,
    pub use_nmt: bool,
    pub use_tts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledModel {
    pub model_id: String,
    pub kind: String, // "asr" | "nmt" | "tts" | "vad" | "emotion" | "other"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub src_lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tgt_lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialect: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu_cores: u32,
    pub memory_gb: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpus: Option<Vec<GpuInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub memory_gb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub cpu_percent: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu_percent: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu_mem_percent: Option<f32>,
    pub mem_percent: f32,
    pub running_jobs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emotion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speech_rate: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_style: Option<String>,
}

// ===== 错误码 =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ErrorCode {
    #[serde(rename = "INVALID_MESSAGE")]
    InvalidMessage,
    #[serde(rename = "INTERNAL_ERROR")]
    InternalError,
    #[serde(rename = "INVALID_SESSION")]
    InvalidSession,
    #[serde(rename = "SESSION_CLOSED")]
    SessionClosed,
    #[serde(rename = "NODE_UNAVAILABLE")]
    NodeUnavailable,
    #[serde(rename = "NODE_OVERLOADED")]
    NodeOverloaded,
    #[serde(rename = "MODEL_NOT_AVAILABLE")]
    ModelNotAvailable,
    #[serde(rename = "MODEL_LOAD_FAILED")]
    ModelLoadFailed,
    #[serde(rename = "UNSUPPORTED_FEATURE")]
    UnsupportedFeature,
    #[serde(rename = "INVALID_PAIRING_CODE")]
    InvalidPairingCode,
}

impl ToString for ErrorCode {
    fn to_string(&self) -> String {
        match self {
            ErrorCode::InvalidMessage => "INVALID_MESSAGE".to_string(),
            ErrorCode::InternalError => "INTERNAL_ERROR".to_string(),
            ErrorCode::InvalidSession => "INVALID_SESSION".to_string(),
            ErrorCode::SessionClosed => "SESSION_CLOSED".to_string(),
            ErrorCode::NodeUnavailable => "NODE_UNAVAILABLE".to_string(),
            ErrorCode::NodeOverloaded => "NODE_OVERLOADED".to_string(),
            ErrorCode::ModelNotAvailable => "MODEL_NOT_AVAILABLE".to_string(),
            ErrorCode::ModelLoadFailed => "MODEL_LOAD_FAILED".to_string(),
            ErrorCode::UnsupportedFeature => "UNSUPPORTED_FEATURE".to_string(),
            ErrorCode::InvalidPairingCode => "INVALID_PAIRING_CODE".to_string(),
        }
    }
}

// ===== 移动端 ↔ 调度服务器消息 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SessionMessage {
    #[serde(rename = "session_init")]
    SessionInit {
        client_version: String,
        platform: String, // "android" | "ios" | "web" | "api-gateway"
        src_lang: String,
        tgt_lang: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        dialect: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        features: Option<FeatureFlags>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pairing_code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tenant_id: Option<String>, // 租户 ID（用于多租户支持）
    },
    #[serde(rename = "session_init_ack")]
    SessionInitAck {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        assigned_node_id: Option<String>,
        message: String,
    },
    #[serde(rename = "utterance")]
    Utterance {
        session_id: String,
        utterance_index: u64,
        manual_cut: bool,
        src_lang: String,
        tgt_lang: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        dialect: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        features: Option<FeatureFlags>,
        audio: String, // base64
        audio_format: String,
        sample_rate: u32,
    },
    #[serde(rename = "translation_result")]
    TranslationResult {
        session_id: String,
        utterance_index: u64,
        job_id: String,
        text_asr: String,
        text_translated: String,
        tts_audio: String, // base64
        tts_format: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        extra: Option<ExtraResult>,
    },
    #[serde(rename = "client_heartbeat")]
    ClientHeartbeat {
        session_id: String,
        timestamp: i64,
    },
    #[serde(rename = "server_heartbeat")]
    ServerHeartbeat {
        session_id: String,
        timestamp: i64,
    },
    #[serde(rename = "session_close")]
    SessionClose {
        session_id: String,
        reason: String,
    },
    #[serde(rename = "session_close_ack")]
    SessionCloseAck {
        session_id: String,
    },
    #[serde(rename = "error")]
    Error {
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<serde_json::Value>,
    },
}

// ===== 节点 ↔ 调度服务器消息 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NodeMessage {
    #[serde(rename = "node_register")]
    NodeRegister {
        #[serde(skip_serializing_if = "Option::is_none")]
        node_id: Option<String>,
        version: String,
        platform: String, // "windows" | "linux" | "macos"
        hardware: HardwareInfo,
        installed_models: Vec<InstalledModel>,
        features_supported: FeatureFlags,
        accept_public_jobs: bool,
    },
    #[serde(rename = "node_register_ack")]
    NodeRegisterAck {
        node_id: String,
        message: String,
    },
    #[serde(rename = "node_heartbeat")]
    NodeHeartbeat {
        node_id: String,
        timestamp: i64,
        resource_usage: ResourceUsage,
        #[serde(skip_serializing_if = "Option::is_none")]
        installed_models: Option<Vec<InstalledModel>>,
    },
    #[serde(rename = "job_assign")]
    JobAssign {
        job_id: String,
        session_id: String,
        utterance_index: u64,
        src_lang: String,
        tgt_lang: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        dialect: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        features: Option<FeatureFlags>,
        pipeline: PipelineConfig,
        audio: String, // base64
        audio_format: String,
        sample_rate: u32,
    },
    #[serde(rename = "job_result")]
    JobResult {
        job_id: String,
        node_id: String,
        session_id: String,
        utterance_index: u64,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_asr: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_translated: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tts_audio: Option<String>, // base64
        #[serde(skip_serializing_if = "Option::is_none")]
        tts_format: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        extra: Option<ExtraResult>,
        #[serde(skip_serializing_if = "Option::is_none")]
        processing_time_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<JobError>,
    },
    #[serde(rename = "node_error")]
    NodeError {
        node_id: String,
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<serde_json::Value>,
    },
    #[serde(rename = "node_control")]
    NodeControl {
        command: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

