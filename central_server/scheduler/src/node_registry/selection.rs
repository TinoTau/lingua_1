use super::{DispatchExcludeReason, NodeRegistry};
use crate::messages::{FeatureFlags, NodeStatus};
use std::time::Instant;
use tracing::debug;

use super::validation::{
    is_node_resource_available, node_has_installed_services, node_has_required_services_ready,
    node_supports_features,
};

#[derive(Debug, Default, Clone)]
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
        crate::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

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
        crate::observability::record_path_latency(
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
        crate::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

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

        crate::observability::record_path_latency(
            "node_registry.select_node_with_models",
            path_t0.elapsed().as_millis() as u64,
        );
        (Some(selected_node_id), breakdown)
    }
}


