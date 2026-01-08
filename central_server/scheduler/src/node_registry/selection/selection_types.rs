use super::super::{DispatchExcludeReason, NodeRegistry};
use super::selection_breakdown::NoAvailableNodeBreakdown;
use crate::messages::NodeStatus;
use crate::node_registry::validation::{
    is_node_resource_available, node_has_installed_types,
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
        // Phase2已将reserved融合到current_jobs，无需单独获取reserved_counts
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

            // 注意：selection_types 没有 phase2_runtime，无法从 Redis 读取节点能力
            // 这里暂时返回 false，表示无法检查（需要调用方提供 phase2_runtime）
            // TODO: 重构 selection_types 以支持 phase2_runtime
            // if !node_has_required_types_ready(node, required_types, None).await {
            //     breakdown.model_not_available += 1;
            //     self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
            //     continue;
            // }
            // 临时方案：跳过能力检查（因为无法从 Redis 读取）
            // 这可能会导致选择到没有能力的节点，但这是过渡期的临时方案

            // 语言能力过滤（新增）
            let language_index = self.language_capability_index.read().await;
            
            // NMT 语言对过滤
            if required_types.contains(&crate::messages::ServiceType::Nmt) {
                let nmt_capable_nodes = language_index.find_nodes_for_nmt_pair(src_lang, tgt_lang);
                if !nmt_capable_nodes.contains(&node.node_id) {
                    breakdown.lang_pair_unsupported += 1;
                    self.record_exclude_reason(DispatchExcludeReason::LangPairUnsupported, node.node_id.clone()).await;
                    continue;
                }
            }

            // TTS 语言过滤
            if required_types.contains(&crate::messages::ServiceType::Tts) {
                let tts_capable_nodes = language_index.find_nodes_for_tts_lang(tgt_lang);
                if !tts_capable_nodes.contains(&node.node_id) {
                    breakdown.tts_lang_unsupported += 1;
                    self.record_exclude_reason(DispatchExcludeReason::TtsLangUnsupported, node.node_id.clone()).await;
                    continue;
                }
            }

            // ASR 语言过滤（如果 src_lang != "auto"）
            // P1-3: src_lang = auto 时，必须确保节点有 READY ASR
            if required_types.contains(&crate::messages::ServiceType::Asr) {
                if src_lang != "auto" {
                    let asr_capable_nodes = language_index.find_nodes_for_asr_lang(src_lang);
                    if !asr_capable_nodes.contains(&node.node_id) {
                        breakdown.asr_lang_unsupported += 1;
                        self.record_exclude_reason(DispatchExcludeReason::AsrLangUnsupported, node.node_id.clone()).await;
                        continue;
                    }
                } else {
                    // P1-3: auto 场景 - 节点必须有 READY ASR
                    let nodes_with_asr = language_index.find_nodes_with_ready_asr();
                    if !nodes_with_asr.contains(&node.node_id) {
                        breakdown.src_auto_no_candidate += 1;
                        self.record_exclude_reason(DispatchExcludeReason::SrcAutoNoCandidate, node.node_id.clone()).await;
                        continue;
                    }
                }
            }
            drop(language_index);

            // Phase2已将reserved融合到current_jobs，直接使用current_jobs
            let effective_jobs = node.current_jobs;
            if effective_jobs >= node.max_concurrent_jobs {
                breakdown.capacity_exceeded += 1;
                // 添加详细日志，帮助诊断容量问题
                debug!(
                    node_id = %node.node_id,
                    current_jobs = node.current_jobs,
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
                lang_pair_unsupported = breakdown.lang_pair_unsupported,
                asr_lang_unsupported = breakdown.asr_lang_unsupported,
                tts_lang_unsupported = breakdown.tts_lang_unsupported,
                src_auto_no_candidate = breakdown.src_auto_no_candidate,
                best_reason = %breakdown.best_reason_label(),
                required_types = ?required_types,
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                "节点选择失败（类型选择）：没有找到可用节点，请检查节点是否具备所需能力类型和语言支持"
            );
            return (None, breakdown);
        }

        // P1-3: src_lang = auto 时，按 ASR 语言覆盖度排序
        let language_index = self.language_capability_index.read().await;
        available_nodes.sort_by(|a, b| {
            // 首先按负载排序（Phase2已将reserved融合到current_jobs）
            let load_a = a.current_jobs;
            let load_b = b.current_jobs;
            
            let load_cmp = load_a.cmp(&load_b);
            if load_cmp != std::cmp::Ordering::Equal {
                return load_cmp;
            }
            
            // 如果 src_lang = auto，按 ASR 语言覆盖度排序
            if src_lang == "auto" {
                let coverage_a = language_index.get_asr_language_coverage(&a.node_id);
                let coverage_b = language_index.get_asr_language_coverage(&b.node_id);
                return coverage_b.cmp(&coverage_a);  // 覆盖度高的优先
            }
            
            // 其他情况按 GPU 使用率排序
            let gpu_a = a.gpu_usage.unwrap_or(0.0);
            let gpu_b = b.gpu_usage.unwrap_or(0.0);
            gpu_a.partial_cmp(&gpu_b).unwrap_or(std::cmp::Ordering::Equal)
        });
        drop(language_index);
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

