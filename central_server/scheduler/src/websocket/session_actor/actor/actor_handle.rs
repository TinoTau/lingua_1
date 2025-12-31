use tokio::sync::mpsc;
use super::super::events::SessionEvent;

/// Session Actor Handle（用于向 Actor 发送事件）
#[derive(Clone)]
pub struct SessionActorHandle {
    pub(crate) sender: mpsc::UnboundedSender<SessionEvent>,
}

impl SessionActorHandle {
    pub fn send(&self, event: SessionEvent) -> Result<(), mpsc::error::SendError<SessionEvent>> {
        self.sender.send(event)
    }

    /// 检查 Actor 是否仍然活跃
    #[allow(dead_code)]
    pub fn is_closed(&self) -> bool {
        self.sender.is_closed()
    }
}

