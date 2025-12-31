mod actor_handle;
mod actor_types;
mod actor_lifecycle;
mod actor_event_handling;
mod actor_finalize;
mod actor_timers;

pub use actor_handle::SessionActorHandle;

use crate::core::AppState;
use super::events::MessageSender;
use super::state::SessionActorInternalState;
use tokio::sync::mpsc;
use tokio::time::Instant;

/// Session Actor（单写者，处理所有会话内事件）
pub struct SessionActor {
    pub(crate) session_id: String,
    pub(crate) state: AppState,
    pub(crate) message_tx: MessageSender,
    pub(crate) event_rx: mpsc::UnboundedReceiver<super::events::SessionEvent>,
    /// Event sender（用于 timer task 发送事件）
    pub(crate) event_tx: mpsc::UnboundedSender<super::events::SessionEvent>,
    pub(crate) internal_state: SessionActorInternalState,
    /// 当前活跃的 timer handle（用于取消）
    pub(crate) current_timer_handle: Option<tokio::task::JoinHandle<()>>,
    /// 会话空闲超时（秒）
    pub(crate) idle_timeout_secs: u64,
    /// 最后活动时间
    pub(crate) last_activity: Instant,
    /// 暂停阈值（毫秒）
    pub(crate) pause_ms: u64,
    /// 最大音频时长限制（毫秒）
    pub(crate) max_duration_ms: u64,
    /// 边界稳态化配置（EDGE-1）
    pub(crate) edge_config: crate::core::config::EdgeStabilizationConfig,
    /// 最大待处理事件数（背压控制）
    pub(crate) max_pending_events: usize,
    /// 当前待处理事件数（用于背压检测）
    pub(crate) pending_events_count: usize,
}

