use tracing::debug;

use super::super::NodeRegistry;
use super::selection_breakdown::{NoAvailableNodeBreakdown, Phase3TwoLevelDebug};
use super::pool_selection;

impl NodeRegistry {
    /// Phase 3：两级调度（Two-level）
    /// - Global：按 routing_key 选择 preferred pool（hash 或随机，取决于配置）
    /// - Pool：在该 pool 内选节点；若无可用则按配置 fallback 其他 pool
    ///
    /// 根据 v3.1 设计，preferred_pool 应该在 Session 锁内决定，这里接受 preferred_pool 参数
    /// 如果提供了 preferred_pool，就优先使用它；否则内部决定（向后兼容）
    ///
    /// 返回：
    /// - node_id：最终选择的节点（若无则 None）
    /// - debug：pool 选择过程（便于运维排障）
    /// - breakdown：最终命中的 pool 的 breakdown；若最终未命中，则为 preferred pool 的 breakdown（best-effort）
    pub async fn select_node_with_types_two_level_excluding_with_breakdown(
        &self,
        routing_key: &str,
        src_lang: &str,
        tgt_lang: &str,
        required_types: &[crate::messages::ServiceType],
        accept_public: bool,
        exclude_node_id: Option<&str>,
        core_services: Option<&crate::core::config::CoreServicesConfig>,
        phase2: Option<&crate::phase2::Phase2Runtime>,
        session_preferred_pool: Option<u16>, // Session 锁内决定的 preferred_pool
    ) -> (Option<String>, Phase3TwoLevelDebug, NoAvailableNodeBreakdown) {
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            session_preferred_pool = ?session_preferred_pool,
            routing_key = %routing_key,
            "Phase3 节点选择: 开始获取配置缓存（selection_phase3.rs）"
        );
        let cfg_start = std::time::Instant::now();
        let cfg = self.get_phase3_config_cached().await;
        let cfg_elapsed = cfg_start.elapsed();
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            phase3_enabled = cfg.enabled,
            phase3_mode = %cfg.mode,
            pool_count = cfg.pools.len(),
            elapsed_ms = cfg_elapsed.as_millis(),
            "Phase3 节点选择: 配置缓存获取完成（selection_phase3.rs）"
        );

        // Phase3 未启用：回退为单级选节点
        if !cfg.enabled || cfg.mode != "two_level" {
            tracing::info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                phase3_enabled = cfg.enabled,
                phase3_mode = %cfg.mode,
                "Phase3 未启用或模式不是 two_level，回退为单级选节点（selection_phase3.rs）"
            );
            let (nid, bd) = self
                .select_node_with_types_excluding_with_breakdown(
                    src_lang,
                    tgt_lang,
                    required_types,
                    accept_public,
                    exclude_node_id,
                )
                .await;
            let dbg = Phase3TwoLevelDebug {
                pool_count: cfg.pool_count.max(1),
                preferred_pool: 0,
                selected_pool: None,
                fallback_used: false,
                attempts: vec![],
            };
            return (nid, dbg, bd);
        }

        // 获取语言索引（从快照管理器获取，延迟初始化）
        // 优化：提前克隆 lang_index，避免长时间持有快照读锁
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            session_preferred_pool = ?session_preferred_pool,
            "Phase3 节点选择: 开始获取快照和 lang_index（selection_phase3.rs）"
        );
        let lang_index_start = std::time::Instant::now();
        let lang_index = {
            tracing::info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                "Phase3 节点选择: 开始获取 snapshot_manager（selection_phase3.rs）"
            );
            let snapshot_manager_start = std::time::Instant::now();
            let snapshot_manager = self.snapshot_manager.get_or_init(|| async {
                super::super::snapshot_manager::SnapshotManager::new((*self.management_registry).clone()).await
            }).await;
            let snapshot_manager_elapsed = snapshot_manager_start.elapsed();
            tracing::info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                elapsed_ms = snapshot_manager_elapsed.as_millis(),
                "Phase3 节点选择: snapshot_manager 获取完成，开始获取 snapshot（selection_phase3.rs）"
            );
            let snapshot_start = std::time::Instant::now();
            let snapshot_guard = snapshot_manager.get_snapshot().await;
            let snapshot_elapsed = snapshot_start.elapsed();
            let lang_index_clone = snapshot_guard.lang_index.clone(); // 克隆 Arc，立即释放读锁
            let lang_index_size = lang_index_clone.language_set_count();
            let lang_index_elapsed = lang_index_start.elapsed();
            tracing::info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                lang_index_size = lang_index_size,
                snapshot_version = snapshot_guard.version,
                snapshot_manager_elapsed_ms = snapshot_manager_elapsed.as_millis(),
                snapshot_lock_wait_ms = snapshot_elapsed.as_millis(),
                total_elapsed_ms = lang_index_elapsed.as_millis(),
                "Phase3 节点选择: lang_index 获取完成（selection_phase3.rs）"
            );
            if lang_index_size == 0 {
                tracing::warn!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "Phase3 节点选择: lang_index 为空，可能导致找不到 Pool"
                );
            }
            lang_index_clone
        };
        
        // 根据 v3.1 设计，优先使用 Session 锁内决定的 preferred_pool
        // 如果提供了 session_preferred_pool，就使用它；否则内部决定（向后兼容）
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            session_preferred_pool = ?session_preferred_pool,
            "Phase3 节点选择: 开始选择候选 pools（selection_phase3.rs）"
        );
        let pool_selection_start = std::time::Instant::now();
        let (all_pools, preferred_pool, pools) = if let Some(session_pool) = session_preferred_pool {
            // 使用 Session 锁内决定的 preferred_pool
            // 根据 v3.1 设计，session_preferred_pool 已经在 Session 锁内验证过，这里直接使用
            // 只需要获取所有候选 pools 以支持 fallback
            tracing::info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                session_preferred_pool = session_pool,
                "Phase3 节点选择: 使用 Session preferred_pool，开始验证（selection_phase3.rs）"
            );
            let eligible_pools_start = std::time::Instant::now();
            tracing::info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                session_preferred_pool = session_pool,
                "Phase3 节点选择: 开始调用 select_eligible_pools（selection_phase3.rs）"
            );
            let eligible_pools_result = pool_selection::select_eligible_pools(
                cfg.as_ref(),
                routing_key,
                src_lang,
                tgt_lang,
                required_types,
                core_services,
                &lang_index,
            );
            let eligible_pools_elapsed = eligible_pools_start.elapsed();
            tracing::info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                session_preferred_pool = session_pool,
                elapsed_ms = eligible_pools_elapsed.as_millis(),
                "Phase3 节点选择: select_eligible_pools 完成（selection_phase3.rs）"
            );
            
            match eligible_pools_result {
                Ok((all, _, eligible)) => {
                    // 验证 session_preferred_pool 是否在候选 pools 中（防御性检查）
                    if eligible.contains(&session_pool) {
                        // preferred_pool 有效，优先使用它
                        let mut pools_order = vec![session_pool];
                        // 添加其他候选 pools 作为 fallback（如果启用 fallback_scan_all_pools）
                        if cfg.fallback_scan_all_pools {
                            for pool_id in eligible {
                                if pool_id != session_pool {
                                    pools_order.push(pool_id);
                                }
                            }
                        }
                        tracing::debug!(
                            src_lang = %src_lang,
                            tgt_lang = %tgt_lang,
                            session_preferred_pool = session_pool,
                            pool_count = pools_order.len(),
                            "使用 Session 锁内决定的 preferred_pool"
                        );
                        (all, session_pool, pools_order)
                    } else {
                        // preferred_pool 不在候选 pools 中，回退到内部决定
                        tracing::warn!(
                            src_lang = %src_lang,
                            tgt_lang = %tgt_lang,
                            session_preferred_pool = session_pool,
                            eligible_pools = ?eligible,
                            "Session preferred_pool 不在候选 pools 中，回退到内部决定"
                        );
                        // 使用内部决定的结果
                        (all, eligible[0], eligible)
                    }
                },
                Err(dbg) => {
                    tracing::warn!(
                        src_lang = %src_lang,
                        tgt_lang = %tgt_lang,
                        pool_count = dbg.pool_count,
                        session_preferred_pool = session_pool,
                        "未找到候选 Pools，Session preferred_pool 无效"
                    );
                    return (None, dbg, NoAvailableNodeBreakdown::default());
                }
            }
        } else {
            // 没有提供 session_preferred_pool，内部决定（向后兼容）
            tracing::debug!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                lang_index_empty = lang_index.is_empty(),
                "未提供 Session preferred_pool，内部决定（向后兼容）"
            );
            match pool_selection::select_eligible_pools(
                cfg.as_ref(),
                routing_key,
                src_lang,
                tgt_lang,
                required_types,
                core_services,
                &lang_index,
            ) {
                Ok(result) => {
                    tracing::debug!(
                        src_lang = %src_lang,
                        tgt_lang = %tgt_lang,
                        preferred_pool = result.1,
                        pool_count = result.2.len(),
                        "找到候选 Pools（内部决定）"
                    );
                    result
                },
                Err(dbg) => {
                    tracing::warn!(
                        src_lang = %src_lang,
                        tgt_lang = %tgt_lang,
                        pool_count = dbg.pool_count,
                        "未找到候选 Pools，节点选择失败"
                    );
                    return (None, dbg, NoAvailableNodeBreakdown::default());
                }
            }
        };

        let pool_selection_elapsed = pool_selection_start.elapsed();
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            preferred_pool = preferred_pool,
            pool_count = pools.len(),
            pools = ?pools,
            elapsed_ms = pool_selection_elapsed.as_millis(),
            "Phase3 节点选择: 候选 pools 选择完成（selection_phase3.rs）"
        );

        // 预取 Pool 成员（从 Redis 批量读取）
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            pool_count = pools.len(),
            pools = ?pools,
            preferred_pool = preferred_pool,
            "Phase3 节点选择: 开始预取 Pool 成员（Redis 批量读取）（selection_phase3.rs）"
        );
        let prefetch_start = std::time::Instant::now();
        let pool_candidates = self.prefetch_pool_members(&pools, phase2).await;
        let prefetch_elapsed = prefetch_start.elapsed();
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            pool_count = pool_candidates.len(),
            total_nodes = pool_candidates.values().map(|v| v.len()).sum::<usize>(),
            elapsed_ms = prefetch_elapsed.as_millis(),
            "Phase3 节点选择: Pool 成员预取完成（selection_phase3.rs）"
        );

        // 性能：预取 pool 核心能力缓存（online/ready + 核心服务 installed/ready），用于快速跳过明显不满足的 pools
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            "Phase3 节点选择: 开始预取 pool 核心能力缓存（selection_phase3.rs）"
        );
        let cache_start = std::time::Instant::now();
        let pool_core_cache = self.phase3_pool_core_cache_snapshot().await;
        let cache_elapsed = cache_start.elapsed();
        tracing::info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            cache_size = pool_core_cache.len(),
            elapsed_ms = cache_elapsed.as_millis(),
            "Phase3 节点选择: pool 核心能力缓存预取完成（selection_phase3.rs）"
        );

        let mut preferred_breakdown = NoAvailableNodeBreakdown::default();
        let mut attempts: Vec<(u16, &'static str, usize)> = Vec::new();

        // 仅对核心链路类型做 pool 级快速跳过（低基数）
        let need_asr = required_types.contains(&crate::messages::ServiceType::Asr);
        let need_nmt = required_types.contains(&crate::messages::ServiceType::Nmt);
        let need_tts = required_types.contains(&crate::messages::ServiceType::Tts);

        for (idx, pool_id) in pools.iter().copied().enumerate() {
            let candidate_ids = pool_candidates
                .get(&pool_id)
                .cloned()
                .unwrap_or_default();

            let candidate_ids_len = candidate_ids.len();
            let (best_node_id, breakdown) = self
                .select_node_from_pool(
                    pool_id,
                    candidate_ids,
                    required_types,
                    accept_public,
                    exclude_node_id,
                    phase2,
                    &pool_core_cache,
                    need_asr,
                    need_nmt,
                    need_tts,
                )
                .await;

            let reason = if best_node_id.is_some() {
                "ok"
            } else {
                breakdown.best_reason_label()
            };

            attempts.push((pool_id, reason, candidate_ids_len));
            crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, best_node_id.is_some(), reason);

            if idx == 0 {
                preferred_breakdown = breakdown.clone();
            }

            if let Some(ref node_id) = best_node_id {
                debug!(
                    pool_id = pool_id,
                    node_id = %node_id,
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    required_types = ?required_types,
                    "Phase3 two-level：选择节点（按类型）"
                );
                let dbg = Phase3TwoLevelDebug {
                    pool_count: all_pools.len().max(1) as u16,
                    preferred_pool,
                    selected_pool: Some(pool_id),
                    fallback_used: pool_id != preferred_pool,
                    attempts,
                };
                return (Some(node_id.clone()), dbg, breakdown);
            }
        }

        let dbg = Phase3TwoLevelDebug {
            pool_count: all_pools.len().max(1) as u16,
            preferred_pool,
            selected_pool: None,
            fallback_used: false,
            attempts,
        };
        (None, dbg, preferred_breakdown)
    }
}

