use super::SessionActor;
use super::super::events::SessionEvent;
use tokio::time::{sleep, Duration};

impl SessionActor {
    /// 取消所有计时器
    pub(crate) fn cancel_timers(&mut self) {
        if let Some(handle) = self.current_timer_handle.take() {
            handle.abort();
        }
    }

    /// 重置计时器（启动新的超时计时器）
    pub(crate) async fn reset_timers(&mut self) -> Result<(), anyhow::Error> {
        // 取消旧计时器
        self.cancel_timers();

        // 更新 generation
        let generation = self.internal_state.increment_timer_generation();
        // 修复：优先使用 audio_buffer 的时间戳，因为它是最准确的（实际最后收到音频块的时间戳）
        // 如果 audio_buffer 没有时间戳，则使用 internal_state 的时间戳或当前时间
        let timestamp_ms = self.state.audio_buffer.get_last_chunk_at_ms(&self.session_id).await
            .or_else(|| self.internal_state.last_chunk_timestamp_ms)
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        // 启动新计时器
        let session_id = self.session_id.clone();
        let state = self.state.clone();
        let event_tx = self.event_tx.clone();
        let pause_ms = self.pause_ms;

        let handle = tokio::spawn(async move {
            sleep(Duration::from_millis(pause_ms)).await;

            // 检查时间戳是否仍然匹配
            if let Some(last_ts) = state.audio_buffer.get_last_chunk_at_ms(&session_id).await {
                if last_ts != timestamp_ms {
                    // 时间戳已更新，说明有新 chunk，忽略本次超时
                    return;
                }
            }

            // 发送超时事件
            let _ = event_tx.send(SessionEvent::TimeoutFired {
                generation,
                timestamp_ms,
            });
        });

        self.current_timer_handle = Some(handle);
        Ok(())
    }
}

