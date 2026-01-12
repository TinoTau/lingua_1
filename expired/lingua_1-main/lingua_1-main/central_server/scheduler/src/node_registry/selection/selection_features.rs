use super::super::{DispatchExcludeReason, NodeRegistry};
use super::selection_breakdown::NoAvailableNodeBreakdown;
use crate::messages::FeatureFlags;
use super::super::runtime_snapshot::NodeRuntimeSnapshot;

// 从快照检查节点功能支持
fn node_supports_features_from_snapshot(
    node: &NodeRuntimeSnapshot,
    required_features: &Option<FeatureFlags>,
) -> bool {
    if let Some(ref features) = required_features {
        // 检查节点是否支持所有必需的功能
        if features.emotion_detection == Some(true) 
            && node.features_supported.emotion_detection != Some(true) {
            return false;
        }
        if features.voice_style_detection == Some(true)
            && node.features_supported.voice_style_detection != Some(true) {
            return false;
        }
        if features.speech_rate_detection == Some(true)
            && node.features_supported.speech_rate_detection != Some(true) {
            return false;
        }
        if features.speech_rate_control == Some(true)
            && node.features_supported.speech_rate_control != Some(true) {
            return false;
        }
        if features.speaker_identification == Some(true)
            && node.features_supported.speaker_identification != Some(true) {
            return false;
        }
        if features.persona_adaptation == Some(true)
            && node.features_supported.persona_adaptation != Some(true) {
            return false;
        }
    }
    true
}
use std::time::Instant;
use tracing::warn;

impl NodeRegistry {
    #[allow(dead_code)] // 目前未使用，由 select_node_with_features_excluding_with_breakdown 替代
    pub async fn select_node_with_features(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_features: &Option<FeatureFlags>,
        accept_public: bool,
    ) -> Option<String> {
        self.select_node_with_features_excluding(src_lang, tgt_lang, required_features, accept_public, None).await
    }

    #[allow(dead_code)] // 目前未使用，由 select_node_with_features_excluding_with_breakdown 替代
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
        // 使用 RuntimeSnapshot（无锁读取）
        let snapshot_manager = self.get_or_init_snapshot_manager().await;
        let snapshot = snapshot_manager.get_snapshot().await;

        let mut breakdown = NoAvailableNodeBreakdown::default();
        let mut available_nodes: Vec<(String, std::sync::Arc<super::super::runtime_snapshot::NodeRuntimeSnapshot>)> = Vec::new();

        for (node_id, node) in snapshot.nodes.iter() {
            if let Some(ex) = exclude_node_id {
                if ex == node_id {
                    continue;
                }
            }
            breakdown.total_nodes += 1;

            if node.health != super::super::runtime_snapshot::NodeHealth::Online {
                breakdown.status_not_ready += 1;
                self.record_exclude_reason(DispatchExcludeReason::StatusNotReady, node.node_id.clone()).await;
                continue;
            }

            if !node.has_gpu {
                breakdown.gpu_unavailable += 1;
                self.record_exclude_reason(DispatchExcludeReason::GpuUnavailable, node.node_id.clone()).await;
                continue;
            }

            if !(accept_public || !node.accept_public_jobs) {
                breakdown.not_in_public_pool += 1;
                self.record_exclude_reason(DispatchExcludeReason::NotInPublicPool, node.node_id.clone()).await;
                continue;
            }

            // 节点选择基于功能进行过滤
            if !node_supports_features_from_snapshot(node, required_features) {
                breakdown.model_not_available += 1;
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                continue;
            }

            // Phase2已将reserved融合到current_jobs，直接使用current_jobs
            let effective_jobs = node.current_jobs;
            if effective_jobs >= node.max_concurrency as usize {
                breakdown.capacity_exceeded += 1;
                self.record_exclude_reason(DispatchExcludeReason::CapacityExceeded, node.node_id.clone()).await;
                continue;
            }

            // 检查资源使用率
            let cpu_ok = node.cpu_usage < self.resource_threshold;
            let gpu_ok = node.gpu_usage.map(|g| g < self.resource_threshold).unwrap_or(true);
            let memory_ok = node.memory_usage < self.resource_threshold;
            if !cpu_ok || !gpu_ok || !memory_ok {
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

            available_nodes.push((node_id.clone(), node.clone()));
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

        available_nodes.sort_by_key(|(_, node)| {
            // Phase2已将reserved融合到current_jobs
            node.current_jobs
        });
        let selected = Some(available_nodes[0].0.clone());
        crate::metrics::observability::record_path_latency(
            "node_registry.select_node_with_features",
            path_t0.elapsed().as_millis() as u64,
        );
        (selected, breakdown)
    }
}

