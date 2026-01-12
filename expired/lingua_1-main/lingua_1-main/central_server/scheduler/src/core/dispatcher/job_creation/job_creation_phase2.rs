//! Phase 2 任务创建主模块
//! 
//! 此模块协调 Phase 2 任务创建的各个步骤：
//! - 幂等性检查（phase2_idempotency）
//! - 节点选择（phase2_node_selection）
//! - 语义修复服务决定（phase2_semantic_service）
//! - Redis 锁管理（phase2_redis_lock）
//! - Job 构造（job_builder）

use super::super::JobDispatcher;
use super::super::job::Job;
use super::job_builder::build_job_from_binding;
use super::phase2_redis_lock::LockAcquireResult;
use crate::messages::{FeatureFlags, PipelineConfig};
use tracing::info;
use uuid::Uuid;

impl JobDispatcher {
    /// Phase 2: 尝试获取锁并创建新 Job（带锁路径）
    /// 优化：节点选择在 Redis 锁外进行，减少锁持有时间
    /// 根据 v3.1 设计，preferred_pool 应该在 Session 锁内决定，这里接受 preferred_pool 参数
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
        preferred_pool: Option<u16>, // Session 锁内决定的 preferred_pool
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
        info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            job_id = %job_id,
            "Phase2 路径: job_id 已创建，开始节点选择（锁外）"
        );

        // 节点选择逻辑（在锁外执行，50-200ms）
        let assigned_node_id = self
            .select_node_for_phase2(
                preferred_node_id,
                exclude_node_id,
                preferred_pool,
                routing_key,
                src_lang,
                tgt_lang,
                &features,
                &pipeline,
                &trace_id,
                request_id,
                session_id,
            )
            .await;

        // 语义修复服务由节点端自己决定，调度服务器不干预
        // 调度服务器仅根据节点的语义修复能力建立 pool
        let final_pipeline = pipeline.clone();

        // 优化：节点选择已完成（锁外），现在获取 Redis 锁进行快速操作（30-150ms）
        // 加锁路径：避免同 request_id 并发创建/占用
        info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            job_id = %job_id,
            assigned_node_id = ?assigned_node_id,
            "Phase2 路径: 节点选择完成，开始获取 Redis request 锁"
        );

        let lock_result = self
            .acquire_phase2_request_lock(&rt, request_id, &trace_id, session_id)
            .await;

        let lock_owner = match lock_result {
            LockAcquireResult::Success(owner) => owner,
            LockAcquireResult::Timeout => return None,
        };

        // lock 后复查（防止并发创建）
        if let Some(b) = rt.get_request_binding(request_id).await {
            rt.release_request_lock(request_id, &lock_owner).await;
            let existing_job_id = b.job_id.clone();
            if let Some(job) = self.get_job(&existing_job_id).await {
                return Some(job);
            }
            // 如果 Job 不存在，使用已选择的节点继续创建
            let assigned_node_id = b.node_id.clone();
            let job = build_job_from_binding(
                existing_job_id.clone(),
                request_id.to_string(),
                session_id.to_string(),
                utterance_index,
                src_lang.to_string(),
                tgt_lang.to_string(),
                dialect.clone(),
                features.clone(),
                final_pipeline.clone(),
                audio_data.clone(),
                audio_format.clone(),
                sample_rate,
                assigned_node_id.clone(),
                b.dispatched_to_node,
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                trace_id.clone(),
                tenant_id.clone(),
                target_session_ids.clone(),
                first_chunk_client_timestamp_ms,
                None,
                is_manual_cut,
                is_pause_triggered,
                is_timeout_triggered,
            );
            self.jobs.write().await.insert(existing_job_id, job.clone());
            return Some(job);
        }

        // 优化：节点选择已完成（锁外），现在进行快速 Redis 操作（30-150ms）
        // Phase 2：全局并发占用（Redis reserve，按照设计文档实现）
        if let Some(ref node_id) = assigned_node_id {
            info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                job_id = %job_id,
                node_id = %node_id,
                "Phase2 路径: 开始预留节点槽位（Redis reserve）"
            );
            let ttl_s = self.reserved_ttl_seconds.max(1);
            let attempt_id = 1; // 首次创建，attempt_id=1
            let reserve_start = std::time::Instant::now();
            let ok = rt
                .reserve_node_slot(node_id, &job_id, attempt_id, ttl_s)
                .await;
            let reserve_elapsed = reserve_start.elapsed();
            info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                job_id = %job_id,
                node_id = %node_id,
                elapsed_ms = reserve_elapsed.as_millis(),
                "Phase2 路径: 节点槽位预留完成"
            );
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
        )
        .await;

        // 释放 Redis 锁（快速操作完成）
        rt.release_request_lock(request_id, &lock_owner).await;

        // 创建 Job 对象（锁外）
        let job = build_job_from_binding(
            job_id.clone(),
            request_id.to_string(),
            session_id.to_string(),
            utterance_index,
            src_lang.to_string(),
            tgt_lang.to_string(),
            dialect,
            features,
            final_pipeline,
            audio_data,
            audio_format,
            sample_rate,
            assigned_node_id.clone(),
            false, // dispatched_to_node 将在 mark_job_dispatched 时更新
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr,
            partial_update_interval_ms,
            trace_id.clone(),
            tenant_id,
            target_session_ids,
            first_chunk_client_timestamp_ms,
            None, // EDGE-4: Padding 配置（在 Phase2 幂等检查时，padding_ms 尚未确定）
            is_manual_cut,
            is_pause_triggered,
            is_timeout_triggered,
        );

        // 存储 Job（快速操作）
        info!(
            trace_id = %job.trace_id,
            request_id = %request_id,
            session_id = %session_id,
            job_id = %job_id,
            assigned_node_id = ?job.assigned_node_id,
            "Phase2 路径: 开始存储 Job 对象"
        );
        self.jobs.write().await.insert(job_id.clone(), job.clone());
        info!(
            trace_id = %job.trace_id,
            request_id = %request_id,
            session_id = %session_id,
            job_id = %job_id,
            assigned_node_id = ?job.assigned_node_id,
            status = ?job.status,
            "Phase2 路径: Job 对象存储完成，任务创建成功"
        );

        Some(job)
    }
}
