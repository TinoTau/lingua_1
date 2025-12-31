// Session Actor 实现

use crate::core::AppState;
use crate::messages::{ErrorCode, UiEventStatus, UiEventType};
use crate::websocket::{create_job_assign_message, send_ui_event};
use crate::websocket::job_creator::create_translation_jobs;
use super::events::{SessionEvent, MessageSender};
use super::state::{SessionActorInternalState, SessionActorState};
use super::audio_duration::calculate_audio_duration_ms;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration, Instant};
use tracing::{debug, info, warn, error};

/// EDGE-1: Finalize 类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FinalizeType {
    /// 手动截断（is_final=true）
    Manual,
    /// 自动 finalize（pause/timeout）
    Auto,
    /// 异常保护（MaxLength）
    Exception,
}

/// Session Actor Handle（用于向 Actor 发送事件）
#[derive(Clone)]
pub struct SessionActorHandle {
    sender: mpsc::UnboundedSender<SessionEvent>,
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

/// Session Actor（单写者，处理所有会话内事件）
pub struct SessionActor {
    session_id: String,
    state: AppState,
    message_tx: MessageSender,
    event_rx: mpsc::UnboundedReceiver<SessionEvent>,
    /// Event sender（用于 timer task 发送事件）
    event_tx: mpsc::UnboundedSender<SessionEvent>,
    internal_state: SessionActorInternalState,
    /// 当前活跃的 timer handle（用于取消）
    current_timer_handle: Option<tokio::task::JoinHandle<()>>,
    /// 会话空闲超时（秒）
    idle_timeout_secs: u64,
    /// 最后活动时间
    last_activity: Instant,
    /// 暂停阈值（毫秒）
    pause_ms: u64,
    /// 最大音频时长限制（毫秒）
    max_duration_ms: u64,
    /// 边界稳态化配置（EDGE-1）
    edge_config: crate::core::config::EdgeStabilizationConfig,
    /// 最大待处理事件数（背压控制）
    max_pending_events: usize,
    /// 当前待处理事件数（用于背压检测）
    pending_events_count: usize,
}

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
                                warn!(
                                    session_id = %self.session_id,
                                    pending_count = self.pending_events_count,
                                    max_pending = self.max_pending_events,
                                    "Event backlog exceeded, applying backpressure"
                                );
                                
                                // 记录积压指标
                                crate::metrics::on_session_actor_backlog(self.pending_events_count);
                                
                                // 降级策略：丢弃低优先级事件（连续 AudioChunk）
                                if matches!(event, SessionEvent::AudioChunkReceived { .. }) {
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
                                error!(
                                    session_id = %self.session_id,
                                    error = %e,
                                    "Error handling event"
                                );
                            }
                            self.pending_events_count = self.pending_events_count.saturating_sub(1);
                        }
                        None => {
                            // Channel 关闭，退出
                            debug!(
                                session_id = %self.session_id,
                                "Event channel closed, exiting actor"
                            );
                            break;
                        }
                    }
                }
                // 检查空闲超时
                _ = sleep(Duration::from_secs(10)) => {
                    if self.last_activity.elapsed().as_secs() > self.idle_timeout_secs {
                        warn!(
                            session_id = %self.session_id,
                            idle_secs = self.last_activity.elapsed().as_secs(),
                            "Session idle timeout, closing actor"
                        );
                        break;
                    }
                }
            }

            // 如果状态是 Closed，退出
            if matches!(self.internal_state.state, SessionActorState::Closed) {
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

    /// 处理事件
    async fn handle_event(&mut self, event: SessionEvent) -> Result<(), anyhow::Error> {
        match event {
            SessionEvent::AudioChunkReceived { chunk, is_final, timestamp_ms, client_timestamp_ms } => {
                self.handle_audio_chunk(chunk, is_final, timestamp_ms, client_timestamp_ms).await?;
            }
            SessionEvent::PauseExceeded { timestamp_ms } => {
                self.handle_pause_exceeded(timestamp_ms).await?;
            }
            SessionEvent::TimeoutFired { generation, timestamp_ms } => {
                self.handle_timeout_fired(generation, timestamp_ms).await?;
            }
            SessionEvent::IsFinalReceived => {
                self.handle_is_final().await?;
            }
            SessionEvent::CloseSession => {
                self.handle_close().await?;
            }
            SessionEvent::CancelTimers => {
                self.cancel_timers();
            }
            SessionEvent::ResetTimers => {
                self.reset_timers().await?;
            }
            SessionEvent::UpdateUtteranceIndex { utterance_index } => {
                self.handle_update_utterance_index(utterance_index).await?;
            }
        }
        Ok(())
    }

    /// 处理音频块
    async fn handle_audio_chunk(
        &mut self,
        chunk: Vec<u8>,
        is_final: bool,
        timestamp_ms: i64,
        client_timestamp_ms: Option<i64>,
    ) -> Result<(), anyhow::Error> {
        // 修复：如果正在 finalize，新的 audio_chunk 应该直接进入下一次 finalize 的缓冲区
        // 因为 finalize 完成后 utterance_index 会递增，所以使用 current_utterance_index + 1
        let utterance_index = if let Some(finalizing_index) = self.internal_state.finalize_inflight {
            // 如果正在 finalize，新的 chunk 应该进入下一个 utterance_index 的缓冲区
            // finalize 完成后，current_utterance_index 会递增，所以这里使用 finalizing_index + 1
            debug!(
                session_id = %self.session_id,
                current_index = self.internal_state.current_utterance_index,
                finalizing_index = finalizing_index,
                next_index = finalizing_index + 1,
                "Audio chunk arrived during finalize, adding to next utterance buffer"
            );
            finalizing_index + 1
        } else {
            // 否则使用当前的 utterance_index
            self.internal_state.current_utterance_index
        };

        // Fix-A (RF-1): 重构 chunk 处理顺序 - 先 add_chunk，后判断 finalize
        // 原则：任何到达的音频 chunk，必须先进入当前 utterance 的缓冲，然后才允许触发 finalize
        
        // 获取 session 配置以确定 audio_format 和 sample_rate
        let session = match self.state.session_manager.get_session(&self.session_id).await {
            Some(s) => s,
            None => {
                warn!(
                    session_id = %self.session_id,
                    "Session not found, skipping audio chunk"
                );
                return Ok(());
            }
        };
        
        let audio_format = session.audio_format.clone().unwrap_or_else(|| "pcm16".to_string());
        let sample_rate = 16000u32; // 默认采样率（Web 端使用 16kHz）
        
        // 计算当前音频块的时长
        let chunk_duration_ms = calculate_audio_duration_ms(&chunk, &audio_format, sample_rate);
        
        // 步骤1：先添加当前音频块到缓冲区（使用当前的 utterance_index）
        let (should_finalize_due_to_length, current_size_bytes) = self.state
            .audio_buffer
            .add_chunk(&self.session_id, utterance_index, chunk)
            .await;

        // 更新状态
        self.internal_state.last_chunk_timestamp_ms = Some(timestamp_ms);
        if self.internal_state.first_chunk_client_timestamp_ms.is_none() {
            self.internal_state.first_chunk_client_timestamp_ms = client_timestamp_ms;
        }
        self.internal_state.enter_collecting();
        
        // 累积音频时长（用于最大时长限制检查）
        self.internal_state.accumulated_audio_duration_ms += chunk_duration_ms;
        
        // 步骤2：检查暂停是否超过阈值（在添加音频块之后）
        let pause_exceeded = self.state
            .audio_buffer
            .record_chunk_and_check_pause(&self.session_id, timestamp_ms, self.pause_ms)
            .await;

        // 步骤3：检查是否需要 finalize（在添加音频块之后）
        let mut should_finalize = false;
        let mut finalize_reason = "";
        
        // 检查 pause_exceeded
        if pause_exceeded {
            should_finalize = true;
            finalize_reason = "Pause";
        }
        
        // 检查最大时长限制
        if self.max_duration_ms > 0 && self.internal_state.accumulated_audio_duration_ms >= self.max_duration_ms {
            warn!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                accumulated_duration_ms = self.internal_state.accumulated_audio_duration_ms,
                max_duration_ms = self.max_duration_ms,
                "Audio duration exceeded max limit, auto-finalizing"
            );
            should_finalize = true;
            finalize_reason = "MaxDuration";
        }
        
        // 检查 is_final
        if is_final {
            should_finalize = true;
            finalize_reason = "IsFinal";
        }
        
        // 检查异常保护限制
        if should_finalize_due_to_length {
            warn!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                current_size_bytes = current_size_bytes,
                pause_ms = self.pause_ms,
                "Audio buffer exceeded异常保护限制 (500KB), auto-finalizing. This should not happen normally - check VAD and timeout mechanism"
            );
            should_finalize = true;
            finalize_reason = "MaxLength";
        }
        
        // 如果需要 finalize，执行 finalize（此时音频块已经在缓冲区中）
        // 修复：如果正在 finalize 另一个 utterance，不触发新的 finalize
        // 新的 chunk 已经添加到下一个 utterance_index 的缓冲区，等待当前 finalize 完成后再处理
        if should_finalize && self.internal_state.finalize_inflight.is_none() {
            let finalized = self.try_finalize(utterance_index, finalize_reason).await?;
            if finalized {
                // finalize 成功，utterance_index 已经在 try_finalize 中递增
                // 这里不需要再次更新，因为下一个 chunk 会使用新的 utterance_index
            }
        } else if self.pause_ms > 0 && self.internal_state.finalize_inflight.is_none() {
            // 不需要 finalize，启动/重置超时计时器（但如果正在 finalize，不重置计时器）
            self.reset_timers().await?;
        } else if self.internal_state.finalize_inflight.is_some() {
            // 正在 finalize，新的 chunk 已经添加到下一个 utterance_index 的缓冲区
            // 等待当前 finalize 完成后再处理（finalize 完成后 utterance_index 会递增）
            debug!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                finalize_inflight = ?self.internal_state.finalize_inflight,
                "Audio chunk added to next utterance buffer during finalize, will be processed after current finalize completes"
            );
        }

        Ok(())
    }

    /// 处理暂停超过阈值
    async fn handle_pause_exceeded(&mut self, _timestamp_ms: i64) -> Result<(), anyhow::Error> {
        let utterance_index = self.internal_state.current_utterance_index;
        self.try_finalize(utterance_index, "Pause").await?;
        Ok(())
    }

    /// 处理超时触发
    async fn handle_timeout_fired(
        &mut self,
        generation: u64,
        timestamp_ms: i64,
    ) -> Result<(), anyhow::Error> {
        // 检查 generation 是否有效
        if !self.internal_state.is_timer_generation_valid(generation) {
            debug!(
                session_id = %self.session_id,
                generation = generation,
                current_generation = self.internal_state.timer_generation,
                "Timeout fired with expired generation, ignoring"
            );
            return Ok(());
        }

        // 检查时间戳是否匹配（防止旧 timer 触发）
        // 注意：这里应该检查 audio_buffer 的时间戳，而不是 internal_state 的时间戳
        // 因为 audio_buffer 的时间戳是实际最后收到音频块的时间戳
        let audio_buffer_last_ts = self.state.audio_buffer.get_last_chunk_at_ms(&self.session_id).await;
        if let Some(last_ts) = audio_buffer_last_ts {
            if timestamp_ms != last_ts {
                debug!(
                    session_id = %self.session_id,
                    timeout_timestamp = timestamp_ms,
                    audio_buffer_last_timestamp = last_ts,
                    "Timeout fired with mismatched timestamp (new chunk arrived), ignoring"
                );
                return Ok(());
            }
        } else {
            // audio_buffer 中没有时间戳，说明可能已经 finalize 了，或者 session 已关闭
            // 这种情况下，不应该触发 finalize
            debug!(
                session_id = %self.session_id,
                timeout_timestamp = timestamp_ms,
                "Timeout fired but no audio buffer timestamp found, ignoring (may be already finalized)"
            );
            return Ok(());
        }

        let utterance_index = self.internal_state.current_utterance_index;
        self.try_finalize(utterance_index, "Timeout").await?;
        Ok(())
    }

    /// 处理 is_final
    async fn handle_is_final(&mut self) -> Result<(), anyhow::Error> {
        let utterance_index = self.internal_state.current_utterance_index;
        self.try_finalize(utterance_index, "IsFinal").await?;
        Ok(())
    }

    /// 处理关闭会话
    /// Fix-D (RF-4): Session 结束时强制 flush_finalize
    async fn handle_close(&mut self) -> Result<(), anyhow::Error> {
        // 在关闭前，强制 finalize 当前 utterance（如果有数据）
        let utterance_index = self.internal_state.current_utterance_index;
        
        // 直接调用 try_finalize，它会检查缓冲区是否有数据
        // 如果有数据，会创建 job；如果没有数据，会返回 false（不递增 index）
        let finalized = self.try_finalize(utterance_index, "SessionClose").await?;
        
        if finalized {
            info!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                "Session closing: successfully finalized remaining audio data"
            );
        } else {
            debug!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                "Session closing: no audio data to finalize"
            );
        }
        
        self.internal_state.state = SessionActorState::Closed;
        Ok(())
    }

    /// 尝试 finalize（带去重检查 + EDGE-1: 统一接口）
    async fn try_finalize(
        &mut self,
        utterance_index: u64,
        reason: &str,
    ) -> Result<bool, anyhow::Error> {
        // 检查是否可以 finalize
        if !self.internal_state.can_finalize(utterance_index) {
            debug!(
                session_id = %self.session_id,
                requested_index = utterance_index,
                current_index = self.internal_state.current_utterance_index,
                state = ?self.internal_state.state,
                reason = reason,
                "Skipping finalize: already finalized or in progress"
            );
            // 记录被抑制的重复 finalize
            crate::metrics::on_duplicate_finalize_suppressed();
            return Ok(false);
        }

        // 进入 finalizing 状态
        self.internal_state.enter_finalizing(utterance_index);

        // EDGE-1: 统一 finalize 接口 - 判断 finalize 类型
        let finalize_type = self.determine_finalize_type(reason);
        
        // EDGE-2/3: 应用 Hangover（延迟 finalize）
        let hangover_ms = match finalize_type {
            FinalizeType::Manual => self.edge_config.hangover_manual_ms,
            FinalizeType::Auto => self.edge_config.hangover_auto_ms,
            FinalizeType::Exception => 0, // 异常情况不延迟
        };
        
        if hangover_ms > 0 {
            debug!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                reason = reason,
                finalize_type = ?finalize_type,
                hangover_ms = hangover_ms,
                "Applying hangover delay before finalize"
            );
            sleep(Duration::from_millis(hangover_ms)).await;
        }

        // 执行 finalize（包含 Padding 处理）
        let finalized = self.do_finalize(utterance_index, reason, finalize_type).await?;

        if finalized {
            // 完成 finalize，递增 index
            self.internal_state.complete_finalize();
            // EDGE-5: 重置 Short-merge 状态
            self.internal_state.pending_short_audio = false;
            self.internal_state.accumulated_short_audio_duration_ms = 0;
            // 重置累积音频时长
            self.internal_state.accumulated_audio_duration_ms = 0;
            self.state
                .session_manager
                .update_session(
                    &self.session_id,
                    crate::core::session::SessionUpdate::IncrementUtteranceIndex,
                )
                .await;
        } else {
            // finalize 失败，恢复状态
            self.internal_state.state = SessionActorState::Idle;
            self.internal_state.finalize_inflight = None;
        }

        Ok(finalized)
    }

    /// EDGE-1: 判断 finalize 类型（自动/手动/异常）
    fn determine_finalize_type(&self, reason: &str) -> FinalizeType {
        match reason {
            "IsFinal" => FinalizeType::Manual,  // 手动截断
            "Pause" | "Timeout" => FinalizeType::Auto,  // 自动 finalize（静音/超时）
            "MaxLength" => FinalizeType::Exception,  // 异常保护
            _ => FinalizeType::Auto,  // 默认按自动处理
        }
    }

    /// 执行 finalize（实际创建 job + EDGE-4: Padding）
    /// Fix-C (RF-3): finalize 时合并 short pending
    async fn do_finalize(
        &self,
        utterance_index: u64,
        reason: &str,
        finalize_type: FinalizeType,
    ) -> Result<bool, anyhow::Error> {
        // 获取会话信息
        let session = match self.state.session_manager.get_session(&self.session_id).await {
            Some(s) => s,
            None => {
                warn!(
                    session_id = %self.session_id,
                    "Session not found during finalize"
                );
                return Ok(false);
            }
        };

        // Fix-C (RF-3): 如果存在 pending short audio，确保它们被包含在 finalize 中
        // 注意：由于我们已经重构了处理顺序（Fix-A），音频块在 finalize 之前已经被添加到缓冲区
        // 所以这里只需要确保缓冲区中的数据被正确取出即可
        // 如果将来需要更复杂的 short-merge 逻辑，可以在这里添加

        // 记录finalize前的音频缓冲区状态（用于调试）
        let buffers_before = self
            .state
            .audio_buffer
            .get_session_buffers_status(&self.session_id)
            .await;
        if !buffers_before.is_empty() {
            info!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                buffers_before = ?buffers_before,
                "Audio buffer status before finalize (should only contain current utterance_index)"
            );
        }

        // 获取音频数据（Fix-E: take_combined 已经是原子的，获取并清空）
        let audio_data_opt = self
            .state
            .audio_buffer
            .take_combined(&self.session_id, utterance_index)
            .await;

        let audio_data = match audio_data_opt {
            Some(data) if !data.is_empty() => data,
            _ => {
                // 修复：如果音频缓冲区为空，不应该 finalize（不递增 utterance_index）
                // 这样可以避免 utterance_index 跳过，导致音频块丢失
                // 如果确实需要 finalize（例如 pause 超时），应该在添加音频块后再 finalize
                warn!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    reason = reason,
                    "Audio buffer empty, skipping finalize to prevent utterance_index skip (audio chunks may be lost)"
                );
                // RF-6: 记录空缓冲区 finalize 尝试（应该为 0，表示修复生效）
                crate::metrics::on_empty_finalize();
                // 返回 false，不允许 finalize（不递增 utterance_index）
                // 这样可以确保后续的音频块仍然使用当前的 utterance_index
                return Ok(false);
            }
        };

        // 从 session 配置中获取 audio_format，如果没有则使用默认值 "pcm16"
        // 注意：web 端现在使用 opus 编码发送 audio_chunk，所以 session.audio_format 应该是 "opus"
        let audio_format = session.audio_format.clone().unwrap_or_else(|| "pcm16".to_string());
        
        // EDGE-4: Padding（在音频末尾添加静音）
        // 注意：Padding 需要在节点端处理（因为需要解码 Opus），这里只记录配置
        // 实际 Padding 将在节点端的 task-router.ts 中实现
        let padding_ms = match finalize_type {
            FinalizeType::Manual => self.edge_config.padding_manual_ms,
            FinalizeType::Auto => self.edge_config.padding_auto_ms,
            FinalizeType::Exception => 0, // 异常情况不添加 padding
        };
        
        info!(
            session_id = %self.session_id,
            utterance_index = utterance_index,
            reason = reason,
            finalize_type = ?finalize_type,
            audio_size_bytes = audio_data.len(),
            audio_format = %audio_format,
            padding_ms = padding_ms,
            "Finalizing audio utterance (EDGE-1: unified finalize interface)"
        );

        // 记录finalize后的音频缓冲区状态（用于调试）
        // 注意：现在音频合并应该由节点端处理，调度服务器在finalize后不应该保留音频缓存
        let buffers_after = self
            .state
            .audio_buffer
            .get_session_buffers_status(&self.session_id)
            .await;
        if !buffers_after.is_empty() {
            warn!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                buffers_after = ?buffers_after,
                "⚠️ Audio buffer still contains data after finalize! This should not happen. Audio merging should be handled by node side."
            );
        } else {
            debug!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                "Audio buffer cleared after finalize (expected behavior)"
            );
        }

        // 检查是否有残留的音频缓冲区（其他utterance_index的缓冲区）
        let has_residual = self
            .state
            .audio_buffer
            .has_residual_buffers(&self.session_id, utterance_index)
            .await;
        if has_residual {
            warn!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                "⚠️ Residual audio buffers detected for other utterance_index! This may cause extra utterances. Cleaning up..."
            );
            
            // 清理残留的音频缓冲区（不应该存在）
            // 注意：现在音频合并应该由节点端处理，调度服务器不应该保留这些残留缓冲区
            let all_buffers = self
                .state
                .audio_buffer
                .get_session_buffers_status(&self.session_id)
                .await;
            for (residual_idx, _) in all_buffers {
                if residual_idx != utterance_index {
                    self.state
                        .audio_buffer
                        .clear(&self.session_id, residual_idx)
                        .await;
                    warn!(
                        session_id = %self.session_id,
                        utterance_index = utterance_index,
                        residual_utterance_index = residual_idx,
                        "Cleaned up residual audio buffer"
                    );
                }
            }
        }
        
        if padding_ms > 0 {
            debug!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                padding_ms = padding_ms,
                audio_format = %audio_format,
                "Padding will be applied in node side (requires Opus decoding)"
            );
            // 注意：Padding 将在节点端实现，因为需要解码 Opus 格式
            // 这里只记录配置，实际处理在 task-router.ts 中
        }

        // 设置结果截止时间（用于抗缺口机制）
        let deadline_ms = chrono::Utc::now().timestamp_millis() + 60_000; // 60 秒后
        self.state
            .result_queue
            .set_result_deadline(&self.session_id, utterance_index, deadline_ms)
            .await;

        // 根据finalize原因设置标识
        let is_manual_cut = reason == "IsFinal" || reason == "Send";
        let is_pause_triggered = reason == "Pause";
        // MaxDuration和Timeout都设置为is_timeout_triggered=true
        // MaxDuration是20秒超时强制截断，需要节点端进行音频切割处理
        let is_timeout_triggered = reason == "Timeout" || reason == "MaxDuration";

        // 创建翻译任务
        let jobs = create_translation_jobs(
            &self.state,
            &self.session_id,
            utterance_index,
            session.src_lang.clone(),
            session.tgt_lang.clone(),
            session.dialect.clone(),
            session.default_features.clone(),
            session.tenant_id.clone(),
            audio_data,
            audio_format,
            16000,
            session.paired_node_id.clone(),
            session.mode.clone(),
            session.lang_a.clone(),
            session.lang_b.clone(),
            session.auto_langs.clone(),
            Some(true), // enable_streaming_asr
            Some(1000u64), // partial_update_interval_ms
            session.trace_id.clone(),
            self.internal_state.first_chunk_client_timestamp_ms,
            Some(padding_ms), // EDGE-4: Padding 配置（传递到节点端）
            is_manual_cut,
            is_pause_triggered,
            is_timeout_triggered,
        )
        .await?;

        // 派发 jobs
        for job in jobs {
            info!(
                trace_id = %job.trace_id,
                job_id = %job.job_id,
                node_id = ?job.assigned_node_id,
                tgt_lang = %job.tgt_lang,
                audio_format = %job.audio_format,
                audio_size_bytes = job.audio_data.len(),
                "Job created (from session actor)"
            );

            if let Some(ref node_id) = job.assigned_node_id {
                // 检查是否已派发（幂等）
                if let Some(existing) = self.state.dispatcher.get_job(&job.job_id).await {
                    if existing.dispatched_to_node {
                        continue;
                    }
                }

                if let Some(job_assign_msg) = create_job_assign_message(&self.state, &job, None, None, None).await {
                    if crate::phase2::send_node_message_routed(&self.state, node_id, job_assign_msg).await {
                        self.state.dispatcher.mark_job_dispatched(&job.job_id).await;
                        send_ui_event(
                            &self.message_tx,
                            &job.trace_id,
                            &self.session_id,
                            &job.job_id,
                            utterance_index,
                            UiEventType::Dispatched,
                            None,
                            UiEventStatus::Ok,
                            None,
                        )
                        .await;
                    } else {
                        warn!(
                            session_id = %self.session_id,
                            job_id = %job.job_id,
                            node_id = %node_id,
                            "Failed to send job to node"
                        );
                        // 发送失败，释放资源
                        self.state.node_registry.release_job_slot(node_id, &job.job_id).await;
                        if let Some(rt) = self.state.phase2.as_ref() {
                            rt.release_node_slot(node_id, &job.job_id).await;
                            let _ = rt
                                .job_fsm_to_finished(&job.job_id, job.dispatch_attempt_id.max(1), false)
                                .await;
                            let _ = rt.job_fsm_to_released(&job.job_id).await;
                        }
                        self.state
                            .dispatcher
                            .update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed)
                            .await;
                        send_ui_event(
                            &self.message_tx,
                            &job.trace_id,
                            &self.session_id,
                            &job.job_id,
                            utterance_index,
                            UiEventType::Error,
                            None,
                            UiEventStatus::Error,
                            Some(ErrorCode::NodeUnavailable),
                        )
                        .await;
                    }
                }
            } else {
                // 节点不可用是内部调度问题，只记录日志，不发送错误给Web端
                warn!(
                    session_id = %self.session_id,
                    job_id = %job.job_id,
                    utterance_index = utterance_index,
                    "Job has no available nodes (internal scheduling issue, not sent to client)"
                );
                // 不发送错误给Web端，让任务在超时后自然失败
            }
        }

        // 更新指标
        match reason {
            "Send" | "IsFinal" => crate::metrics::on_web_task_finalized_by_send(),
            "Pause" | "Timeout" => crate::metrics::on_web_task_finalized_by_pause(),
            _ => {}
        }

        Ok(true)
    }

    /// 取消所有计时器
    fn cancel_timers(&mut self) {
        if let Some(handle) = self.current_timer_handle.take() {
            handle.abort();
        }
    }

    /// 重置计时器（启动新的超时计时器）
    async fn reset_timers(&mut self) -> Result<(), anyhow::Error> {
        // 取消旧计时器
        self.cancel_timers();

        // 更新 generation
        let generation = self.internal_state.increment_timer_generation();
        let timestamp_ms = self.internal_state.last_chunk_timestamp_ms.unwrap_or_else(|| {
            chrono::Utc::now().timestamp_millis()
        });

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

    /// 处理更新 utterance_index 事件
    async fn handle_update_utterance_index(&mut self, new_index: u64) -> Result<(), anyhow::Error> {
        let old_index = self.internal_state.current_utterance_index;
        self.internal_state.update_utterance_index(new_index);
        info!(
            session_id = %self.session_id,
            old_index = old_index,
            new_index = new_index,
            "Updated utterance_index from utterance message"
        );
        Ok(())
    }

    /// 清理资源
    async fn cleanup(&mut self) {
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

        debug!(
            session_id = %self.session_id,
            "Session Actor cleanup completed"
        );
    }
}

