use super::super::{DispatchExcludeReason, NodeRegistry};
use super::selection_breakdown::NoAvailableNodeBreakdown;
use crate::messages::NodeStatus;
use crate::node_registry::validation::{
    is_node_resource_available, node_has_installed_types, node_has_required_types_ready,
};
use std::time::Instant;
use tracing::{debug, warn};

impl NodeRegistry {
    pub async fn select_node_with_types_excluding_with_breakdown(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_types: &[crate::messages::ServiceType],
        accept_public: bool,
        exclude_node_id: Option<&str>,
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        let path_t0 = Instant::now();
        let reserved_counts = self.reserved_counts_snapshot().await;
        let t0 = Instant::now();
        let nodes = self.nodes.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);

        // 诊断：记录注册表中的节点总数和状态分布
        let total_registered = nodes.len();
        if total_registered == 0 {
            warn!(
                "节点选择失败：注册表中没有任何节点（total_registered=0）。可能原因：1) 节点未成功注册 2) 节点连接断开被清理 3) 节点心跳超时被标记为 offline"
            );
        } else {
            let mut status_distribution: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
            for node in nodes.values() {
                let status_str = format!("{:?}", node.status);
                *status_distribution.entry(status_str).or_insert(0) += 1;
            }
            debug!(
                total_registered = total_registered,
                status_distribution = ?status_distribution,
                "节点选择：注册表中的节点状态分布"
            );
        }

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
                // 添加详细日志，帮助诊断容量问题
                debug!(
                    node_id = %node.node_id,
                    current_jobs = node.current_jobs,
                    reserved = reserved,
                    effective_jobs = effective_jobs,
                    max_concurrent_jobs = node.max_concurrent_jobs,
                    "Node capacity exceeded, excluding from selection"
                );
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
                required_types = ?required_types,
                "节点选择失败（类型选择）：没有找到可用节点，请检查节点是否具备所需能力类型"
            );
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
            required_types = ?required_types,
            candidate_count = available_nodes.len(),
            "调度过滤：选择节点（按类型）"
        );

        crate::metrics::observability::record_path_latency(
            "node_registry.select_node_with_types",
            path_t0.elapsed().as_millis() as u64,
        );
        (Some(selected_node_id), breakdown)
    }
}

