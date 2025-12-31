use crate::core::AppState;
use super::super::events::MessageSender;
use super::super::state::SessionActorInternalState;
use super::actor_handle::SessionActorHandle;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tracing::info;

use super::SessionActor;

impl SessionActor {
    /// 创建新的 Session Actor
    pub fn new(
        session_id: String,
        state: AppState,
        message_tx: MessageSender,
        initial_utterance_index: u64,
        pause_ms: u64,
        max_duration_ms: u64,
        edge_config: crate::core::config::EdgeStabilizationConfig,
    ) -> (Self, SessionActorHandle) {
        let (tx, rx) = mpsc::unbounded_channel();
        let handle = SessionActorHandle { sender: tx.clone() };
        let actor = Self {
            session_id: session_id.clone(),
            state,
            message_tx,
            event_rx: rx,
            event_tx: tx, // 保存 sender 用于 timer task
            internal_state: SessionActorInternalState::new(initial_utterance_index),
            current_timer_handle: None,
            idle_timeout_secs: 60, // 默认 60 秒空闲超时
            last_activity: Instant::now(),
            pause_ms,
            max_duration_ms,
            edge_config,
            max_pending_events: 200, // 默认最大 200 个待处理事件
            pending_events_count: 0,
        };
        (actor, handle)
    }

    /// 运行 Actor 事件循环
    pub async fn run(mut self) {
        info!(
            session_id = %self.session_id,
            "Session Actor started"
        );

        loop {
            tokio::select! {
                // 处理事件
                event = self.event_rx.recv() => {
                    match event {
                        Some(event) => {
                            self.last_activity = Instant::now();
                            
                            // 背压检测：如果事件队列积压过多，进行降级处理
                            if self.pending_events_count >= self.max_pending_events {
                                tracing::warn!(
                                    session_id = %self.session_id,
                                    pending_count = self.pending_events_count,
                                    max_pending = self.max_pending_events,
                                    "Event backlog exceeded, applying backpressure"
                                );
                                
                                // 记录积压指标
                                crate::metrics::on_session_actor_backlog(self.pending_events_count);
                                
                                // 降级策略：丢弃低优先级事件（连续 AudioChunk）
                                if matches!(event, super::super::events::SessionEvent::AudioChunkReceived { .. }) {
                                    // 检查是否还有更多 AudioChunk 在队列中
                                    // 如果是，丢弃当前这个（保留最新的）
                                    continue;
                                }
                                
                                // 重要事件（finalize、close）必须处理
                            }
                            
                            self.pending_events_count += 1;
                            // 更新积压指标（峰值）
                            crate::metrics::on_session_actor_backlog(self.pending_events_count);
                            if let Err(e) = self.handle_event(event).await {
                                tracing::error!(
                                    session_id = %self.session_id,
                                    error = %e,
                                    "Error handling event"
                                );
                            }
                            self.pending_events_count = self.pending_events_count.saturating_sub(1);
                        }
                        None => {
                            // Channel 关闭，退出
                            tracing::debug!(
                                session_id = %self.session_id,
                                "Event channel closed, exiting actor"
                            );
                            break;
                        }
                    }
                }
                // 检查空闲超时
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(10)) => {
                    if self.last_activity.elapsed().as_secs() > self.idle_timeout_secs {
                        tracing::warn!(
                            session_id = %self.session_id,
                            idle_secs = self.last_activity.elapsed().as_secs(),
                            "Session idle timeout, closing actor"
                        );
                        break;
                    }
                }
            }

            // 如果状态是 Closed，退出
            if matches!(self.internal_state.state, super::super::state::SessionActorState::Closed) {
                break;
            }
        }

        // 清理资源
        self.cleanup().await;
        info!(
            session_id = %self.session_id,
            "Session Actor stopped"
        );
    }

    /// 清理资源
    pub async fn cleanup(&mut self) {
        self.cancel_timers();

        // 清理音频缓冲区（该 session 的所有 utterance_index）
        // 注意：这里清理所有未完成的音频 buffer
        let current_index = self.internal_state.current_utterance_index;
        for i in 0..=current_index {
            let _ = self.state.audio_buffer.take_combined(&self.session_id, i).await;
        }

        // 清理JobResult去重记录
        self.state.job_result_deduplicator.remove_session(&self.session_id).await;

        // 标记未完成的 job 为 cancelled（通过结果队列超时机制处理）
        // 这里主要确保 timer generation 失效
        self.internal_state.timer_generation = u64::MAX; // 使所有 timer 失效

        tracing::debug!(
            session_id = %self.session_id,
            "Session Actor cleanup completed"
        );
    }
}

