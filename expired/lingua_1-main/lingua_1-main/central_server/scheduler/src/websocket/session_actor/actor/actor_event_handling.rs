use super::SessionActor;
use super::super::events::SessionEvent;
use tracing::debug;

impl SessionActor {
    /// 处理事件
    pub(crate) async fn handle_event(&mut self, event: SessionEvent) -> Result<(), anyhow::Error> {
        match event {
            SessionEvent::AudioChunkReceived { chunk, is_final, timestamp_ms, client_timestamp_ms } => {
                self.handle_audio_chunk(chunk, is_final, timestamp_ms, client_timestamp_ms).await?;
            }
            SessionEvent::TimeoutFired { generation, timestamp_ms } => {
                self.handle_timeout_fired(generation, timestamp_ms).await?;
            }
            // 已删除未使用的枚举变体处理：IsFinalReceived
            // 此变体从未被构造，is_final 的处理已在 handle_audio_chunk 中完成
            SessionEvent::CloseSession => {
                self.handle_close().await?;
            }
        }
        Ok(())
    }

    /// 处理音频块
    pub(crate) async fn handle_audio_chunk(
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
                tracing::warn!(
                    session_id = %self.session_id,
                    "Session not found, skipping audio chunk"
                );
                return Ok(());
            }
        };
        
        let audio_format = session.audio_format.clone().unwrap_or_else(|| "pcm16".to_string());
        let sample_rate = 16000u32; // 默认采样率（Web 端使用 16kHz）
        
        // 计算当前音频块的时长
        let chunk_duration_ms = super::super::audio_duration::calculate_audio_duration_ms(&chunk, &audio_format, sample_rate);
        
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
            tracing::warn!(
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
            tracing::warn!(
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


    /// 处理超时触发
    pub(crate) async fn handle_timeout_fired(
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

    // 已删除未使用的函数：handle_is_final
    // 此函数只在已删除的 IsFinalReceived 事件处理中被调用

    /// 处理关闭会话
    /// Fix-D (RF-4): Session 结束时强制 flush_finalize
    pub(crate) async fn handle_close(&mut self) -> Result<(), anyhow::Error> {
        // 在关闭前，强制 finalize 当前 utterance（如果有数据）
        let utterance_index = self.internal_state.current_utterance_index;
        
        // 直接调用 try_finalize，它会检查缓冲区是否有数据
        // 如果有数据，会创建 job；如果没有数据，会返回 false（不递增 index）
        let finalized = self.try_finalize(utterance_index, "SessionClose").await?;
        
        if finalized {
            tracing::info!(
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
        
        self.internal_state.state = super::super::state::SessionActorState::Closed;
        Ok(())
    }

}

