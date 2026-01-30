use super::SessionActor;
use super::actor_types::FinalizeType;
use crate::messages::{ErrorCode, UiEventStatus, UiEventType};
use crate::websocket::{create_job_assign_message, send_ui_event};
use crate::websocket::job_creator::create_translation_jobs;
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

impl SessionActor {
    /// 尝试 finalize（带去重检查）
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
        
        info!(
            session_id = %self.session_id,
            utterance_index = utterance_index,
            reason = reason,
            finalize_inflight = ?self.internal_state.finalize_inflight,
            state = ?self.internal_state.state,
            accumulated_audio_duration_ms = self.internal_state.accumulated_audio_duration_ms,
            max_duration_ms = self.max_duration_ms,
            "Finalize: 开始处理（原因: {})",
            reason
        );

        // 判断 finalize 类型并应用 Hangover 延迟
        let finalize_type = FinalizeType::from_reason(reason);
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

        // 执行 finalize
        let finalized = self.do_finalize(utterance_index, reason, finalize_type).await?;

        if finalized {
            // 完成 finalize，递增 index
            self.internal_state.complete_finalize();
            // 重置状态
            self.internal_state.pending_short_audio = false;
            self.internal_state.accumulated_short_audio_duration_ms = 0;
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

    /// 执行 finalize（创建 job）
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

        // 与备份一致：take 一次，传入 create_translation_jobs，随 Job 存储
        let audio_data = match self
            .state
            .audio_buffer
            .take_combined(&self.session_id, utterance_index)
            .await
        {
            Some(data) if !data.is_empty() => data,
            _ => {
                warn!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    reason = reason,
                    "Audio buffer empty, skipping finalize"
                );
                crate::metrics::on_empty_finalize();
                return Ok(false);
            }
        };

        let audio_format = session.audio_format.clone().unwrap_or_else(|| "pcm16".to_string());
        let padding_ms = match finalize_type {
            FinalizeType::Manual => self.edge_config.padding_manual_ms,
            FinalizeType::Auto => self.edge_config.padding_auto_ms,
            FinalizeType::Exception => 0,
        };
        info!(
            session_id = %self.session_id,
            utterance_index = utterance_index,
            reason = reason,
            finalize_type = ?finalize_type,
            audio_size_bytes = audio_data.len(),
            audio_format = %audio_format,
            padding_ms = padding_ms,
            "Finalizing audio utterance"
        );

        // 根据 finalize 原因设置标识
        let is_manual_cut = reason == "IsFinal";
        // ✅ 修复：MaxDuration 使用独立的标签，不与 timeout 混用
        let is_timeout_triggered = reason == "Timeout";
        // MaxDuration：用户持续说话超过最大时长，产生多 job；节点端按切片处理
        let is_max_duration_triggered = reason == "MaxDuration";

        // ============================================================
        // Session Affinity：手动/timeout finalize时立即清除timeout_node_id映射
        // 必须在jobs创建之前清除，确保当前job不会使用旧的timeout_node_id
        // ============================================================
        if is_manual_cut || is_timeout_triggered {
            if let Some(ref rt) = self.state.phase2 {
                let session_key = format!("scheduler:session:{}", self.session_id);
                
                // 使用Lua脚本原子性地清除timeout_node_id
                let script = r#"
redis.call('HDEL', KEYS[1], 'timeout_node_id')
return 1
"#;
                let mut cmd = redis::cmd("EVAL");
                cmd.arg(script).arg(1).arg(&session_key);
                
                match rt.redis_query::<i64>(cmd).await {
                    Ok(_) => {
                        info!(
                            session_id = %self.session_id,
                            utterance_index = utterance_index,
                            reason = reason,
                            is_manual_cut = is_manual_cut,
                            is_timeout_triggered = is_timeout_triggered,
                            "Session affinity: Cleared timeout_node_id mapping (manual/timeout finalize) - cleared before job creation, subsequent jobs can use random assignment"
                        );
                    }
                    Err(e) => {
                        warn!(
                            session_id = %self.session_id,
                            utterance_index = utterance_index,
                            reason = reason,
                            is_manual_cut = is_manual_cut,
                            is_timeout_triggered = is_timeout_triggered,
                            error = %e,
                            "Session affinity: Failed to clear timeout_node_id mapping (will retry after job creation)"
                        );
                    }
                }
            }
        }

        // 创建翻译任务
        info!(
            session_id = %self.session_id,
            utterance_index = utterance_index,
            src_lang = %session.src_lang,
            tgt_lang = %session.tgt_lang,
            lang_a = ?session.lang_a,
            lang_b = ?session.lang_b,
            mode = ?session.mode,
            audio_bytes = audio_data.len(),
            "【Finalize】开始创建翻译任务"
        );
        // 使用默认 pipeline 配置（finalize 时没有 pipeline 信息，使用默认值）
        let default_pipeline = crate::messages::PipelineConfig {
            use_asr: true,
            use_nmt: true,
            use_tts: true,
            use_semantic: false, // 语义修复由节点端自己决定
            use_tone: false, // 默认不使用音色克隆
        };


        let jobs = match create_translation_jobs(
            &self.state,
            &self.session_id,
            utterance_index,
            session.src_lang.clone(),
            session.tgt_lang.clone(),
            session.dialect.clone(),
            session.default_features.clone(),
            default_pipeline,
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
            Some(padding_ms),
            is_manual_cut,
            is_timeout_triggered,
            is_max_duration_triggered,
        )
        .await {
            Ok(jobs) => {
                info!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    job_count = jobs.len(),
                    "【Finalize】翻译任务创建成功，共 {} 个任务",
                    jobs.len()
                );
                jobs
            },
            Err(e) => {
                tracing::error!(
                    session_id = %self.session_id,
                    utterance_index = utterance_index,
                    error = %e,
                    "翻译任务创建失败"
                );
                return Err(e);
            }
        };

        // ============================================================
        // Session Affinity：MaxDuration finalize 时记录 sessionId->nodeId 映射
        // 连续长语音产生多 job，需路由到同一节点
        // ============================================================
        if is_max_duration_triggered {
            // 获取第一个job的node_id（如果有）
            if let Some(first_job) = jobs.first() {
                if let Some(ref node_id) = first_job.assigned_node_id {
                    // 记录sessionId->nodeId映射到Redis
                    if let Some(ref rt) = self.state.phase2 {
                        let session_key = format!("scheduler:session:{}", self.session_id);
                        let ttl_seconds = 5 * 60; // 5分钟TTL（优化：符合业务逻辑，避免长期缓存）
                        
                        // ✅ 修复：MaxDuration 使用独立的 Redis key，不与 timeout 混用
                        // 使用Lua脚本原子性地设置max_duration_node_id
                        let script = r#"
redis.call('HSET', KEYS[1], 'max_duration_node_id', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"#;
                        let mut cmd = redis::cmd("EVAL");
                        cmd.arg(script)
                            .arg(1)
                            .arg(&session_key)
                            .arg(node_id)
                            .arg(ttl_seconds);
                        
                        match rt.redis_query::<i64>(cmd).await {
                            Ok(_) => {
                                info!(
                                    session_id = %self.session_id,
                                    utterance_index = utterance_index,
                                    reason = reason,
                                    node_id = %node_id,
                                    ttl_seconds = ttl_seconds,
                                    job_count = jobs.len(),
                                    first_job_id = ?jobs.first().map(|j| &j.job_id),
                                    "Session affinity: Recorded MaxDuration finalize session mapping - subsequent jobs will route to same node"
                                );
                            }
                            Err(e) => {
                                warn!(
                                    session_id = %self.session_id,
                                    utterance_index = utterance_index,
                                    reason = reason,
                                    node_id = %node_id,
                                    ttl_seconds = ttl_seconds,
                                    error = %e,
                                    "Session affinity: Failed to record MaxDuration finalize session mapping"
                                );
                            }
                        }
                    }
                }
            }
        } else if is_manual_cut || is_timeout_triggered {
            // 手动/timeout finalize：如果之前清除失败，再次尝试清除（兜底）
            // 注意：主要清除已在jobs创建之前完成，这里是兜底逻辑
            if let Some(ref rt) = self.state.phase2 {
                let session_key = format!("scheduler:session:{}", self.session_id);
                
                // 使用Lua脚本原子性地清除timeout_node_id
                let script = r#"
redis.call('HDEL', KEYS[1], 'timeout_node_id')
return 1
"#;
                let mut cmd = redis::cmd("EVAL");
                cmd.arg(script).arg(1).arg(&session_key);
                
                match rt.redis_query::<i64>(cmd).await {
                    Ok(_) => {
                        debug!(
                            session_id = %self.session_id,
                            utterance_index = utterance_index,
                            reason = reason,
                            is_manual_cut = is_manual_cut,
                            is_timeout_triggered = is_timeout_triggered,
                            "Session affinity: Cleared timeout_node_id mapping (fallback cleanup after job creation)"
                        );
                    }
                    Err(e) => {
                        warn!(
                            session_id = %self.session_id,
                            utterance_index = utterance_index,
                            reason = reason,
                            is_manual_cut = is_manual_cut,
                            is_timeout_triggered = is_timeout_triggered,
                            error = %e,
                            "Session affinity: Failed to clear timeout_node_id mapping (fallback cleanup also failed)"
                        );
                    }
                }
            }
        }

        for job in jobs {
            info!(
                trace_id = %job.trace_id,
                job_id = %job.job_id,
                node_id = ?job.assigned_node_id,
                tgt_lang = %job.tgt_lang,
                audio_format = %job.audio_format,
                audio_base64_len = job.audio_base64.len(),
                "【Finalize】Job 已创建"
            );

            if let Some(ref node_id) = job.assigned_node_id {
                // 优化: 使用本地内存字段作为短路条件（性能优化）
                // 注意：跨实例正确性必须通过 Redis Lua 原子占用保证，不能仅依赖本地字段
                if job.dispatched_to_node {
                    continue;  // 已派发，跳过（本地判断）
                }

                // 关键：必须以 Redis Lua 原子占用作为唯一闸门
                // 先执行 Lua 原子占用 → 占用成功后再向节点发送任务
                // 优化：使用 mark_job_dispatched，它内部会进行原子占用
                let dispatch_result = self.state.dispatcher.mark_job_dispatched(&job.job_id, Some(&job.request_id), Some(job.dispatch_attempt_id)).await;
                
                if !dispatch_result {
                    debug!(
                        session_id = %self.session_id,
                        job_id = %job.job_id,
                        node_id = %node_id,
                        utterance_index = utterance_index,
                        "【Finalize】原子占用失败，跳过派发"
                    );
                    continue;
                }
                
                // 原子占用成功，可以安全派发
                if let Some(job_assign_msg) = create_job_assign_message(&self.state, &job, None, None, None).await {
                    info!(
                        trace_id = %job.trace_id,
                        job_id = %job.job_id,
                        session_id = %self.session_id,
                        node_id = %node_id,
                        utterance_index = utterance_index,
                        "【派发】准备发送 JobAssign 到节点"
                    );
                    if crate::redis_runtime::send_node_message_routed(&self.state, node_id, job_assign_msg).await {
                        info!(
                            trace_id = %job.trace_id,
                            job_id = %job.job_id,
                            session_id = %self.session_id,
                            node_id = %node_id,
                            utterance_index = utterance_index,
                            "【派发】JobAssign 发送成功，任务已分发"
                        );
                        
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
                            trace_id = %job.trace_id,
                            session_id = %self.session_id,
                            job_id = %job.job_id,
                            node_id = %node_id,
                            utterance_index = utterance_index,
                            "【派发】发往节点失败"
                        );
                        // 发送失败，释放资源
                        if let Some(rt) = self.state.phase2.as_ref() {
                            rt.release_node_slot(node_id, &job.job_id, job.dispatch_attempt_id).await;
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
                warn!(
                    session_id = %self.session_id,
                    job_id = %job.job_id,
                    utterance_index = utterance_index,
                    "【任务创建】无可用节点（调度问题，未下发给客户端）"
                );
            }
        }

        // 更新指标
        match reason {
            "IsFinal" => crate::metrics::on_web_task_finalized_by_send(),
            "Timeout" => crate::metrics::on_web_task_finalized_by_timeout(),
            "MaxDuration" => {
                // ✅ 修复：MaxDuration 使用独立的 metrics，但如果没有则使用 timeout（向后兼容）
                // 注意：这里暂时使用 timeout metrics，因为 MaxDuration 和 timeout 都是自动 finalize
                crate::metrics::on_web_task_finalized_by_timeout()
            },
            _ => {}
        }

        Ok(true)
    }
}

