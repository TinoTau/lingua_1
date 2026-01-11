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
        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            job_id = %job_id,
            "Phase2 路径: job_id 已创建，开始节点选择（锁外）"
        );

        // 节点选择逻辑（在锁外执行，50-200ms）
        let node_selection_start = std::time::Instant::now();
        let assigned_node_id = if let Some(node_id) = preferred_node_id {
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                preferred_node_id = %node_id,
                "Phase2 路径: 使用 preferred_node_id 进行节点选择"
            );
            if self.node_registry.is_node_available(&node_id).await {
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    node_id = %node_id,
                    "Phase2 路径: preferred_node_id 节点可用"
                );
                Some(node_id)
            } else {
                tracing::warn!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    node_id = %node_id,
                    "Phase2 路径: preferred_node_id 节点不可用，fallback 到模块展开选择"
                );
                None
            }
        } else {
            let excluded = exclude_node_id.as_deref();
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                preferred_pool = ?preferred_pool,
                exclude_node_id = ?excluded,
                "Phase2 路径: 使用模块展开算法进行节点选择"
            );
            let first = self
                .select_node_with_module_expansion_with_breakdown(
                    routing_key,
                    src_lang,
                    tgt_lang,
                    features.clone(),
                    &pipeline,
                    true,
                    excluded,
                    preferred_pool, // 传递 Session 锁内决定的 preferred_pool
                )
                .await;
            let first_selection_elapsed = node_selection_start.elapsed();
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                selector = %first.selector,
                node_id = ?first.node_id,
                elapsed_ms = first_selection_elapsed.as_millis(),
                "Phase2 路径: 第一次节点选择完成"
            );
            if first.selector == "phase3" {
                if let Some(ref dbg) = first.phase3_debug {
                    tracing::info!(
                        trace_id = %trace_id,
                        request_id = %request_id,
                        session_id = %session_id,
                        pool_count = dbg.pool_count,
                        preferred_pool = dbg.preferred_pool,
                        selected_pool = ?dbg.selected_pool,
                        fallback_used = dbg.fallback_used,
                        attempts = ?dbg.attempts,
                        "Phase2 路径: Phase3 两级调度详情"
                    );
                    if dbg.fallback_used || dbg.selected_pool.is_none() {
                        tracing::warn!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            session_id = %session_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase2 路径: Phase3 two-level scheduling used fallback or failed"
                        );
                    }
                }
            }
            if first.node_id.is_some() {
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    selected_node_id = %first.node_id.as_ref().unwrap(),
                    "Phase2 路径: 节点选择成功（第一次尝试）"
                );
                first.node_id
            } else {
                tracing::warn!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    breakdown_reason = %first.breakdown.best_reason_label(),
                    "Phase2 路径: 第一次节点选择失败，开始第二次尝试（不排除节点）"
                );
                // 第二次尝试：不避开上一节点，但仍使用 preferred_pool（如果存在）
                let second_start = std::time::Instant::now();
                let second = self
                    .select_node_with_module_expansion_with_breakdown(
                        routing_key,
                        src_lang,
                        tgt_lang,
                        features.clone(),
                        &pipeline,
                        true,
                        None,
                        preferred_pool, // 传递 Session 锁内决定的 preferred_pool
                    )
                    .await;
                let second_elapsed = second_start.elapsed();
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    selector = %second.selector,
                    node_id = ?second.node_id,
                    elapsed_ms = second_elapsed.as_millis(),
                    "Phase2 路径: 第二次节点选择完成"
                );
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
        
        let node_selection_elapsed = node_selection_start.elapsed();
        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            assigned_node_id = ?assigned_node_id,
            elapsed_ms = node_selection_elapsed.as_millis(),
            "Phase2 路径: 节点选择完成（锁外）"
        );

        // 【修复1】优化：根据调度模式来决定是否使用语义修复服务
        // Phase3 模式：所有节点都支持语义修复服务（因为 Pool 是基于语义修复支持建立的），应该总是启用
        // 非 Phase3 模式：根据节点端能力决定
        // 使用 phase3_config.enabled 来判断 Phase3 是否启用，避免获取快照（减少锁竞争）
        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            assigned_node_id = ?assigned_node_id,
            "Phase2 路径: 节点选择完成，开始决定语义修复服务"
        );
        let mut final_pipeline = pipeline.clone();
        if let Some(ref node_id) = assigned_node_id {
            // 【修复1】使用 phase3_config 来判断 Phase3 是否启用，而不是获取快照
            let phase3_config = self.node_registry.get_phase3_config_cached().await;
            let phase3_enabled = phase3_config.enabled && phase3_config.mode == "two_level";
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                node_id = %node_id,
                phase3_enabled = phase3_enabled,
                "Phase2 路径: 使用 phase3_config 判断 Phase3 模式，开始决定语义修复服务"
            );
            
            if phase3_enabled {
                // Phase3 模式：所有节点都支持语义修复服务，应该总是启用
                final_pipeline.use_semantic = true;
                tracing::debug!(
                    trace_id = %trace_id,
                    node_id = %node_id,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "Phase3 模式：启用语义修复服务（所有 Phase3 节点都支持）（Phase2）"
                );
            } else {
                // 非 Phase3 模式：根据节点端能力决定（需要获取快照以检查节点能力）
                // 注意：这里仍然需要获取快照来检查节点的语义修复服务支持情况
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    node_id = %node_id,
                    "Phase2 路径: 非 Phase3 模式，获取 snapshot 检查节点能力"
                );
                let snapshot_start = std::time::Instant::now();
                let snapshot_manager = self.node_registry.get_or_init_snapshot_manager().await;
                let snapshot = snapshot_manager.get_snapshot().await;
                let snapshot_elapsed = snapshot_start.elapsed();
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    node_id = %node_id,
                    elapsed_ms = snapshot_elapsed.as_millis(),
                    "Phase2 路径: snapshot 获取完成，检查节点语义修复服务支持"
                );
                
                if let Some(node) = snapshot.nodes.get(node_id) {
                    // 检查节点是否支持语义修复服务，且支持当前语言对
                    let semantic_supported = !node.capabilities.semantic_languages.is_empty();
                    if semantic_supported {
                        // 检查是否支持当前语言对（src_lang 和 tgt_lang）
                        let semantic_langs_set: std::collections::HashSet<&str> = 
                            node.capabilities.semantic_languages.iter().map(|s| s.as_str()).collect();
                        if semantic_langs_set.contains(src_lang) && semantic_langs_set.contains(tgt_lang) {
                            final_pipeline.use_semantic = true;
                            tracing::debug!(
                                trace_id = %trace_id,
                                node_id = %node_id,
                                src_lang = %src_lang,
                                tgt_lang = %tgt_lang,
                                "非 Phase3 模式：根据节点端能力，启用语义修复服务（Phase2）"
                            );
                        } else {
                            final_pipeline.use_semantic = false;
                            tracing::debug!(
                                trace_id = %trace_id,
                                node_id = %node_id,
                                src_lang = %src_lang,
                                tgt_lang = %tgt_lang,
                                "非 Phase3 模式：节点不支持当前语言对的语义修复服务，禁用语义修复服务（Phase2）"
                            );
                        }
                    } else {
                        final_pipeline.use_semantic = false;
                        tracing::debug!(
                            trace_id = %trace_id,
                            node_id = %node_id,
                            "非 Phase3 模式：节点不支持语义修复服务，禁用语义修复服务（Phase2）"
                        );
                    }
                } else {
                    // 节点不在快照中，保守处理：不使用语义修复服务
                    final_pipeline.use_semantic = false;
                }
            }
        } else {
            // 没有选中节点，保守处理：不使用语义修复服务
            final_pipeline.use_semantic = false;
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                "Phase2 路径: 未选择节点，禁用语义修复服务"
            );
        }
        
        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            assigned_node_id = ?assigned_node_id,
            use_semantic = final_pipeline.use_semantic,
            "Phase2 路径: 语义修复服务决定完成"
        );

        // 优化：节点选择已完成（锁外），现在获取 Redis 锁进行快速操作（30-150ms）
        // 加锁路径：避免同 request_id 并发创建/占用
        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            job_id = %job_id,
            assigned_node_id = ?assigned_node_id,
            "Phase2 路径: 节点选择完成，开始获取 Redis request 锁"
        );
        let lock_owner = format!("{}:{}", rt.instance_id, Uuid::new_v4().to_string());
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(1000);
        let mut locked = false;
        let lock_acquire_start = std::time::Instant::now();
        while tokio::time::Instant::now() < deadline {
            if rt.acquire_request_lock(request_id, &lock_owner, 1500).await {
                locked = true;
                let lock_acquire_elapsed = lock_acquire_start.elapsed();
                tracing::info!(
                    trace_id = %trace_id,
                    request_id = %request_id,
                    session_id = %session_id,
                    elapsed_ms = lock_acquire_elapsed.as_millis(),
                    "Phase2 路径: Redis request 锁获取成功"
                );
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        if !locked {
            let lock_acquire_elapsed = lock_acquire_start.elapsed();
            tracing::warn!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                elapsed_ms = lock_acquire_elapsed.as_millis(),
                "Phase2 路径: Redis request 锁获取超时，返回 None"
            );
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
                pipeline: final_pipeline.clone(),
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
            tracing::info!(
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
            tracing::info!(
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
            pipeline: final_pipeline,
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
        tracing::info!(
            trace_id = %job.trace_id,
            request_id = %request_id,
            session_id = %session_id,
            job_id = %job_id,
            assigned_node_id = ?job.assigned_node_id,
            "Phase2 路径: 开始存储 Job 对象"
        );
        self.jobs.write().await.insert(job_id.clone(), job.clone());
        tracing::info!(
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
