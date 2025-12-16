// UI 事件类型定义

use serde::{Deserialize, Serialize};

/// UI 事件类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UiEventType {
    InputStarted,
    InputEnded,
    AsrPartial,
    AsrFinal,
    Dispatched,
    NodeAccepted,
    NmtDone,
    TtsPlayStarted,
    TtsPlayEnded,
    Error,
}

/// UI 事件状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UiEventStatus {
    Ok,
    Error,
}

