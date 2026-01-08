use super::super::JobDispatcher;
use super::super::job::{Job, JobStatus};
use crate::messages::{FeatureFlags, PipelineConfig};
use uuid::Uuid;

impl JobDispatcher {
    /// Phase 2: 跨实例幂等检查（Redis request_id bind）
    /// 如果找到已存在的绑定，返回对应的 Job；否则返回 None
    pub(crate) async fn check_phase2_idempotency(
        &self,
        request_id: &str,
        session_id: &str,
        utterance_index: u64,
        src_lang: &str,
        tgt_lang: &str,
        dialect: &Option<String>,
        features: &Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        audio_data: &Vec<u8>,
        audio_format: &str,
        sample_rate: u32,
        mode: &Option<String>,
        lang_a: &Option<String>,
        lang_b: &Option<String>,
        auto_langs: &Option<Vec<String>>,
        enable_streaming_asr: &Option<bool>,
        partial_update_interval_ms: &Option<u64>,
        trace_id: &str,
        tenant_id: &Option<String>,
        target_session_ids: &Option<Vec<String>>,
        first_chunk_client_timestamp_ms: Option<i64>,
    ) -> Option<Job> {
        let rt = self.phase2.clone()?;
        
        // 先做一次无锁读取（快速路径）
        if let Some(b) = rt.get_request_binding(request_id).await {
            let job_id = b.job_id.clone();
            if let Some(job) = self.get_job(&job_id).await {
                return Some(job);
            }
            let assigned_node_id = b.node_id.clone();
            let job = Job {
                job_id: job_id.clone(),
                request_id: request_id.to_string(),
                dispatched_to_node: b.dispatched_to_node,
                dispatched_at_ms: None,
                failover_attempts: 0,
                dispatch_attempt_id: if assigned_node_id.is_some() { 1 } else { 0 },
                session_id: session_id.to_string(),
                utterance_index,
                src_lang: src_lang.to_string(),
                tgt_lang: tgt_lang.to_string(),
                dialect: dialect.clone(),
                features: features.clone(),
                pipeline: pipeline.clone(),
                audio_data: audio_data.clone(),
                audio_format: audio_format.to_string(),
                sample_rate,
                assigned_node_id: assigned_node_id.clone(),
                status: if assigned_node_id.is_some() { JobStatus::Assigned } else { JobStatus::Pending },
                created_at: chrono::Utc::now(),
                trace_id: trace_id.to_string(),
                mode: mode.clone(),
                lang_a: lang_a.clone(),
                lang_b: lang_b.clone(),
                auto_langs: auto_langs.clone(),
                enable_streaming_asr: *enable_streaming_asr,
                partial_update_interval_ms: *partial_update_interval_ms,
                target_session_ids: target_session_ids.clone(),
                tenant_id: tenant_id.clone(),
                first_chunk_client_timestamp_ms,
                padding_ms: None, // EDGE-4: Padding 配置（在 Phase2 幂等检查时，padding_ms 尚未确定）
                is_manual_cut: false,
                is_pause_triggered: false,
                is_timeout_triggered: false,
            };
            self.jobs.write().await.insert(job_id, job.clone());
            return Some(job);
        }
        
        None
    }

    /// Phase 2: 尝试获取锁并创建新 Job（带锁路径）
    pub(crate) async fn create_job_with_phase2_lock(
        &self,
        request_id: &str,
        session_id: &str,
        utterance_index: u64,
        src_lang: &str,
        tgt_lang: &str,
        dialect: Option<String>,
        features: Option<FeatureFlags>,
        pipeline: PipelineConfig,
        audio_data: Vec<u8>,
        audio_format: String,
        sample_rate: u32,
        preferred_node_id: Option<String>,
        mode: Option<String>,
        lang_a: Option<String>,
        lang_b: Option<String>,
        auto_langs: Option<Vec<String>>,
        enable_streaming_asr: Option<bool>,
        partial_update_interval_ms: Option<u64>,
        trace_id: String,
        tenant_id: Option<String>,
        routing_key: &str,
        exclude_node_id: Option<String>,
        _now_ms: i64,
        target_session_ids: Option<Vec<String>>,
        first_chunk_client_timestamp_ms: Option<i64>,
        padding_ms: Option<u64>,
        is_manual_cut: bool,
        is_pause_triggered: bool,
        is_timeout_triggered: bool,
    ) -> Option<Job> {
        let rt = self.phase2.clone()?;
        
        // 加锁路径：避免同 request_id 并发创建/占用
        let lock_owner = format!("{}:{}", rt.instance_id, Uuid::new_v4().to_string());
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(1000);
        let mut locked = false;
        while tokio::time::Instant::now() < deadline {
            if rt.acquire_request_lock(request_id, &lock_owner, 1500).await {
                locked = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        if !locked {
            return None;
        }

        // lock 后复查
        if let Some(b) = rt.get_request_binding(request_id).await {
            rt.release_request_lock(request_id, &lock_owner).await;
            let job_id = b.job_id.clone();
            if let Some(job) = self.get_job(&job_id).await {
                return Some(job);
            }
            let assigned_node_id = b.node_id.clone();
            let job = Job {
                job_id: job_id.clone(),
                request_id: request_id.to_string(),
                dispatched_to_node: b.dispatched_to_node,
                dispatched_at_ms: None,
                failover_attempts: 0,
                dispatch_attempt_id: if assigned_node_id.is_some() { 1 } else { 0 },
                session_id: session_id.to_string(),
                utterance_index,
                src_lang: src_lang.to_string(),
                tgt_lang: tgt_lang.to_string(),
                dialect: dialect.clone(),
                features: features.clone(),
                pipeline: pipeline.clone(),
                audio_data: audio_data.clone(),
                audio_format: audio_format.clone(),
                sample_rate,
                assigned_node_id: assigned_node_id.clone(),
                status: if assigned_node_id.is_some() { JobStatus::Assigned } else { JobStatus::Pending },
                created_at: chrono::Utc::now(),
                trace_id: trace_id.clone(),
                mode: mode.clone(),
                lang_a: lang_a.clone(),
                lang_b: lang_b.clone(),
                auto_langs: auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                target_session_ids: target_session_ids.clone(),
                tenant_id: tenant_id.clone(),
                first_chunk_client_timestamp_ms,
                padding_ms: None, // EDGE-4: Padding 配置（在 Phase2 幂等检查时，padding_ms 尚未确定）
                is_manual_cut,
                is_pause_triggered,
                is_timeout_triggered,
            };
            self.jobs.write().await.insert(job_id, job.clone());
            return Some(job);
        }

        // 还没有绑定：创建新 job_id，并走"本地选节点 -> Redis reserve -> 写 bind"
        let job_id = format!("job-{}", Uuid::new_v4().to_string()[..8].to_uppercase());

        // 节点选择逻辑（由调用方传入）
        let (mut assigned_node_id, mut no_available_node_metric) = if let Some(node_id) = preferred_node_id {
            if self.node_registry.is_node_available(&node_id).await {
                (Some(node_id), None)
            } else {
                (None, None)
            }
        } else {
            let excluded = exclude_node_id.as_deref();
            let first = self
                .select_node_with_module_expansion_with_breakdown(
                    routing_key,
                    src_lang,
                    tgt_lang,
                    features.clone(),
                    &pipeline,
                    true,
                    excluded,
                )
                .await;
            if first.selector == "phase3" {
                if let Some(ref dbg) = first.phase3_debug {
                    if dbg.fallback_used || dbg.selected_pool.is_none() {
                        tracing::warn!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling used fallback or failed"
                        );
                    } else {
                        tracing::debug!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling decision"
                        );
                    }
                }
            }
            if first.node_id.is_some() {
                (first.node_id, None)
            } else {
                let second = self
                    .select_node_with_module_expansion_with_breakdown(
                        routing_key,
                        src_lang,
                        tgt_lang,
                        features.clone(),
                        &pipeline,
                        true,
                        None,
                    )
                    .await;
                if second.selector == "phase3" {
                    if let Some(ref dbg) = second.phase3_debug {
                        tracing::warn!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling second attempt"
                        );
                    }
                }
                let metric = if second.node_id.is_none() {
                    Some((second.selector, second.breakdown.best_reason_label()))
                } else {
                    None
                };
                (second.node_id, metric)
            }
        };

        // Phase 2：全局并发占用（Redis reserve，按照设计文档实现）
        if let Some(ref node_id) = assigned_node_id {
            let ttl_s = self.reserved_ttl_seconds.max(1);
            let attempt_id = 1; // 首次创建，attempt_id=1
            let ok = rt
                .reserve_node_slot(node_id, &job_id, attempt_id, ttl_s)
                .await;
            let ok = match ok {
                Ok(true) => true,
                Ok(false) => false,
                Err(crate::messages::ErrorCode::SchedulerDependencyDown) => {
                    // Redis 不可用：fail closed，拒绝新任务
                    tracing::error!(
                        job_id = %job_id,
                        node_id = %node_id,
                        "Redis 不可用，无法预留节点槽位，拒绝任务"
                    );
                    return None; // 返回 None 表示创建失败
                }
                Err(_) => false, // 其他错误，按失败处理
            };
            if !ok {
                assigned_node_id = None;
                no_available_node_metric = Some(("reserve", "reserve_denied"));
            }
        }

        // 写入 request_id bind（即使未分配到节点，也写入以避免短时间重复创建）
        rt.set_request_binding(
            request_id,
            &job_id,
            assigned_node_id.as_deref(),
            self.lease_seconds.max(1),
            false,
        )
        .await;

        // Phase 2：初始化 Job FSM（CREATED）
        let fsm_ttl = std::cmp::max(self.lease_seconds, self.reserved_ttl_seconds).saturating_add(300);
        rt.job_fsm_init(&job_id, assigned_node_id.as_deref(), 1, fsm_ttl).await;
        rt.release_request_lock(request_id, &lock_owner).await;

        if assigned_node_id.is_none() {
            if let Some((selector, reason)) = no_available_node_metric {
                crate::metrics::prometheus_metrics::on_no_available_node(selector, reason);
            } else {
                crate::metrics::prometheus_metrics::on_no_available_node("unknown", "unknown");
            }
        }

        let job = Job {
            job_id: job_id.clone(),
            request_id: request_id.to_string(),
            dispatched_to_node: false,
            dispatched_at_ms: None,
            failover_attempts: 0,
            dispatch_attempt_id: if assigned_node_id.is_some() { 1 } else { 0 },
            session_id: session_id.to_string(),
            utterance_index,
            src_lang: src_lang.to_string(),
            tgt_lang: tgt_lang.to_string(),
            dialect,
            features,
            pipeline,
            audio_data,
            audio_format,
            sample_rate,
            assigned_node_id: assigned_node_id.clone(),
            status: if assigned_node_id.is_some() { JobStatus::Assigned } else { JobStatus::Pending },
            created_at: chrono::Utc::now(),
            trace_id: trace_id.clone(),
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr,
            partial_update_interval_ms,
            target_session_ids,
            tenant_id: tenant_id.clone(),
            first_chunk_client_timestamp_ms,
            padding_ms,
            is_manual_cut,
            is_pause_triggered,
            is_timeout_triggered,
        };
        self.jobs.write().await.insert(job_id, job.clone());
        Some(job)
    }
}

