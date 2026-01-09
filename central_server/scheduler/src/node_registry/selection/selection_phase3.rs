use tracing::debug;

use super::super::NodeRegistry;
use super::selection_breakdown::{NoAvailableNodeBreakdown, Phase3TwoLevelDebug};
use super::pool_selection;

impl NodeRegistry {
    /// Phase 3：两级调度（Two-level）
    /// - Global：按 routing_key 选择 preferred pool（hash 或随机，取决于配置）
    /// - Pool：在该 pool 内选节点；若无可用则按配置 fallback 其他 pool
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
    ) -> (Option<String>, Phase3TwoLevelDebug, NoAvailableNodeBreakdown) {
        let cfg = self.phase3.read().await.clone();

        // Phase3 未启用：回退为单级选节点
        if !cfg.enabled || cfg.mode != "two_level" {
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
        let snapshot_manager = self.snapshot_manager.get_or_init(|| async {
            super::super::snapshot_manager::SnapshotManager::new((*self.management_registry).clone()).await
        }).await;
        let snapshot_guard = snapshot_manager.get_snapshot().await;
        let lang_index = &snapshot_guard.lang_index;
        
        // 选择候选 pools（使用 PoolLanguageIndex）
        let (all_pools, preferred_pool, pools) = match pool_selection::select_eligible_pools(
            &cfg,
            routing_key,
            src_lang,
            tgt_lang,
            required_types,
            core_services,
            lang_index,
        ) {
            Ok(result) => result,
            Err(dbg) => {
                return (None, dbg, NoAvailableNodeBreakdown::default());
            }
        };

        // 预取 Pool 成员（从 Redis 批量读取）
        let pool_candidates = self.prefetch_pool_members(&pools, phase2).await;

        // 性能：预取 pool 核心能力缓存（online/ready + 核心服务 installed/ready），用于快速跳过明显不满足的 pools
        let pool_core_cache = self.phase3_pool_core_cache_snapshot().await;

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

