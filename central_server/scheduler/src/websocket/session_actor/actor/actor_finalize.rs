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

        // 只产生 3 种 finalize：手动、Timeout、MaxDuration（与备份语义对齐）
        let is_manual_cut = reason == "IsFinal";
        let is_timeout_triggered = reason == "Timeout";  // 定时器或间隔>pause_ms 均传 "Timeout"
        let is_max_duration_triggered = reason == "MaxDuration";

        // ============================================================
        // Turn 内亲和：复用 session 的 current_turn_id，使同 turn 内（多个 MaxDuration + 最后一个手动/Timeout）选到同一节点
        // 先读再创建 job，不在创建前清除；手动/Timeout 在创建并派发后再清除，保证最后一 job 仍走 affinity
        // ============================================================
        let session_key = format!("scheduler:session:{}", self.session_id);
        let turn_id = if let Some(ref rt) = self.state.phase2 {
            let get_script = r#"return redis.call('HGET', KEYS[1], 'current_turn_id') or ''"#;
            let mut get_cmd = redis::cmd("EVAL");
            get_cmd.arg(get_script).arg(1).arg(&session_key);
            let existing: Option<String> = rt.redis_query(get_cmd).await.ok().and_then(|s: String| if s.is_empty() { None } else { Some(s) });
            existing.unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
        } else {
            uuid::Uuid::new_v4().to_string()
        };

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
            &turn_id,
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
        // Turn 内亲和：MaxDuration finalize 时写入 affinity_node_id（只写一次，无 TTL）
        // 并记录 current_turn_id 供 manual/timeout 清除时使用
        // ============================================================
        if is_max_duration_triggered {
            if let Some(first_job) = jobs.first() {
                if let Some(ref node_id) = first_job.assigned_node_id {
                    if let Some(ref rt) = self.state.phase2 {
                        let turn_key = format!("scheduler:turn:{}", turn_id);
                        let session_key = format!("scheduler:session:{}", self.session_id);
                        let script = r#"
redis.call('HSET', KEYS[1], 'affinity_node_id', ARGV[1])
redis.call('HSET', KEYS[2], 'current_turn_id', ARGV[2])
return 1
"#;
                        let mut cmd = redis::cmd("EVAL");
                        cmd.arg(script).arg(2).arg(&turn_key).arg(&session_key).arg(node_id).arg(&turn_id);
                        match rt.redis_query::<i64>(cmd).await {
                            Ok(_) => {
                                info!(
                                    session_id = %self.session_id,
                                    turn_id = %turn_id,
                                    node_id = %node_id,
                                    "Turn affinity: Recorded (MaxDuration finalize)"
                                );
                            }
                            Err(e) => {
                                warn!(
                                    session_id = %self.session_id,
                                    turn_id = %turn_id,
                                    error = %e,
                                    "Turn affinity: Failed to record"
                                );
                            }
                        }
                    }
                }
            }
        } else if is_manual_cut || is_timeout_triggered {
            // 手动/Timeout：在创建并派发本 job 之后清除 turn affinity，下一轮发言用新 turn_id（本 job 已用当前 turn 的 affinity 选到同一节点）
            if let Some(ref rt) = self.state.phase2 {
                let turn_key = format!("scheduler:turn:{}", turn_id);
                let del_script = r#"
redis.call('HDEL', KEYS[1], 'affinity_node_id')
redis.call('HDEL', KEYS[2], 'current_turn_id')
return 1
"#;
                let mut del_cmd = redis::cmd("EVAL");
                del_cmd.arg(del_script).arg(2).arg(&turn_key).arg(&session_key);
                match rt.redis_query::<i64>(del_cmd).await {
                    Ok(_) => {
                        info!(
                            session_id = %self.session_id,
                            turn_id = %turn_id,
                            "Turn affinity: Cleared after job (manual/timeout finalize)"
                        );
                    }
                    Err(e) => {
                        warn!(
                            session_id = %self.session_id,
                            turn_id = %turn_id,
                            error = %e,
                            "Turn affinity: Failed to clear after job"
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

        // 更新指标（仅 3 种 finalize）
        match reason {
            "IsFinal" => crate::metrics::on_web_task_finalized_by_send(),
            "Timeout" => crate::metrics::on_web_task_finalized_by_timeout(),
            "MaxDuration" => crate::metrics::on_web_task_finalized_by_timeout(),
            _ => {}
        }

        Ok(true)
    }
}

