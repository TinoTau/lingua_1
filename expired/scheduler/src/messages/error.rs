// 错误码定义

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidMessage,
    InternalError,
    InvalidSession,
    SessionClosed,
    NodeUnavailable,
    NodeOverloaded,
    ModelNotAvailable,
    ModelLoadFailed,
    UnsupportedFeature,
    InvalidPairingCode,
    // 日志系统相关错误码
    NoAvailableNode,
    WsDisconnected,
    NmtTimeout,
    TtsTimeout,
    ModelVerifyFailed,
    ModelCorrupted,
    NoGpuAvailable,
    NodeIdConflict,
    InvalidCapabilitySchema,
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
            ErrorCode::NoAvailableNode => "NO_AVAILABLE_NODE".to_string(),
            ErrorCode::WsDisconnected => "WS_DISCONNECTED".to_string(),
            ErrorCode::NmtTimeout => "NMT_TIMEOUT".to_string(),
            ErrorCode::TtsTimeout => "TTS_TIMEOUT".to_string(),
            ErrorCode::ModelVerifyFailed => "MODEL_VERIFY_FAILED".to_string(),
            ErrorCode::ModelCorrupted => "MODEL_CORRUPTED".to_string(),
            ErrorCode::NoGpuAvailable => "NO_GPU_AVAILABLE".to_string(),
            ErrorCode::NodeIdConflict => "NODE_ID_CONFLICT".to_string(),
            ErrorCode::InvalidCapabilitySchema => "INVALID_CAPABILITY_SCHEMA".to_string(),
        }
    }
}

/// 获取错误码对应的用户友好提示
pub fn get_error_hint(code: &ErrorCode) -> &'static str {
    match code {
        ErrorCode::NoAvailableNode => "当前没有可用节点，请稍后再试。",
        ErrorCode::ModelNotAvailable => "节点缺少必要模型，正在重新调度或等待模型准备完成。",
        ErrorCode::WsDisconnected => "连接已断开，请刷新页面或重新连接。",
        ErrorCode::NmtTimeout => "翻译超时，请尝试缩短句子后重试。",
        ErrorCode::TtsTimeout => "语音合成超时，请稍后重试。",
        ErrorCode::ModelVerifyFailed => "模型校验失败，请重新下载模型。",
        ErrorCode::ModelCorrupted => "模型文件损坏，请重新下载模型。",
        ErrorCode::NoGpuAvailable => "节点没有 GPU，无法注册为算力提供方。",
        ErrorCode::NodeIdConflict => "节点 ID 冲突，请清除本地 node_id 后重新注册。",
        ErrorCode::InvalidCapabilitySchema => "不支持的能力描述版本，请更新节点客户端。",
        _ => "发生错误，请稍后重试。",
    }
}

