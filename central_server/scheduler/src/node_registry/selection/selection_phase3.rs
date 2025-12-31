use super::super::{DispatchExcludeReason, NodeRegistry};
use super::selection_breakdown::{NoAvailableNodeBreakdown, Phase3TwoLevelDebug};
use crate::messages::NodeStatus;
use crate::node_registry::validation::{
    is_node_resource_available, node_has_installed_types, node_has_required_types_ready,
};
use std::str::FromStr;
use std::time::Instant;
use tracing::debug;

impl NodeRegistry {
    /// Phase 3：两级调度（Two-level）
    /// - Global：按 routing_key 选择 preferred pool（hash）
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
    ) -> (Option<String>, Phase3TwoLevelDebug, NoAvailableNodeBreakdown) {
        let cfg = self.phase3.read().await.clone();
        let using_capability_pools = !cfg.pools.is_empty();

        fn canonicalize_set<T: Ord + std::fmt::Debug + Clone>(mut v: Vec<T>) -> Vec<T> {
            v.sort();
            v.dedup();
            v
        }

        // 选择"候选 pools"（按类型）
        // - 兼容模式：cfg.pools 为空 -> 继续用 hash 分桶（0..pool_count）
        // - 强隔离：cfg.pools 非空 -> pool_id 来自配置（按能力分配节点）
        let (all_pools, preferred_pool, pools) = if cfg.enabled && cfg.mode == "two_level" {
            if using_capability_pools {
                // pool 资格过滤（core_only / all_required）
                let required_for_pool: Vec<crate::messages::ServiceType> = match cfg.pool_match_scope.as_str() {
                    "all_required" => required_types.to_vec(),
                    _ => {
                        // core_only（默认）：仅对核心链路服务做 pool 级过滤
                        let mut out: Vec<crate::messages::ServiceType> = Vec::new();
                        if let Some(_core) = core_services {
                            if required_types.iter().any(|x| *x == crate::messages::ServiceType::Asr) {
                                out.push(crate::messages::ServiceType::Asr);
                            }
                            if required_types.iter().any(|x| *x == crate::messages::ServiceType::Nmt) {
                                out.push(crate::messages::ServiceType::Nmt);
                            }
                            if required_types.iter().any(|x| *x == crate::messages::ServiceType::Tts) {
                                out.push(crate::messages::ServiceType::Tts);
                            }
                        }
                        out
                    }
                };

                let match_mode = cfg.pool_match_mode.as_str();
                let required_for_pool_set = canonicalize_set(required_for_pool.clone());

                let all_pool_ids: Vec<u16> = cfg.pools.iter().map(|p| p.pool_id).collect();
                let mut eligible: Vec<u16> = Vec::new();
                for p in cfg.pools.iter() {
                    if required_for_pool.is_empty() {
                        eligible.push(p.pool_id);
                        continue;
                    }
                    if p.required_services.is_empty() {
                        // 空 required_services 表示"通配 pool"
                        eligible.push(p.pool_id);
                        continue;
                    }
                    let ok = if match_mode == "exact" {
                        // 精确匹配：按集合相等（忽略顺序、去重）
                        let pool_types: Vec<crate::messages::ServiceType> = p
                            .required_services
                            .iter()
                            .filter_map(|x| crate::messages::ServiceType::from_str(x).ok())
                            .collect();
                        canonicalize_set(pool_types) == required_for_pool_set
                    } else {
                        // contains（默认）：包含匹配
                        required_for_pool.iter().all(|rid| {
                            p.required_services
                            .iter()
                                .filter_map(|x| crate::messages::ServiceType::from_str(x).ok())
                                .any(|x| x == *rid)
                        })
                    };
                    if ok {
                        eligible.push(p.pool_id);
                    }
                }

                let eligible = if eligible.is_empty() {
                    if cfg.strict_pool_eligibility {
                        // 强隔离：没有 eligible pools 直接失败
                        let dbg = Phase3TwoLevelDebug {
                            pool_count: all_pool_ids.len().max(1) as u16,
                            preferred_pool: 0,
                            selected_pool: None,
                            fallback_used: false,
                            attempts: vec![],
                        };
                        return (None, dbg, NoAvailableNodeBreakdown::default());
                    }
                    // 兼容：回退为"遍历所有配置 pools"
                    all_pool_ids
                } else {
                    eligible
                };

                // tenant override（当 routing_key=tenant_id 时生效）
                let mut preferred_idx: usize = 0;
                let mut preferred_pool: u16 = eligible[0];
                if let Some(ov) = cfg
                    .tenant_overrides
                    .iter()
                    .find(|x| x.tenant_id == routing_key)
                {
                    if let Some(pos) = eligible.iter().position(|pid| *pid == ov.pool_id) {
                        preferred_idx = pos;
                        preferred_pool = ov.pool_id;
                    }
                } else {
                    preferred_idx = crate::phase3::pick_index_for_key(eligible.len(), cfg.hash_seed, routing_key);
                    preferred_pool = eligible[preferred_idx];
                }

                let order = if cfg.fallback_scan_all_pools {
                    crate::phase3::ring_order_ids(&eligible, preferred_idx)
                } else {
                    vec![preferred_pool]
                };
                (eligible, preferred_pool, order)
            } else {
                // hash 分桶：pool_id ∈ [0, pool_count)
                let pool_count = cfg.pool_count.max(1);
                let preferred = crate::phase3::pool_id_for_key(pool_count, cfg.hash_seed, routing_key);
                let order = if cfg.fallback_scan_all_pools {
                    crate::phase3::pool_probe_order(pool_count, preferred)
                } else {
                    vec![preferred]
                };
                let all: Vec<u16> = (0..pool_count).collect();
                (all, preferred, order)
            }
        } else {
            // Phase3 未启用：回退为单级选节点
            // 注意：这里调用的是 selection_types 模块中的方法
            // 由于所有方法都在同一个 impl NodeRegistry 中，可以直接调用
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
        };

        let reserved_counts = self.reserved_counts_snapshot().await;

        // 性能：预取 pool -> node_ids，避免在 pool_loop 内反复读 phase3_pool_index（降低锁竞争）
        let t0 = Instant::now();
        let idx = self.phase3_pool_index.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_pool_index.read", t0.elapsed().as_millis() as u64);
        let mut pool_candidates: std::collections::HashMap<u16, Vec<String>> =
            std::collections::HashMap::with_capacity(pools.len());
        for pid in pools.iter().copied() {
            let v = idx
                .get(&pid)
                .map(|s| s.iter().cloned().collect())
                .unwrap_or_default();
            pool_candidates.insert(pid, v);
        }
        drop(idx);

        // 性能：预取 pool 核心能力缓存（online/ready + 核心服务 installed/ready），用于快速跳过明显不满足的 pools
        let pool_core_cache = self.phase3_pool_core_cache_snapshot().await;

        let t0 = Instant::now();
        let nodes = self.nodes.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

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
            let mut breakdown = NoAvailableNodeBreakdown::default();
            let mut best: Option<&crate::node_registry::Node> = None;

            // 快速跳过（只依赖 pool 缓存 + pool_index 大小，不做逐节点遍历）
            // 目标：降低 fallback_scan_all_pools 下的 CPU/锁竞争，同时保持可解释的 reason
            if !candidate_ids.is_empty() {
                if let Some(pc) = pool_core_cache.get(&pool_id) {
                    if pc.online_nodes == 0 {
                        breakdown.total_nodes = candidate_ids.len();
                        breakdown.offline = candidate_ids.len();
                        let reason = "offline";
                        attempts.push((pool_id, reason, candidate_ids.len()));
                        crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, false, reason);
                        if idx == 0 {
                            preferred_breakdown = breakdown.clone();
                        }
                        continue;
                    }
                    if pc.ready_nodes == 0 {
                        breakdown.total_nodes = candidate_ids.len();
                        breakdown.status_not_ready = candidate_ids.len();
                        let reason = "status_not_ready";
                        attempts.push((pool_id, reason, candidate_ids.len()));
                        crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, false, reason);
                        if idx == 0 {
                            preferred_breakdown = breakdown.clone();
                        }
                        continue;
                    }

                    // 核心能力缺口（ASR/NMT/TTS）快速判断
                    if need_asr && pc.asr_ready == 0 {
                            breakdown.total_nodes = candidate_ids.len();
                            breakdown.model_not_available = candidate_ids.len();
                            let reason = "missing_core_asr_not_ready";
                            attempts.push((pool_id, reason, candidate_ids.len()));
                            crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, false, reason);
                            if idx == 0 {
                                preferred_breakdown = breakdown.clone();
                            }
                            continue;
                        }
                    if need_nmt && pc.nmt_ready == 0 {
                            breakdown.total_nodes = candidate_ids.len();
                            breakdown.model_not_available = candidate_ids.len();
                            let reason = "missing_core_nmt_not_ready";
                            attempts.push((pool_id, reason, candidate_ids.len()));
                            crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, false, reason);
                            if idx == 0 {
                                preferred_breakdown = breakdown.clone();
                            }
                            continue;
                        }
                    if need_tts && pc.tts_ready == 0 {
                            breakdown.total_nodes = candidate_ids.len();
                            breakdown.model_not_available = candidate_ids.len();
                            let reason = "missing_core_tts_not_ready";
                            attempts.push((pool_id, reason, candidate_ids.len()));
                            crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, false, reason);
                            if idx == 0 {
                                preferred_breakdown = breakdown.clone();
                            }
                            continue;
                    }
                }
            }

            for nid in candidate_ids.iter() {
                if let Some(ex) = exclude_node_id {
                    if ex == nid {
                        continue;
                    }
                }
                let Some(node) = nodes.get(nid) else { continue };
                breakdown.total_nodes += 1;

                if node.status != NodeStatus::Ready {
                    breakdown.status_not_ready += 1;
                    self.record_exclude_reason(DispatchExcludeReason::StatusNotReady, node.node_id.clone()).await;
                    continue;
                }

                if !node.online {
                    breakdown.offline += 1;
                    continue;
                }

                if !(accept_public || !node.accept_public_jobs) {
                    breakdown.not_in_public_pool += 1;
                    self.record_exclude_reason(DispatchExcludeReason::NotInPublicPool, node.node_id.clone()).await;
                    continue;
                }

                if node.hardware.gpus.is_none() || node.hardware.gpus.as_ref().unwrap().is_empty() {
                    breakdown.gpu_unavailable += 1;
                    self.record_exclude_reason(DispatchExcludeReason::GpuUnavailable, node.node_id.clone()).await;
                    continue;
                }

                if !node_has_installed_types(node, required_types) {
                    breakdown.model_not_available += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                    continue;
                }

                if !node_has_required_types_ready(node, required_types) {
                    breakdown.model_not_available += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                    continue;
                }

                let reserved = reserved_counts.get(&node.node_id).copied().unwrap_or(0);
                let effective_jobs = std::cmp::max(node.current_jobs, reserved);
                if effective_jobs >= node.max_concurrent_jobs {
                    breakdown.capacity_exceeded += 1;
                    self.record_exclude_reason(DispatchExcludeReason::CapacityExceeded, node.node_id.clone()).await;
                    continue;
                }

                if !is_node_resource_available(node, self.resource_threshold) {
                    breakdown.resource_threshold_exceeded += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ResourceThresholdExceeded, node.node_id.clone()).await;
                    continue;
                }

                // candidate
                match best {
                    None => best = Some(node),
                    Some(cur) => {
                        let cur_reserved = reserved_counts.get(&cur.node_id).copied().unwrap_or(0);
                        let cur_eff = std::cmp::max(cur.current_jobs, cur_reserved);
                        if effective_jobs < cur_eff {
                            best = Some(node);
                        }
                    }
                }

                // 早停：effective_jobs 不可能 < 0，已达到最优
                if effective_jobs == 0 {
                    break;
                }
            }

            let reason = if best.is_some() { "ok" } else { breakdown.best_reason_label() };

            attempts.push((pool_id, reason, candidate_ids.len()));
            crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, best.is_some(), reason);

            if idx == 0 {
                preferred_breakdown = breakdown.clone();
            }

            if let Some(best_node) = best {
                debug!(
                    pool_id = pool_id,
                    node_id = %best_node.node_id,
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
                return (Some(best_node.node_id.clone()), dbg, breakdown);
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

