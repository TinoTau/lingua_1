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
        timestamp_ms: i64, // 调度服务器接收时间戳
        client_timestamp_ms: Option<i64>, // 客户端发送时间戳
    },
    /// 超时触发（带 generation 用于过期检测）
    TimeoutFired {
        generation: u64,
        timestamp_ms: i64,
    },
    // 已删除未使用的枚举变体：IsFinalReceived
    // 此变体从未被构造，is_final 的处理已在 handle_audio_chunk 中完成
    /// 重启计时器（用于播放完成后重置 pause 检测计时器）
    RestartTimer {
        timestamp_ms: i64, // 重启计时器的时间戳
    },
    /// 关闭会话
    CloseSession,
}

/// 用于向 WebSocket 发送消息的回调
pub type MessageSender = mpsc::UnboundedSender<Message>;

