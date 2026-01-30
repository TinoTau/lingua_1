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

}

