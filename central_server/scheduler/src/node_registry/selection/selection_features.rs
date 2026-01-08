use super::super::{DispatchExcludeReason, NodeRegistry};
use super::selection_breakdown::NoAvailableNodeBreakdown;
use crate::messages::{FeatureFlags, NodeStatus};
use crate::node_registry::validation::{
    is_node_resource_available, node_supports_features,
};
use std::time::Instant;
use tracing::warn;

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
        // Phase2已将reserved融合到current_jobs，无需单独获取reserved_counts
        let t0 = Instant::now();
        let nodes = self.nodes.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

        let mut breakdown = NoAvailableNodeBreakdown::default();
        let mut available_nodes: Vec<&super::super::Node> = Vec::new();

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

            // 节点选择基于 ServiceType 进行过滤

            if !node_supports_features(node, required_features) {
                breakdown.model_not_available += 1;
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                continue;
            }

            // Phase2已将reserved融合到current_jobs，直接使用current_jobs
            let effective_jobs = node.current_jobs;
            if effective_jobs >= node.max_concurrent_jobs {
                breakdown.capacity_exceeded += 1;
                self.record_exclude_reason(DispatchExcludeReason::CapacityExceeded, node.node_id.clone()).await;
                continue;
            }

            if !is_node_resource_available(node, self.resource_threshold) {
                breakdown.resource_threshold_exceeded += 1;
                // 添加详细日志，显示节点的实际资源使用率
                warn!(
                    node_id = %node.node_id,
                    cpu_usage = node.cpu_usage,
                    gpu_usage = ?node.gpu_usage,
                    memory_usage = node.memory_usage,
                    threshold = self.resource_threshold,
                    "Node excluded: resource threshold exceeded"
                );
                self.record_exclude_reason(DispatchExcludeReason::ResourceThresholdExceeded, node.node_id.clone()).await;
                continue;
            }

            available_nodes.push(node);
        }

        if available_nodes.is_empty() {
            // 添加详细的诊断日志，说明为什么没有找到可用节点
            warn!(
                total_nodes = breakdown.total_nodes,
                status_not_ready = breakdown.status_not_ready,
                offline = breakdown.offline,
                not_in_public_pool = breakdown.not_in_public_pool,
                gpu_unavailable = breakdown.gpu_unavailable,
                model_not_available = breakdown.model_not_available,
                capacity_exceeded = breakdown.capacity_exceeded,
                resource_threshold_exceeded = breakdown.resource_threshold_exceeded,
                best_reason = %breakdown.best_reason_label(),
                "节点选择失败（功能感知选择）：没有找到可用节点"
            );
            return (None, breakdown);
        }

        available_nodes.sort_by_key(|node| {
            // Phase2已将reserved融合到current_jobs
            node.current_jobs
        });
        let selected = Some(available_nodes[0].node_id.clone());
        crate::metrics::observability::record_path_latency(
            "node_registry.select_node_with_features",
            path_t0.elapsed().as_millis() as u64,
        );
        (selected, breakdown)
    }
}

