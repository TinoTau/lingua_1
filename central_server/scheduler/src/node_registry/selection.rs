use super::{DispatchExcludeReason, NodeRegistry};
use crate::messages::{FeatureFlags, NodeStatus};
use serde::Serialize;
use std::time::Instant;
use tracing::debug;

use super::validation::{
    is_node_resource_available, node_has_installed_services, node_has_required_services_ready,
    node_supports_features,
};

#[derive(Debug, Default, Clone, Serialize)]
pub struct NoAvailableNodeBreakdown {
    pub total_nodes: usize,
    pub offline: usize,
    pub status_not_ready: usize,
    pub not_in_public_pool: usize,
    pub gpu_unavailable: usize,
    pub model_not_available: usize,
    pub capacity_exceeded: usize,
    pub resource_threshold_exceeded: usize,
}

impl NoAvailableNodeBreakdown {
    pub fn best_reason_label(&self) -> &'static str {
        if self.total_nodes == 0 {
            return "no_nodes";
        }
        let mut best = ("unknown", 0usize);
        let candidates = [
            ("offline", self.offline),
            ("status_not_ready", self.status_not_ready),
            ("not_in_public_pool", self.not_in_public_pool),
            ("gpu_unavailable", self.gpu_unavailable),
            ("model_not_available", self.model_not_available),
            ("capacity_exceeded", self.capacity_exceeded),
            ("resource_threshold_exceeded", self.resource_threshold_exceeded),
        ];
        for (label, v) in candidates {
            if v > best.1 {
                best = (label, v);
            }
        }
        best.0
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Phase3TwoLevelDebug {
    pub pool_count: u16,
    pub preferred_pool: u16,
    pub selected_pool: Option<u16>,
    pub fallback_used: bool,
    /// (pool_id, best_reason_label, total_candidates)
    pub attempts: Vec<(u16, &'static str, usize)>,
}

impl NodeRegistry {
    #[allow(dead_code)]
    pub async fn select_random_node(&self, src_lang: &str, tgt_lang: &str) -> Option<String> {
        self.select_node_with_features(src_lang, tgt_lang, &None, true).await
    }

    pub async fn select_node_with_features(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_features: &Option<FeatureFlags>,
        accept_public: bool,
    ) -> Option<String> {
        self.select_node_with_features_excluding(src_lang, tgt_lang, required_features, accept_public, None).await
    }

    pub async fn select_node_with_features_excluding(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_features: &Option<FeatureFlags>,
        accept_public: bool,
        exclude_node_id: Option<&str>,
    ) -> Option<String> {
        let (selected, _bd) = self
            .select_node_with_features_excluding_with_breakdown(
                src_lang,
                tgt_lang,
                required_features,
                accept_public,
                exclude_node_id,
            )
            .await;
        selected
    }

    pub async fn select_node_with_features_excluding_with_breakdown(
        &self,
        _src_lang: &str,
        _tgt_lang: &str,
        required_features: &Option<FeatureFlags>,
        accept_public: bool,
        exclude_node_id: Option<&str>,
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        let path_t0 = Instant::now();
        let reserved_counts = self.reserved_counts_snapshot().await;
        let t0 = Instant::now();
        let nodes = self.nodes.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

        let mut breakdown = NoAvailableNodeBreakdown::default();
        let mut available_nodes: Vec<&super::Node> = Vec::new();

        for node in nodes.values() {
            if let Some(ex) = exclude_node_id {
                if ex == node.node_id {
                    continue;
                }
            }
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

            // Phase 1：capability_state 统一为 service_id，select_node_with_features 不再基于 installed_models(kind/lang) 做过滤。
            // 需要严格按 service_id 过滤的路径，请使用 select_node_with_models*（由 dispatcher 传入 required service_id 列表）。

            if !node_supports_features(node, required_features) {
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

            available_nodes.push(node);
        }

        if available_nodes.is_empty() {
            return (None, breakdown);
        }

        available_nodes.sort_by_key(|node| {
            let reserved = reserved_counts.get(&node.node_id).copied().unwrap_or(0);
            std::cmp::max(node.current_jobs, reserved)
        });
        let selected = Some(available_nodes[0].node_id.clone());
        crate::metrics::observability::record_path_latency(
            "node_registry.select_node_with_features",
            path_t0.elapsed().as_millis() as u64,
        );
        (selected, breakdown)
    }

    pub async fn select_node_with_models_excluding_with_breakdown(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_model_ids: &[String],
        accept_public: bool,
        exclude_node_id: Option<&str>,
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        let path_t0 = Instant::now();
        let reserved_counts = self.reserved_counts_snapshot().await;
        let t0 = Instant::now();
        let nodes = self.nodes.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

        let mut breakdown = NoAvailableNodeBreakdown::default();
        let mut available_nodes: Vec<&super::Node> = Vec::new();

        for node in nodes.values() {
            if let Some(ex) = exclude_node_id {
                if ex == node.node_id {
                    continue;
                }
            }
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

            if !node_has_installed_services(node, required_model_ids) {
                breakdown.model_not_available += 1;
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                continue;
            }

            // Phase 1：快速纠偏。若节点近期对所需服务包上报过 MODEL_NOT_AVAILABLE，则临时跳过该节点
            if self
                .has_unavailable_required_services(&node.node_id, required_model_ids)
                .await
            {
                breakdown.model_not_available += 1;
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                continue;
            }

            if !node_has_required_services_ready(node, required_model_ids) {
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

            available_nodes.push(node);
        }

        if available_nodes.is_empty() {
            return (None, breakdown);
        }

        available_nodes.sort_by_key(|node| {
            let reserved = reserved_counts.get(&node.node_id).copied().unwrap_or(0);
            std::cmp::max(node.current_jobs, reserved)
        });
        let selected_node_id = available_nodes[0].node_id.clone();

        debug!(
            node_id = %selected_node_id,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            required_models = ?required_model_ids,
            candidate_count = available_nodes.len(),
            "调度过滤：选择节点"
        );

        crate::metrics::observability::record_path_latency(
            "node_registry.select_node_with_models",
            path_t0.elapsed().as_millis() as u64,
        );
        (Some(selected_node_id), breakdown)
    }

    /// Phase 3：两级调度（Two-level）
    /// - Global：按 routing_key 选择 preferred pool（hash）
    /// - Pool：在该 pool 内选节点；若无可用则按配置 fallback 其他 pool
    ///
    /// 返回：
    /// - node_id：最终选择的节点（若无则 None）
    /// - debug：pool 选择过程（便于运维排障）
    /// - breakdown：最终命中的 pool 的 breakdown；若最终未命中，则为 preferred pool 的 breakdown（best-effort）
    pub async fn select_node_with_models_two_level_excluding_with_breakdown(
        &self,
        routing_key: &str,
        src_lang: &str,
        tgt_lang: &str,
        required_model_ids: &[String],
        accept_public: bool,
        exclude_node_id: Option<&str>,
        core_services: Option<&crate::core::config::CoreServicesConfig>,
    ) -> (Option<String>, Phase3TwoLevelDebug, NoAvailableNodeBreakdown) {
        let cfg = self.phase3.read().await.clone();
        let using_capability_pools = !cfg.pools.is_empty();

        fn canonicalize_set(mut v: Vec<String>) -> Vec<String> {
            v.sort();
            v.dedup();
            v
        }

        // 选择“候选 pools”
        // - 兼容模式：cfg.pools 为空 -> 继续用 hash 分桶（0..pool_count）
        // - 强隔离：cfg.pools 非空 -> pool_id 来自配置（按能力分配节点）
        let (all_pools, preferred_pool, pools) = if cfg.enabled && cfg.mode == "two_level" {
            if using_capability_pools {
                // pool 资格过滤（core_only / all_required）
                let required_for_pool: Vec<String> = match cfg.pool_match_scope.as_str() {
                    "all_required" => required_model_ids.to_vec(),
                    _ => {
                        // core_only（默认）：仅对核心链路服务做 pool 级过滤
                        let mut out: Vec<String> = Vec::new();
                        if let Some(core) = core_services {
                            let asr = core.asr_service_id.as_str();
                            let nmt = core.nmt_service_id.as_str();
                            let tts = core.tts_service_id.as_str();
                            if !asr.is_empty() && required_model_ids.iter().any(|x| x == asr) {
                                out.push(asr.to_string());
                            }
                            if !nmt.is_empty() && required_model_ids.iter().any(|x| x == nmt) {
                                out.push(nmt.to_string());
                            }
                            if !tts.is_empty() && required_model_ids.iter().any(|x| x == tts) {
                                out.push(tts.to_string());
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
                        // 空 required_services 表示“通配 pool”
                        eligible.push(p.pool_id);
                        continue;
                    }
                    let ok = if match_mode == "exact" {
                        // 精确匹配：按集合相等（忽略顺序、去重）
                        canonicalize_set(p.required_services.clone()) == required_for_pool_set
                    } else {
                        // contains（默认）：包含匹配
                        required_for_pool
                            .iter()
                            .all(|rid| p.required_services.iter().any(|x| x == rid))
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
                    // 兼容：回退为“遍历所有配置 pools”
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
            let (nid, bd) = self
                .select_node_with_models_excluding_with_breakdown(
                    src_lang,
                    tgt_lang,
                    required_model_ids,
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

        // 仅对核心链路服务做 pool 级快速跳过（低基数）
        let (need_asr, need_nmt, need_tts) = if let Some(core) = core_services {
            let asr_id = core.asr_service_id.as_str();
            let nmt_id = core.nmt_service_id.as_str();
            let tts_id = core.tts_service_id.as_str();
            let need_asr = !asr_id.is_empty() && required_model_ids.iter().any(|x| x == asr_id);
            let need_nmt = !nmt_id.is_empty() && required_model_ids.iter().any(|x| x == nmt_id);
            let need_tts = !tts_id.is_empty() && required_model_ids.iter().any(|x| x == tts_id);
            (need_asr, need_nmt, need_tts)
        } else {
            (false, false, false)
        };

        for (idx, pool_id) in pools.iter().copied().enumerate() {
            let candidate_ids = pool_candidates
                .get(&pool_id)
                .cloned()
                .unwrap_or_default();
            let mut breakdown = NoAvailableNodeBreakdown::default();
            let mut best: Option<&super::Node> = None;

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

                    // 核心服务缺口（installed/ready）快速判断（仅对 ASR/NMT/TTS 做低基数细分）
                    if need_asr {
                        if pc.asr_installed == 0 {
                            breakdown.total_nodes = candidate_ids.len();
                            breakdown.model_not_available = candidate_ids.len();
                            let reason = "missing_core_asr_installed";
                            attempts.push((pool_id, reason, candidate_ids.len()));
                            crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, false, reason);
                            if idx == 0 {
                                preferred_breakdown = breakdown.clone();
                            }
                            continue;
                        }
                        if pc.asr_ready == 0 {
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
                    }
                    if need_nmt {
                        if pc.nmt_installed == 0 {
                            breakdown.total_nodes = candidate_ids.len();
                            breakdown.model_not_available = candidate_ids.len();
                            let reason = "missing_core_nmt_installed";
                            attempts.push((pool_id, reason, candidate_ids.len()));
                            crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, false, reason);
                            if idx == 0 {
                                preferred_breakdown = breakdown.clone();
                            }
                            continue;
                        }
                        if pc.nmt_ready == 0 {
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
                    }
                    if need_tts {
                        if pc.tts_installed == 0 {
                            breakdown.total_nodes = candidate_ids.len();
                            breakdown.model_not_available = candidate_ids.len();
                            let reason = "missing_core_tts_installed";
                            attempts.push((pool_id, reason, candidate_ids.len()));
                            crate::metrics::prometheus_metrics::on_phase3_pool_attempt(pool_id, false, reason);
                            if idx == 0 {
                                preferred_breakdown = breakdown.clone();
                            }
                            continue;
                        }
                        if pc.tts_ready == 0 {
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

                if !node_has_installed_services(node, required_model_ids) {
                    breakdown.model_not_available += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                    continue;
                }

                if self
                    .has_unavailable_required_services(&node.node_id, required_model_ids)
                    .await
                {
                    breakdown.model_not_available += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                    continue;
                }

                if !node_has_required_services_ready(node, required_model_ids) {
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
                    required_models = ?required_model_ids,
                    "Phase3 two-level：选择节点"
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


