use std::collections::HashMap;

use rand::seq::SliceRandom;
use rand::thread_rng;
use tracing::{debug, warn};

use super::super::{DispatchExcludeReason, NodeRegistry};
use super::selection_breakdown::NoAvailableNodeBreakdown;

impl NodeRegistry {
    /// 从候选节点中随机采样 k 个节点
    /// 如果候选节点数 <= k，返回全部节点
    #[cfg(test)]
    pub fn random_sample_nodes(candidates: &[String], sample_size: usize) -> Vec<String> {
        Self::random_sample_nodes_impl(candidates, sample_size)
    }

    fn random_sample_nodes_impl(candidates: &[String], sample_size: usize) -> Vec<String> {
        if candidates.len() <= sample_size {
            return candidates.to_vec();
        }
        let mut rng = thread_rng();
        let mut sampled: Vec<String> = candidates.choose_multiple(&mut rng, sample_size).cloned().collect();
        // 打乱顺序以保证随机性
        sampled.shuffle(&mut rng);
        sampled
    }

    /// 预取 Pool 成员（从 Redis 批量读取）
    pub(crate) async fn prefetch_pool_members(
        &self,
        pools: &[u16],
        phase2: Option<&crate::phase2::Phase2Runtime>,
    ) -> HashMap<u16, Vec<String>> {
        let mut pool_candidates: HashMap<u16, Vec<String>> =
            HashMap::with_capacity(pools.len());
        
        if let Some(rt) = phase2 {
            // 从 Redis 批量读取 Pool 成员（保持原子性，优化性能）
            tracing::info!(
                pool_count = pools.len(),
                pools = ?pools,
                "预取 Pool 成员: 开始获取 Phase3 配置缓存（node_selection.rs）"
            );
            let cfg_start = std::time::Instant::now();
            let cfg = self.get_phase3_config_cached().await;
            let cfg_elapsed = cfg_start.elapsed();
            tracing::info!(
                pool_count = pools.len(),
                cfg_pool_count = cfg.pools.len(),
                elapsed_ms = cfg_elapsed.as_millis(),
                "预取 Pool 成员: Phase3 配置缓存获取完成（node_selection.rs）"
            );
            
            // 收集所有 pool_name
            let pool_names: Vec<(&str, u16)> = pools.iter().copied()
                .filter_map(|pid| {
                    cfg.pools.iter()
                        .find(|p| p.pool_id == pid)
                        .map(|p| (p.name.as_str(), pid))
                })
                .collect();
            
            tracing::info!(
                pool_count = pools.len(),
                found_pool_configs = pool_names.len(),
                pool_names = ?pool_names.iter().map(|(name, pid)| format!("{}:{}", pid, name)).collect::<Vec<_>>(),
                "预取 Pool 成员: Pool 配置查找完成（node_selection.rs）"
            );
            
            if !pool_names.is_empty() {
                // 批量读取（并行）
                let pool_name_strs: Vec<&str> = pool_names.iter().map(|(name, _)| *name).collect();
                tracing::info!(
                    pool_count = pool_name_strs.len(),
                    pool_names = ?pool_name_strs,
                    "预取 Pool 成员: 开始从 Redis 批量读取成员（node_selection.rs）"
                );
                let redis_start = std::time::Instant::now();
                let members_map = rt.get_pool_members_batch_from_redis(&pool_name_strs).await;
                let redis_elapsed = redis_start.elapsed();
                tracing::info!(
                    pool_count = pool_name_strs.len(),
                    result_count = members_map.len(),
                    elapsed_ms = redis_elapsed.as_millis(),
                    "预取 Pool 成员: Redis 批量读取完成（node_selection.rs）"
                );
                
                // 将结果映射到 pool_id
                for (pool_name, pid) in pool_names {
                    if let Some(members) = members_map.get(pool_name) {
                        let node_ids: Vec<String> = members.iter().cloned().collect();
                        let is_empty = node_ids.is_empty();
                        pool_candidates.insert(pid, node_ids);
                        // 记录 Pool 查询指标
                        crate::metrics::prometheus_metrics::on_pool_query(!is_empty);
                        debug!(
                            pool_id = pid,
                            pool_name = %pool_name,
                            node_count = pool_candidates.get(&pid).map(|v| v.len()).unwrap_or(0),
                            is_empty = is_empty,
                            "从 Redis 批量读取 Pool 成员"
                        );
                    } else {
                        // 记录 Pool 查询为空
                        crate::metrics::prometheus_metrics::on_pool_query(false);
                        warn!(
                            pool_id = pid,
                            pool_name = %pool_name,
                            "从 Redis 批量读取 Pool 成员失败，使用空列表"
                        );
                        pool_candidates.insert(pid, vec![]);
                    }
                }
            }
            
            // 处理未找到配置的 Pool
            for pid in pools.iter().copied() {
                if !pool_candidates.contains_key(&pid) {
                    warn!(
                        pool_id = pid,
                        "未找到 Pool 配置，使用空列表"
                    );
                    pool_candidates.insert(pid, vec![]);
                }
            }
        } else {
            // Phase 2 未启用：返回空列表并记录警告
            warn!(
                "Phase 2 未启用，无法从 Redis 读取 Pool 成员，返回空列表。请启用 Phase 2 以确保多实例一致性。"
            );
            for pid in pools.iter().copied() {
                pool_candidates.insert(pid, vec![]);
            }
        }

        pool_candidates
    }

    /// 在指定的 Pool 中选择节点
    pub(crate) async fn select_node_from_pool(
        &self,
        pool_id: u16,
        candidate_ids: Vec<String>,
        required_types: &[crate::messages::ServiceType],
        accept_public: bool,
        exclude_node_id: Option<&str>,
        phase2: Option<&crate::phase2::Phase2Runtime>,
        pool_core_cache: &HashMap<u16, crate::node_registry::phase3_core_cache::Phase3PoolCoreCache>,
        need_asr: bool,
        need_nmt: bool,
        need_tts: bool,
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        let cfg = self.get_phase3_config_cached().await;
        let mut breakdown = NoAvailableNodeBreakdown::default();
        let mut best_node_id: Option<String> = None;

        // 快速跳过（只依赖 pool 缓存 + pool_index 大小，不做逐节点遍历）
        // 目标：降低 fallback_scan_all_pools 下的 CPU/锁竞争，同时保持可解释的 reason
        if !candidate_ids.is_empty() {
            if let Some(pc) = pool_core_cache.get(&pool_id) {
                if pc.online_nodes == 0 {
                    breakdown.total_nodes = candidate_ids.len();
                    breakdown.offline = candidate_ids.len();
                    return (None, breakdown);
                }
                if pc.ready_nodes == 0 {
                    breakdown.total_nodes = candidate_ids.len();
                    breakdown.status_not_ready = candidate_ids.len();
                    return (None, breakdown);
                }

                // 核心能力缺口（ASR/NMT/TTS）快速判断
                if need_asr && pc.asr_ready == 0 {
                    breakdown.total_nodes = candidate_ids.len();
                    breakdown.model_not_available = candidate_ids.len();
                    return (None, breakdown);
                }
                if need_nmt && pc.nmt_ready == 0 {
                    breakdown.total_nodes = candidate_ids.len();
                    breakdown.model_not_available = candidate_ids.len();
                    return (None, breakdown);
                }
                if need_tts && pc.tts_ready == 0 {
                    breakdown.total_nodes = candidate_ids.len();
                    breakdown.model_not_available = candidate_ids.len();
                    return (None, breakdown);
                }
            }
        }

        // 根据配置选择策略：随机采样或全量遍历
        let nodes_to_check = if cfg.enable_session_affinity {
            // 保持原有行为：全量遍历，选择负载最低的节点
            candidate_ids.clone()
        } else {
            // 随机采样：从候选节点中随机采样 k 个节点
            let sample_size = cfg.random_sample_size;
            Self::random_sample_nodes_impl(&candidate_ids, sample_size)
        };

        debug!(
            pool_id = pool_id,
            total_candidates = candidate_ids.len(),
            sampled_size = nodes_to_check.len(),
            enable_session_affinity = cfg.enable_session_affinity,
            "节点选择策略: {}",
            if cfg.enable_session_affinity { "hash-based (session affinity)" } else { "random sampling" }
        );

        // 优化：使用 RuntimeSnapshot（无锁读取）
        let snapshot_manager = self.get_or_init_snapshot_manager().await;
        let snapshot = snapshot_manager.get_snapshot().await;

        // 从快照中收集候选节点信息（无锁）
        let candidate_nodes: Vec<(String, std::sync::Arc<super::super::runtime_snapshot::NodeRuntimeSnapshot>)> = {
            let mut candidates = Vec::new();
            for nid in nodes_to_check.iter() {
                if let Some(ex) = exclude_node_id {
                    if ex == nid {
                        continue;
                    }
                }
                if let Some(node) = snapshot.nodes.get(nid) {
                    candidates.push((nid.clone(), node.clone()));
                }
            }
            candidates
        };

        // 在锁外进行节点过滤和 Redis 查询
        let mut valid_candidates: Vec<(std::sync::Arc<super::super::runtime_snapshot::NodeRuntimeSnapshot>, usize)> = Vec::new();

        for (_nid, node) in candidate_nodes {
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

            // 检查已安装的服务类型
            if !required_types.is_empty() {
                let has_all_types = required_types.iter().all(|rt| {
                    node.installed_services.iter().any(|s| s.r#type == *rt)
                });
                if !has_all_types {
                    breakdown.model_not_available += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                    continue;
                }
            }

            // 优化：在锁外进行 Redis 查询，避免阻塞其他读操作
            if let Some(rt) = phase2 {
                let mut all_ready = true;
                for t in required_types {
                    if !rt.has_node_capability(&node.node_id, t).await {
                        all_ready = false;
                        break;
                    }
                }
                if !all_ready {
                    breakdown.model_not_available += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                    continue;
                }
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

            // 符合条件的候选节点
            valid_candidates.push((node, effective_jobs));
        }

        // 按负载排序（effective_jobs 升序）
        valid_candidates.sort_by_key(|(_, eff)| *eff);

        // 选择负载最低的节点（如果有多个负载相同，随机选择第一个）
        if let Some((best_node, _)) = valid_candidates.first() {
            best_node_id = Some(best_node.node_id.clone());
        }

        (best_node_id, breakdown)
    }
}
