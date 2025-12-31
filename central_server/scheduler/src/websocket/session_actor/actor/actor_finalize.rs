use super::SessionActor;
use super::actor_types::FinalizeType;
use crate::messages::{ErrorCode, UiEventStatus, UiEventType};
use crate::websocket::{create_job_assign_message, send_ui_event};
use crate::websocket::job_creator::create_translation_jobs;
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

impl SessionActor {
    /// 尝试 finalize（带去重检查 + EDGE-1: 统一接口）
    pub(crate) async fn try_finalize(
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
        let finalize_type = FinalizeType::from_reason(reason);
        
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
            self.internal_state.state = super::super::state::SessionActorState::Idle;
            self.internal_state.finalize_inflight = None;
        }

        Ok(finalized)
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
}

