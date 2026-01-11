use super::JobDispatcher;
use super::job::Job;
use crate::messages::{FeatureFlags, PipelineConfig};
use uuid::Uuid;

mod job_creation_phase2;
mod job_creation_phase1;
mod job_creation_node_selection;
mod job_builder;
mod phase2_idempotency;
mod phase2_node_selection;
mod phase2_semantic_service;
pub mod phase2_redis_lock;

impl JobDispatcher {
    /// 【已废弃】旧任务创建实现（使用锁和本地状态）
    /// 已迁移到极简无锁调度服务：MinimalSchedulerService::dispatch_task
    /// 根据 LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md，应该使用 Lua 脚本进行原子操作
    /// 
    /// 新实现应使用 MinimalSchedulerService::dispatch_task（完全无锁，所有状态在 Redis）
    #[allow(dead_code)]
    pub async fn create_job(
        &self,
        session_id: String,
        utterance_index: u64,
        src_lang: String,
        tgt_lang: String,
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
        // Phase 1：任务级幂等 request_id（建议调用方传入稳定值）
        request_id: Option<String>,
        target_session_ids: Option<Vec<String>>, // 目标接收者 session_id 列表（会议室模式使用）
        first_chunk_client_timestamp_ms: Option<i64>, // 第一个音频块的客户端发送时间戳
        padding_ms: Option<u64>, // EDGE-4: Padding 配置（毫秒）
        is_manual_cut: bool, // 是否由用户手动发送
        is_pause_triggered: bool, // 是否由3秒静音触发
        is_timeout_triggered: bool, // 是否由10秒超时触发
    ) -> Job {
        let request_id = request_id.unwrap_or_else(|| format!("req-{}", Uuid::new_v4().to_string()[..12].to_uppercase()));
        let now_ms = chrono::Utc::now().timestamp_millis();
        // Phase 3：routing_key 优先 tenant_id，其次 session_id（保证同租户/同会话稳定落 pool；不影响 request_id 幂等）
        let routing_key = tenant_id
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(session_id.as_str());

        // Phase 2：跨实例幂等（优先使用 Redis request_id bind）
        if self.phase2.is_some() {
            // 先做一次无锁读取（快速路径）
            if let Some(job) = self.check_phase2_idempotency(
                &request_id,
                &session_id,
                utterance_index,
                &src_lang,
                &tgt_lang,
                &dialect,
                &features,
                &pipeline,
                &audio_data,
                &audio_format,
                sample_rate,
                &mode,
                &lang_a,
                &lang_b,
                &auto_langs,
                &enable_streaming_asr,
                &partial_update_interval_ms,
                &trace_id,
                &tenant_id,
                &target_session_ids,
                first_chunk_client_timestamp_ms,
            ).await {
                return job;
            }

            // 根据 v3.0 设计，使用 Session 锁来决定 preferred_pool 和绑定 lang_pair
            // 不再使用全局 last_dispatched_node_by_session
            // spread 策略将在 Session 锁内处理
            
            // 在 Phase 2 路径中也使用 Session 锁来决定 preferred_pool 和 exclude_node_id
            // 根据 v3.1 设计，应该在 Session 锁内决定 preferred_pool
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                "Phase2 路径: 开始获取快照和 Phase3 配置"
            );
            let snapshot_manager_phase2 = self.node_registry.get_or_init_snapshot_manager().await;
            let snapshot_phase2 = snapshot_manager_phase2.get_snapshot().await;
            let snapshot_clone_phase2 = snapshot_phase2.clone();
            let phase3_config_phase2 = self.node_registry.get_phase3_config_cached().await;
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                phase3_enabled = phase3_config_phase2.enabled,
                phase3_mode = %phase3_config_phase2.mode,
                pool_count = phase3_config_phase2.pools.len(),
                node_count = snapshot_clone_phase2.nodes.len(),
                "Phase2 路径: 快照和 Phase3 配置获取完成"
            );
            
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                routing_key = %routing_key,
                "Phase2 路径: 开始决定 preferred_pool（Session 锁内）"
            );
            let preferred_pool_phase2 = self.session_manager.decide_pool_for_session(
                &session_id,
                &src_lang,
                &tgt_lang,
                routing_key,
                &snapshot_clone_phase2,
                &phase3_config_phase2,
            ).await;
            tracing::info!(
                trace_id = %trace_id,
                request_id = %request_id,
                session_id = %session_id,
                preferred_pool = ?preferred_pool_phase2,
                "Phase2 路径: preferred_pool 决定完成"
            );
            
            // spread 策略：如果启用，检查是否有缓存的节点信息（预留，待实现）
            let exclude_node_id_phase2 = if self.spread_enabled {
                None // 暂时为空，后续可以实现
            } else {
                None
            };

            // 加锁路径：尝试获取锁并创建新 Job
            if let Some(job) = self.create_job_with_phase2_lock(
                &request_id,
                &session_id,
                utterance_index,
                &src_lang,
                &tgt_lang,
                dialect.clone(),
                features.clone(),
                pipeline.clone(),
                audio_data.clone(),
                audio_format.clone(),
                sample_rate,
                preferred_node_id.clone(),
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                trace_id.clone(),
                tenant_id.clone(),
                routing_key,
                exclude_node_id_phase2,
                preferred_pool_phase2, // 传递 Session 锁内决定的 preferred_pool
                now_ms,
                target_session_ids.clone(),
                first_chunk_client_timestamp_ms,
                padding_ms,
                is_manual_cut,
                is_pause_triggered,
                is_timeout_triggered,
            ).await {
                return job;
            }
        }

        // Phase 1：本地幂等检查
        if let Some(job) = self.check_phase1_idempotency(&request_id, now_ms).await {
            return job;
        }

        // 创建新 Job（Phase 1 模式）
        let job_id = format!("job-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        tracing::info!(
            trace_id = %trace_id,
            request_id = %request_id,
            session_id = %session_id,
            job_id = %job_id,
            "Phase1 路径: job_id 已创建，开始节点选择和任务创建"
        );

        // 根据 v3.0 设计，调度流程：
        // 1. snapshot = SnapshotManager.snapshot.clone()
        // 2. session_state = SessionManager.get_or_create()
        // 3. session_lock.lock(): 决定 preferred_pool，绑定 lang_pair
        // 4. pool_nodes = phase3_pool_index_snapshot[pool_id]
        // 5. members = PoolMembersCache.get_or_refresh(pool_id)
        // 6. candidates = filter(snapshot.nodes[m])
        // 7. node_id = redis.try_reserve(candidates)
        // 8. jobs.write() 新建 job
        
        // 根据 v3.1 设计，调度流程：
        // 1. snapshot = SnapshotManager.snapshot.clone()  // 获取快照克隆
        // 2. phase3_config = get_phase3_config_cached()   // 获取 Phase3 配置（锁外）
        // 3. session_lock.lock(): decide_pool_for_session() // 在 Session 锁内决定 preferred_pool 和绑定 lang_pair
        // 4. 节点选择（使用 preferred_pool）
        // 5. redis.try_reserve(candidates)
        // 6. jobs.write() 新建 job
        
        // 步骤 1: 获取快照（无锁克隆）
        tracing::info!(
            trace_id = %trace_id,
            session_id = %session_id,
            "任务创建步骤1: 开始获取快照"
        );
        let snapshot_manager = self.node_registry.get_or_init_snapshot_manager().await;
        let snapshot = snapshot_manager.get_snapshot().await;
        let snapshot_clone = snapshot.clone(); // 克隆快照，释放锁
        tracing::debug!(
            trace_id = %trace_id,
            session_id = %session_id,
            node_count = snapshot_clone.nodes.len(),
            "任务创建步骤1: 快照获取完成"
        );
        
        // 步骤 2: 获取 Phase3 配置（锁外，避免在 Session 锁内访问 Management 域）
        tracing::info!(
            trace_id = %trace_id,
            session_id = %session_id,
            "任务创建步骤2: 开始获取 Phase3 配置缓存"
        );
        let phase3_config = self.node_registry.get_phase3_config_cached().await;
        tracing::info!(
            trace_id = %trace_id,
            session_id = %session_id,
            phase3_enabled = phase3_config.enabled,
            phase3_mode = %phase3_config.mode,
            pool_count = phase3_config.pools.len(),
            "任务创建步骤2: Phase3 配置缓存获取完成"
        );
        
        // 步骤 3: Session 锁内决定 preferred_pool 和绑定 lang_pair
        // 根据 v3.1 设计，所有 Session 相关决策都在锁内完成
        tracing::info!(
            trace_id = %trace_id,
            session_id = %session_id,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            routing_key = %routing_key,
            "任务创建步骤3: 开始决定 preferred_pool（Session 锁内）"
        );
        let preferred_pool = self.session_manager.decide_pool_for_session(
            &session_id,
            &src_lang,
            &tgt_lang,
            routing_key,
            &snapshot_clone,
            &phase3_config,
        ).await;
        tracing::info!(
            trace_id = %trace_id,
            session_id = %session_id,
            preferred_pool = ?preferred_pool,
            "任务创建步骤3: preferred_pool 决定完成"
        );
        
        // 【技术规范补充】同步 Session 状态到 Redis（按照 NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md 规范）
        // 在决定 preferred_pool 后，将状态写入 Redis，支持多实例共享
        if let Some(ref rt) = self.phase2 {
            let preferred_pool_clone = preferred_pool;
            let session_id_clone = session_id.to_string();
            let lang_pair_opt = preferred_pool.and_then(|_| Some((src_lang.to_string(), tgt_lang.to_string())));
            let rt_clone = rt.clone();
            tokio::spawn(async move {
                // 后台异步执行，不阻塞任务创建主流程
                rt_clone.set_session_state(
                    &session_id_clone,
                    preferred_pool_clone,
                    lang_pair_opt.as_ref(),
                    3600, // TTL: 1 小时
                ).await;
                // 发布 Session 状态更新事件（Pub/Sub）
                rt_clone.publish_session_update(&session_id_clone, preferred_pool_clone).await;
            });
        }
        
        // spread 策略：如果启用，检查是否有缓存的节点信息（预留，待实现）
        let exclude_node_id = if self.spread_enabled {
            // 这里可以根据 session_state 来决定 exclude_node_id
            // 暂时为空，后续可以实现
            None
        } else {
            None
        };

        // 节点选择（使用 preferred_pool 和 bound_lang_pair）
        tracing::info!(
            trace_id = %trace_id,
            session_id = %session_id,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            preferred_pool = ?preferred_pool,
            preferred_node_id = ?preferred_node_id,
            exclude_node_id = ?exclude_node_id,
            "任务创建步骤4: 开始节点选择"
        );
        let node_selection_start = std::time::Instant::now();
        // 【修复2】传递快照作为参数，避免在 select_node_for_job_creation 中重复获取
        let (assigned_node_id, no_available_node_metric) = self.select_node_for_job_creation(
            routing_key,
            &session_id,
            &src_lang,
            &tgt_lang,
            &features,
            &pipeline,
            preferred_node_id,
            preferred_pool,
            &trace_id,
            &request_id,
            now_ms,
            exclude_node_id,
            &snapshot_clone, // 传递已获取的快照，避免重复获取
        ).await;
        let node_selection_elapsed = node_selection_start.elapsed();
        tracing::info!(
            trace_id = %trace_id,
            session_id = %session_id,
            assigned_node_id = ?assigned_node_id,
            no_available_node_metric = ?no_available_node_metric,
            elapsed_ms = node_selection_elapsed.as_millis(),
            "任务创建步骤4: 节点选择完成"
        );
        
        if assigned_node_id.is_none() {
            tracing::warn!(
                trace_id = %trace_id,
                session_id = %session_id,
                preferred_pool = ?preferred_pool,
                no_available_node_metric = ?no_available_node_metric,
                "节点选择失败：未找到可用节点"
            );
        }

        // 优化：根据调度模式来决定是否使用语义修复服务
        // Phase3 模式：所有节点都支持语义修复服务（因为 Pool 是基于语义修复支持建立的），应该总是启用
        // 非 Phase3 模式：根据节点端能力决定
        // 使用快照克隆（无锁访问）
        let mut final_pipeline = pipeline.clone();
        if let Some(ref node_id) = assigned_node_id {
            // 检查是否是 Phase3 模式（通过检查是否有 lang_index）
            let phase3_enabled = !snapshot_clone.lang_index.is_empty();
            
            if phase3_enabled {
                // Phase3 模式：所有节点都支持语义修复服务，应该总是启用
                final_pipeline.use_semantic = true;
                tracing::debug!(
                    trace_id = %trace_id,
                    node_id = %node_id,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "Phase3 模式：启用语义修复服务（所有 Phase3 节点都支持）"
                );
            } else {
                // 非 Phase3 模式：根据节点端能力决定（使用快照克隆，无锁访问）
                if let Some(node) = snapshot_clone.nodes.get(node_id) {
                    // 检查节点是否支持语义修复服务，且支持当前语言对
                    let semantic_supported = !node.capabilities.semantic_languages.is_empty();
                    if semantic_supported {
                        // 检查是否支持当前语言对（src_lang 和 tgt_lang）
                        let semantic_langs_set: std::collections::HashSet<&str> = 
                            node.capabilities.semantic_languages.iter().map(|s| s.as_str()).collect();
                        if semantic_langs_set.contains(src_lang.as_str()) && semantic_langs_set.contains(tgt_lang.as_str()) {
                            final_pipeline.use_semantic = true;
                            tracing::debug!(
                                trace_id = %trace_id,
                                node_id = %node_id,
                                src_lang = %src_lang,
                                tgt_lang = %tgt_lang,
                                "非 Phase3 模式：根据节点端能力，启用语义修复服务"
                            );
                        } else {
                            final_pipeline.use_semantic = false;
                            tracing::debug!(
                                trace_id = %trace_id,
                                node_id = %node_id,
                                src_lang = %src_lang,
                                tgt_lang = %tgt_lang,
                                "非 Phase3 模式：节点不支持当前语言对的语义修复服务，禁用语义修复服务"
                            );
                        }
                    } else {
                        final_pipeline.use_semantic = false;
                        tracing::debug!(
                            trace_id = %trace_id,
                            node_id = %node_id,
                            "非 Phase3 模式：节点不支持语义修复服务，禁用语义修复服务"
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
        }

        // 创建 Job（Phase 1 模式）
        self.create_job_phase1(
            job_id,
            request_id,
            session_id,
            utterance_index,
            src_lang,
            tgt_lang,
            dialect,
            features,
            final_pipeline,
            audio_data,
            audio_format,
            sample_rate,
            assigned_node_id,
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr,
            partial_update_interval_ms,
            trace_id,
            tenant_id,
            target_session_ids,
            first_chunk_client_timestamp_ms,
            padding_ms,
            is_manual_cut,
            is_pause_triggered,
            is_timeout_triggered,
            no_available_node_metric,
        ).await
    }
}
