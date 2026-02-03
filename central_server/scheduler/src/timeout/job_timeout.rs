use crate::core::{AppState, config::JobTimeoutPolicyConfig};
use crate::messages::{ErrorCode, SessionMessage, UiEventStatus, UiEventType, get_error_hint, NodeMessage};
use tracing::{warn, info, error};

/// Phase 1：Job 超时管理（单机可跑 + 为后续集群留空间）
///
/// 语义（按你的决策落地）：
/// - `scheduler.job_timeout_seconds`：从“成功下发到节点（dispatched）”开始计时
/// - `scheduler.job_timeout.pending_timeout_seconds`：Pending（未成功派发）从 created_at 计时，默认 10s
/// - 超时后：best-effort `job_cancel`；然后最多 `failover_max_attempts` 次重派
/// - 超过重派次数仍超时：标记失败并向会话推送 `JOB_TIMEOUT`
pub fn start_job_timeout_manager(
    state: AppState,
    dispatched_timeout_seconds: u64,
    policy: JobTimeoutPolicyConfig,
    reserved_ttl_seconds: u64,
) {
    let dispatched_timeout_ms = (dispatched_timeout_seconds.max(1) as i64) * 1000;
    let pending_timeout_ms = (policy.pending_timeout_seconds.max(1) as i64) * 1000;
    let scan_interval = std::time::Duration::from_millis(policy.scan_interval_ms.max(200));
    let _ttl = std::time::Duration::from_secs(reserved_ttl_seconds.max(1));
    let reserved_ttl_seconds = reserved_ttl_seconds.max(1);

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(scan_interval);
        loop {
            interval.tick().await;
            let now_ms = chrono::Utc::now().timestamp_millis();

            let jobs = state.dispatcher.list_jobs_snapshot().await;
            for job in jobs {
                if matches!(job.status, crate::core::dispatcher::JobStatus::Completed | crate::core::dispatcher::JobStatus::Failed) {
                    continue;
                }

                // 1) Pending/未成功派发：从 created_at 计时，超过 pending_timeout_seconds 直接失败
                let is_not_dispatched = !job.dispatched_to_node || job.assigned_node_id.is_none();
                if is_not_dispatched {
                    let created_at_ms = job.created_at.timestamp_millis();
                    if now_ms - created_at_ms > pending_timeout_ms {
                        warn!(
                            trace_id = %job.trace_id,
                            job_id = %job.job_id,
                            session_id = %job.session_id,
                            utterance_index = job.utterance_index,
                            node_id = ?job.assigned_node_id,
                            pending_timeout_seconds = policy.pending_timeout_seconds,
                            "Job pending 超时，标记失败"
                        );
                        state.dispatcher.update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed).await;
                        if let Some(rt) = state.redis_runtime.as_ref() {
                            let _ = rt
                                .job_fsm_to_finished(&job.job_id, job.dispatch_attempt_id.max(1), false)
                                .await;
                            let _ = rt.job_fsm_to_released(&job.job_id).await;
                        }
                        notify_job_timeout(&state, &job, Some(now_ms as u64)).await;
                    }
                    continue;
                }

                // 2) 已派发：从 dispatched_at_ms 计时，超过 job_timeout_seconds 触发 cancel + failover
                let Some(ref current_node_id) = job.assigned_node_id else { continue };
                let dispatched_at_ms = job.dispatched_at_ms.unwrap_or_else(|| job.created_at.timestamp_millis());
                if now_ms - dispatched_at_ms <= dispatched_timeout_ms {
                    continue;
                }

                // 记录 ACK 超时指标
                crate::metrics::prometheus_metrics::on_ack_timeout(&job.job_id);
                
                warn!(
                    trace_id = %job.trace_id,
                    job_id = %job.job_id,
                    session_id = %job.session_id,
                    utterance_index = job.utterance_index,
                    node_id = %current_node_id,
                    dispatched_timeout_seconds = dispatched_timeout_seconds,
                    failover_attempts = job.failover_attempts,
                    failover_max_attempts = policy.failover_max_attempts,
                    elapsed_ms = now_ms - dispatched_at_ms,
                    "Job dispatched 超时，尝试 cancel + failover"
                );

                // best-effort cancel old node
                if policy.send_cancel {
                    let cancel_msg = NodeMessage::JobCancel {
                        job_id: job.job_id.clone(),
                        trace_id: Some(job.trace_id.clone()),
                        reason: Some("job_timeout".to_string()),
                    };
                    let _ = crate::redis_runtime::send_node_message_routed(&state, current_node_id, cancel_msg).await;
                }

                // 释放旧节点 reserved（幂等）- 统一使用Phase2 Redis实现
                if let Some(rt) = state.redis_runtime.as_ref() {
                    rt.release_node_slot(current_node_id, &job.job_id, job.dispatch_attempt_id).await;
                        let _ = rt
                            .job_fsm_to_finished(&job.job_id, job.dispatch_attempt_id.max(1), false)
                            .await;
                        let _ = rt.job_fsm_to_released(&job.job_id).await;
                }

                if job.failover_attempts >= policy.failover_max_attempts {
                    state.dispatcher.update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed).await;
                    if let Some(rt) = state.redis_runtime.as_ref() {
                        let _ = rt
                            .job_fsm_to_finished(&job.job_id, job.dispatch_attempt_id.max(1), false)
                            .await;
                        let _ = rt.job_fsm_to_released(&job.job_id).await;
                    }
                    notify_job_timeout(&state, &job, Some(now_ms as u64)).await;
                    continue;
                }

                // 选新节点：优先避开上一节点；若没有其他节点可用，则允许回退到同一节点
                // （通过 attempt_id 做结果去重，避免“同一节点取消+重派”的竞态覆盖）
                let required = match state.dispatcher.required_types_for_job(&job).await {
                    Ok(v) => v,
                    Err(e) => {
                        warn!(trace_id = %job.trace_id, job_id = %job.job_id, error = %e, "计算 required_services 失败，标记为失败");
                        state.dispatcher.update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed).await;
                        notify_job_timeout(&state, &job, Some(now_ms as u64)).await;
                        continue;
                    }
                };

                let (mut selected, _bd) = state
                    .node_registry
                    .select_node_with_types_excluding_with_breakdown(
                        &job.src_lang,
                        &job.tgt_lang,
                        &required,
                        true,
                        Some(current_node_id),
                    )
                    .await;
                if selected.is_none() {
                    let (fallback, _bd2) = state
                        .node_registry
                        .select_node_with_types_excluding_with_breakdown(
                            &job.src_lang,
                            &job.tgt_lang,
                            &required,
                            true,
                            None,
                        )
                        .await;
                    selected = fallback;
                }

                let Some(new_node_id) = selected else {
                    // 当前无法找到可用节点：直接失败（避免进入“永远 pending 且不再派发”的状态）
                    state.dispatcher.update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed).await;
                    notify_job_timeout(&state, &job, Some(now_ms as u64)).await;
                    continue;
                };

                // 预占位（reserve）- 统一使用Phase2 Redis实现
                let new_attempt_id = job.dispatch_attempt_id + 1;
                let reserved = if let Some(rt) = state.redis_runtime.as_ref() {
                    match rt.reserve_node_slot(&new_node_id, &job.job_id, new_attempt_id, reserved_ttl_seconds).await {
                        Ok(true) => true,
                        Ok(false) => false,
                        Err(crate::messages::ErrorCode::SchedulerDependencyDown) => {
                            // Redis 不可用：fail closed，标记任务失败
                            error!(
                                job_id = %job.job_id,
                                node_id = %new_node_id,
                                "Redis 不可用，无法预留节点槽位，任务失败"
                            );
                            state.dispatcher.update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed).await;
                            notify_job_timeout(&state, &job, Some(now_ms as u64)).await;
                            continue;
                        }
                        Err(_) => false,
                    }
                } else {
                    // Phase2未启用：无法进行reservation
                    warn!(
                        job_id = %job.job_id,
                        node_id = %new_node_id,
                        "Phase2未启用，无法进行reservation"
                    );
                    false
                };
                if !reserved {
                    state.dispatcher.update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed).await;
                    if let Some(rt) = state.redis_runtime.as_ref() {
                        let _ = rt
                            .job_fsm_to_finished(&job.job_id, job.dispatch_attempt_id.max(1), false)
                            .await;
                        let _ = rt.job_fsm_to_released(&job.job_id).await;
                    }
                    notify_job_timeout(&state, &job, Some(now_ms as u64)).await;
                    continue;
                }

                // 优化：直接传入 job 对象，避免内部重复查询
                // 更新 job 的当前节点（并递增 dispatch_attempt_id；原子性抢占）
                let Some(actual_new_attempt_id) = state
                    .dispatcher
                    .set_job_assigned_node_for_failover(&job, new_node_id.clone())
                    .await
                else {
                    // 重派失败（Job不存在、已终止、或其他实例已抢占）
                    if let Some(rt) = state.redis_runtime.as_ref() {
                        rt.release_node_slot(&new_node_id, &job.job_id, new_attempt_id).await;
                    }
                    continue;
                };

                // 优化：不再需要重新查询 job，因为 set_job_assigned_node_for_failover 已经返回了 attempt_id
                // 记录派发开始时间（用于计算 dispatch_latency）
                let dispatch_start = std::time::Instant::now();
                // 注意：job 对象可能需要更新 assigned_node_id 和 dispatch_attempt_id
                // 但为了简化，我们先使用现有的 job 对象，Lua 脚本已经更新了 Redis
                if let Some(job_assign_msg) = crate::websocket::create_job_assign_message(&state, &job, None, None, None).await {
                    let ok = crate::redis_runtime::send_node_message_routed(&state, &new_node_id, job_assign_msg).await;
                    if ok {
                        // 记录派发延迟
                        let dispatch_latency = dispatch_start.elapsed().as_secs_f64();
                        crate::metrics::prometheus_metrics::observe_dispatch_latency(dispatch_latency);
                        
                        // 优化：使用本地 job 对象的字段，避免重复查询
                        state.dispatcher.mark_job_dispatched(&job.job_id, Some(&job.request_id), Some(actual_new_attempt_id)).await;
                        info!(
                            trace_id = %job.trace_id,
                            job_id = %job.job_id,
                            old_node_id = %current_node_id,
                            new_node_id = %new_node_id,
                            failover_attempts = job.failover_attempts,
                            dispatch_latency_seconds = dispatch_latency,
                            "Job failover 重派成功下发"
                        );
                    } else {
                        // 发送失败：释放 reserved 并发槽并标记失败（避免泄漏）
                        if let Some(rt) = state.redis_runtime.as_ref() {
                            rt.release_node_slot(&new_node_id, &job.job_id, actual_new_attempt_id).await;
                        }
                        state.dispatcher.update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed).await;
                        notify_job_node_unavailable(&state, &job, Some(now_ms as u64)).await;
                    }
                }
            }
        }
    });
}

async fn notify_job_timeout(state: &AppState, job: &crate::core::dispatcher::Job, now_ms_opt: Option<u64>) {
    let elapsed_ms = now_ms_opt.map(|now_ms| {
        let created_at_ms = job.created_at.timestamp_millis().max(0) as u64;
        now_ms.saturating_sub(created_at_ms)
    });
    let code = ErrorCode::JobTimeout;
    let hint = Some(get_error_hint(&code).to_string());
    let ui_event = SessionMessage::UiEvent {
        trace_id: job.trace_id.clone(),
        session_id: job.session_id.clone(),
        job_id: job.job_id.clone(),
        utterance_index: job.utterance_index,
        event: UiEventType::Error,
        elapsed_ms,
        status: UiEventStatus::Error,
        error_code: Some(code),
        hint,
    };
    let _ = crate::redis_runtime::send_session_message_routed(state, &job.session_id, ui_event).await;
}

async fn notify_job_node_unavailable(state: &AppState, job: &crate::core::dispatcher::Job, now_ms_opt: Option<u64>) {
    let elapsed_ms = now_ms_opt.map(|now_ms| {
        let created_at_ms = job.created_at.timestamp_millis().max(0) as u64;
        now_ms.saturating_sub(created_at_ms)
    });
    let code = ErrorCode::NodeUnavailable;
    let hint = Some(get_error_hint(&code).to_string());
    let ui_event = SessionMessage::UiEvent {
        trace_id: job.trace_id.clone(),
        session_id: job.session_id.clone(),
        job_id: job.job_id.clone(),
        utterance_index: job.utterance_index,
        event: UiEventType::Error,
        elapsed_ms,
        status: UiEventStatus::Error,
        error_code: Some(code),
        hint,
    };
    let _ = crate::redis_runtime::send_session_message_routed(state, &job.session_id, ui_event).await;
}


