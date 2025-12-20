// Session Actor 事件定义

use axum::extract::ws::Message;
use tokio::sync::mpsc;

/// Session Actor 事件类型
#[derive(Debug, Clone)]
pub enum SessionEvent {
    /// 收到音频块
    AudioChunkReceived {
        chunk: Vec<u8>,
        is_final: bool,
        timestamp_ms: i64,
    },
    /// 暂停时间超过阈值
    PauseExceeded {
        timestamp_ms: i64,
    },
    /// 超时触发（带 generation 用于过期检测）
    TimeoutFired {
        generation: u64,
        timestamp_ms: i64,
    },
    /// 收到 is_final 标记
    IsFinalReceived,
    /// 关闭会话
    CloseSession,
    /// 取消所有计时器
    CancelTimers,
    /// 重置计时器
    ResetTimers,
}

/// 用于向 WebSocket 发送消息的回调
pub type MessageSender = mpsc::UnboundedSender<Message>;

