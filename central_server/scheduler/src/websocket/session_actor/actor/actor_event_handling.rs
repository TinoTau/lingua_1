use super::SessionActor;
use super::super::events::SessionEvent;
use tracing::{debug, info};

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
            SessionEvent::RestartTimer { timestamp_ms } => {
                self.handle_restart_timer(timestamp_ms).await?;
            }
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
        // 如果正在 finalize，新的 chunk 进入下一个 utterance_index 的缓冲区
        let utterance_index = if let Some(finalizing_index) = self.internal_state.finalize_inflight {
            finalizing_index + 1
        } else {
            self.internal_state.current_utterance_index
        };
        
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
        
        // 在移动 chunk 之前保存其长度（用于日志）
        let chunk_size = chunk.len();
        
        // 添加音频块到缓冲区
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
        
        // 检查暂停是否超过阈值（只有实际音频内容才用于 pause 检测）
        let pause_exceeded = if chunk_size > 0 {
            let last_chunk_at = self.state
                .audio_buffer
                .get_last_chunk_at_ms(&self.session_id)
                .await;
            let pause_exceeded_result = self.state
                .audio_buffer
                .record_chunk_and_check_pause(&self.session_id, timestamp_ms, self.pause_ms)
                .await;
            
            // 获取更新后的 last_chunk_at_ms（用于日志）
            let updated_last_chunk_at = self.state
                .audio_buffer
                .get_last_chunk_at_ms(&self.session_id)
                .await;
            
            // 判断是否是第一批chunk（用于特殊日志标记）
            let is_first_chunk_after_restart = last_chunk_at.is_some() && 
                last_chunk_at.map(|prev| timestamp_ms - prev).unwrap_or(0) < 1000; // 1秒内认为是第一批
            
            // 修复：检查是否是刚finalize后的新utterance的第一个chunk
            // 如果时间差<5秒，可能是RestartTimer延迟，不应该触发pause finalize
            let is_first_chunk_after_finalize = utterance_index > self.internal_state.current_utterance_index;
            let pause_duration_ms = last_chunk_at.map(|prev| timestamp_ms - prev).unwrap_or(0);
            const RESTART_TIMER_DELAY_TOLERANCE_MS: i64 = 5000; // RestartTimer延迟容忍度：5秒
            
            // 如果是新utterance的第一个chunk，且时间差<5秒，可能是RestartTimer延迟，不触发pause finalize
            let should_ignore_pause_due_to_restart_timer_delay = 
                is_first_chunk_after_finalize && 
                pause_duration_ms > self.pause_ms as i64 && 
                pause_duration_ms < RESTART_TIMER_DELAY_TOLERANCE_MS;
            
            // 详细日志：用于诊断 pause finalize 问题
            if pause_exceeded_result {
                if should_ignore_pause_due_to_restart_timer_delay {
                    info!(
                        session_id = %self.session_id,
                        utterance_index = utterance_index,
                        chunk_size = chunk_size,
                        timestamp_ms = timestamp_ms,
                        last_chunk_at_ms_before = ?last_chunk_at,
                        last_chunk_at_ms_after = ?updated_last_chunk_at,
                        pause_ms = self.pause_ms,
                        pause_duration_ms = pause_duration_ms,
                        is_first_chunk_after_finalize = is_first_chunk_after_finalize,
                        restart_timer_delay_tolerance_ms = RESTART_TIMER_DELAY_TOLERANCE_MS,
                        reason = "First chunk after finalize with pause duration < 5s, likely RestartTimer delay, not triggering pause finalize",
                        "AudioChunk: Pause阈值已超过，但是新utterance的第一个chunk且时间差<5秒，可能是RestartTimer延迟，不触发finalize"
                    );
                    false // 不触发pause finalize
                } else {
                    info!(
                        session_id = %self.session_id,
                        utterance_index = utterance_index,
                        chunk_size = chunk_size,
                        timestamp_ms = timestamp_ms,
                        last_chunk_at_ms_before = ?last_chunk_at,
                        last_chunk_at_ms_after = ?updated_last_chunk_at,
                        pause_ms = self.pause_ms,
                        pause_duration_ms = pause_duration_ms,
                        is_first_chunk_after_restart = is_first_chunk_after_restart,
                        is_first_chunk_after_finalize = is_first_chunk_after_finalize,
                        "AudioChunk: Pause阈值已超过，将触发finalize"
                    );
                    pause_exceeded_result
                }
            } else if let Some(prev) = last_chunk_at {
                let pause_duration = timestamp_ms - prev;
                if is_first_chunk_after_restart {
                    info!(
                        session_id = %self.session_id,
                        utterance_index = utterance_index,
                        chunk_size = chunk_size,
                        timestamp_ms = timestamp_ms,
                        last_chunk_at_ms_before = prev,
                        last_chunk_at_ms_after = ?updated_last_chunk_at,
                        pause_duration_ms = pause_duration,
                        pause_ms = self.pause_ms,
                        "AudioChunk: 第一批chunk到达（播放完成后），pause检测通过"
                    );
                } else {
                    debug!(
                        session_id = %self.session_id,
                        utterance_index = utterance_index,
                        chunk_size = chunk_size,
                        timestamp_ms = timestamp_ms,
                        last_chunk_at_ms_before = prev,
                        last_chunk_at_ms_after = ?updated_last_chunk_at,
                        pause_duration_ms = pause_duration,
                        pause_ms = self.pause_ms,
                        "AudioChunk: Pause检测通过（在阈值内）"
                    );
                }
                pause_exceeded_result
            } else {
                info!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    chunk_size = chunk_size,
                    timestamp_ms = timestamp_ms,
                    last_chunk_at_ms_after = ?updated_last_chunk_at,
                    "AudioChunk: 第一个chunk到达（无历史记录）"
                );
                pause_exceeded_result
            }
        } else {
            false // 空的 is_final=true 不触发 pause finalize
        };

        // 检查是否需要 finalize
        let mut should_finalize = false;
        let mut finalize_reason = "";
        
        // 检查 pause_exceeded
        if pause_exceeded {
            // 修复：检查是否在TTS播放期间
            // 从播放开始到播放结束期间，都不进行pause计时
            let is_tts_playing = {
                // 获取session的活跃group_id
                if let Some(group_id) = self.state.group_manager.get_active_group_id(&self.session_id).await {
                    // 检查是否在TTS播放期间（从播放开始到播放结束）
                    self.state.group_manager.is_tts_playing(&group_id, timestamp_ms).await
                } else {
                    false
                }
            };
            
            if is_tts_playing {
                // 重新获取last_chunk_at用于日志（因为它在pause_exceeded块内）
                let last_chunk_at_for_log = self.state
                    .audio_buffer
                    .get_last_chunk_at_ms(&self.session_id)
                    .await;
                let pause_duration_ms_for_log = last_chunk_at_for_log.map(|prev| timestamp_ms - prev).unwrap_or(0);
                info!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    chunk_size = chunk_size,
                    timestamp_ms = timestamp_ms,
                    last_chunk_at_ms_before = ?last_chunk_at_for_log,
                    pause_duration_ms = pause_duration_ms_for_log,
                    reason = "Chunk间隔>3秒，但可能在TTS播放期间，不触发pause finalize",
                    "AudioChunk: Pause阈值已超过，但可能在TTS播放期间，不触发finalize"
                );
                // 不触发pause finalize
            } else {
                should_finalize = true;
                finalize_reason = "Pause";
            }
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
            // 记录 is_final 到达（用于调试）
            debug!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                chunk_size = chunk_size,
                timestamp_ms = timestamp_ms,
                last_chunk_timestamp_ms = ?self.internal_state.last_chunk_timestamp_ms,
                "Received is_final=true (may be empty chunk for timer reset)"
            );
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
        
        // 如果需要 finalize 且没有正在进行的 finalize，执行 finalize
        if should_finalize && self.internal_state.finalize_inflight.is_none() {
            info!(
                session_id = %self.session_id,
                utterance_index = utterance_index,
                reason = finalize_reason,
                chunk_size = chunk_size,
                timestamp_ms = timestamp_ms,
                accumulated_audio_duration_ms = self.internal_state.accumulated_audio_duration_ms,
                max_duration_ms = self.max_duration_ms,
                "AudioChunk: 触发finalize（原因: {})",
                finalize_reason
            );
            let finalized = self.try_finalize(utterance_index, finalize_reason).await?;
            if finalized {
                info!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    reason = finalize_reason,
                    "AudioChunk: Finalize成功完成"
                );
                // finalize 成功，utterance_index 已经在 try_finalize 中递增
                // 这里不需要再次更新，因为下一个 chunk 会使用新的 utterance_index
            }
        } else if self.pause_ms > 0 && self.internal_state.finalize_inflight.is_none() {
            // 不需要 finalize，重置超时计时器
            self.reset_timers().await?;
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

    /// 处理重启计时器（用于播放完成后重置 pause 检测计时器）
    pub(crate) async fn handle_restart_timer(&mut self, timestamp_ms: i64) -> Result<(), anyhow::Error> {
        // 获取更新前的时间戳，用于日志
        let prev_last_chunk_at = self.state
            .audio_buffer
            .get_last_chunk_at_ms(&self.session_id)
            .await;
        
        // 更新 last_chunk_at_ms，重置 pause 检测的基准时间
        // 使用调度服务器时间戳，确保与音频chunk的timestamp_ms（调度服务器接收时间）基准一致
        self.state
            .audio_buffer
            .update_last_chunk_at_ms(&self.session_id, timestamp_ms)
            .await;
        
        // 获取更新后的时间戳，用于日志
        let new_last_chunk_at = self.state
            .audio_buffer
            .get_last_chunk_at_ms(&self.session_id)
            .await;
        
        // 重置计时器
        // 注意：reset_timers() 会使用 audio_buffer.get_last_chunk_at_ms()，所以这里已经更新了时间戳
        if self.pause_ms > 0 {
            info!(
                session_id = %self.session_id,
                timestamp_ms = timestamp_ms,
                prev_last_chunk_at_ms = ?prev_last_chunk_at,
                new_last_chunk_at_ms = ?new_last_chunk_at,
                pause_ms = self.pause_ms,
                current_utterance_index = self.internal_state.current_utterance_index,
                finalize_inflight = ?self.internal_state.finalize_inflight,
                "RestartTimer: 已更新 last_chunk_at_ms，重置 pause 检测计时器"
            );
            self.reset_timers().await?;
        }
        
        Ok(())
    }

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

