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
    /// 优化：节点选择在 Redis 锁外进行，减少锁持有时间
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
        _padding_ms: Option<u64>,
        is_manual_cut: bool,
        is_pause_triggered: bool,
        is_timeout_triggered: bool,
    ) -> Option<Job> {
        let rt = self.phase2.clone()?;
        
        // 优化：先快速检查 request_id 绑定（无锁，避免不必要的锁获取）
        if let Some(b) = rt.get_request_binding(request_id).await {
            let job_id = b.job_id.clone();
            if let Some(job) = self.get_job(&job_id).await {
                return Some(job);
            }
            // 如果 Job 不存在，继续创建流程
        }

        // 优化：节点选择在 Redis 锁外进行（避免在锁内进行耗时操作）
        // 创建新 job_id
        let job_id = format!("job-{}", Uuid::new_v4().to_string()[..8].to_uppercase());

        // 节点选择逻辑（在锁外执行，50-200ms）
        let assigned_node_id = if let Some(node_id) = preferred_node_id {
            if self.node_registry.is_node_available(&node_id).await {
                Some(node_id)
            } else {
                None
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
                first.node_id
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
                second.node_id
            }
        };

        // 优化：节点选择已完成（锁外），现在获取 Redis 锁进行快速操作（30-150ms）
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

        // lock 后复查（防止并发创建）
        if let Some(b) = rt.get_request_binding(request_id).await {
            rt.release_request_lock(request_id, &lock_owner).await;
            let existing_job_id = b.job_id.clone();
            if let Some(job) = self.get_job(&existing_job_id).await {
                return Some(job);
            }
            // 如果 Job 不存在，使用已选择的节点继续创建
            let assigned_node_id = b.node_id.clone();
            let job = Job {
                job_id: existing_job_id.clone(),
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
                padding_ms: None,
                is_manual_cut,
                is_pause_triggered,
                is_timeout_triggered,
            };
            self.jobs.write().await.insert(existing_job_id, job.clone());
            return Some(job);
        }

        // 优化：节点选择已完成（锁外），现在进行快速 Redis 操作（30-150ms）
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
                        "Redis 不可用，拒绝新任务（fail closed）"
                    );
                    rt.release_request_lock(request_id, &lock_owner).await;
                    return None;
                }
                Err(e) => {
                    tracing::error!(
                        job_id = %job_id,
                        node_id = %node_id,
                        error = ?e,
                        "Redis reserve_node_slot 失败"
                    );
                    rt.release_request_lock(request_id, &lock_owner).await;
                    return None;
                }
            };
            if !ok {
                // 节点槽位已被占用，释放锁并返回 None
                rt.release_request_lock(request_id, &lock_owner).await;
                return None;
            }
        }

        // Phase 2：写入 request_id 绑定（快速操作）
        let lease_seconds = self.reserved_ttl_seconds.max(1);
        rt.set_request_binding(
            request_id,
            &job_id,
            assigned_node_id.as_deref(),
            lease_seconds,
            false, // dispatched_to_node 将在 mark_job_dispatched 时更新
        ).await;

        // 释放 Redis 锁（快速操作完成）
        rt.release_request_lock(request_id, &lock_owner).await;

        // 创建 Job 对象（锁外）
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
            trace_id,
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr,
            partial_update_interval_ms,
            target_session_ids,
            tenant_id,
            first_chunk_client_timestamp_ms,
            padding_ms: None, // EDGE-4: Padding 配置（在 Phase2 幂等检查时，padding_ms 尚未确定）
            is_manual_cut,
            is_pause_triggered,
            is_timeout_triggered,
        };

        // 存储 Job（快速操作）
        self.jobs.write().await.insert(job_id, job.clone());

        Some(job)
    }
}
