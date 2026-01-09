use super::super::{DispatchExcludeReason, NodeRegistry};
use super::selection_breakdown::{NoAvailableNodeBreakdown, Phase3TwoLevelDebug};
use crate::messages::NodeStatus;
use crate::node_registry::validation::{
    is_node_resource_available, node_has_installed_types, node_has_required_types_ready,
};
use std::str::FromStr;
use std::time::Instant;
use tracing::{debug, warn};
use rand::seq::SliceRandom;
use rand::{thread_rng, Rng};

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
        let using_capability_pools = !cfg.pools.is_empty();

        fn canonicalize_set<T: Ord + std::fmt::Debug + Clone>(mut v: Vec<T>) -> Vec<T> {
            v.sort();
            v.dedup();
            v
        }

        // 选择"候选 pools"（按类型或语言对）
        // - 兼容模式：cfg.pools 为空 -> 继续用 hash 分桶（0..pool_count）
        // - 强隔离：cfg.pools 非空 -> pool_id 来自配置（按能力分配节点）
        // - 自动生成模式：根据语言对直接选择 Pool
        let (all_pools, preferred_pool, pools) = if cfg.enabled && cfg.mode == "two_level" {
            if cfg.auto_generate_language_pools && using_capability_pools {
                // 自动生成模式：根据语言对直接选择 Pool
                debug!(
                    src_lang = %src_lang,
                    tgt_lang = %tgt_lang,
                    "自动生成模式：根据语言对选择 Pool"
                );
                if src_lang == "auto" {
                    // 未知源语言：使用混合池（多对一 Pool）
                    // 选择所有以 *-tgt_lang 格式命名的混合池
                    debug!(
                        src_lang = %src_lang,
                        tgt_lang = %tgt_lang,
                        "源语言为 auto，使用混合池（多对一）支持目标语言 {}",
                        tgt_lang
                    );
                    let eligible_pools: Vec<u16> = cfg.pools
                        .iter()
                        .filter(|p| {
                            // 混合池命名格式：*-tgt_lang（如 *-en）
                            p.name == format!("*-{}", tgt_lang)
                        })
                        .map(|p| p.pool_id)
                        .collect();
                    
                    if eligible_pools.is_empty() {
                        warn!(
                            tgt_lang = %tgt_lang,
                            total_pools = cfg.pools.len(),
                            "未找到支持目标语言 {} 的混合池",
                            tgt_lang
                        );
                        let dbg = Phase3TwoLevelDebug {
                            pool_count: cfg.pools.len() as u16,
                            preferred_pool: 0,
                            selected_pool: None,
                            fallback_used: false,
                            attempts: vec![],
                        };
                        return (None, dbg, NoAvailableNodeBreakdown::default());
                    }
                    
                    debug!(
                        tgt_lang = %tgt_lang,
                        eligible_pool_count = eligible_pools.len(),
                        "找到 {} 个支持目标语言 {} 的混合池",
                        eligible_pools.len(),
                        tgt_lang
                    );
                    let all_pool_ids: Vec<u16> = cfg.pools.iter().map(|p| p.pool_id).collect();
                    let preferred = eligible_pools[0]; // 使用第一个匹配的混合池作为 preferred
                    (all_pool_ids, preferred, eligible_pools)
                } else {
                    // 已知源语言：搜索所有包含源语言和目标语言的 Pool（语言集合 Pool）
                    let eligible_pools: Vec<u16> = cfg.pools.iter()
                        .filter(|p| {
                            // 检查 Pool 名称是否包含 src_lang 和 tgt_lang
                            let pool_langs: std::collections::HashSet<&str> = p.name.split('-').collect();
                            pool_langs.contains(src_lang) && pool_langs.contains(tgt_lang)
                        })
                        .map(|p| p.pool_id)
                        .collect();
                    
                    if eligible_pools.is_empty() {
                        warn!(
                            src_lang = %src_lang,
                            tgt_lang = %tgt_lang,
                            total_pools = cfg.pools.len(),
                            "未找到包含源语言 {} 和目标语言 {} 的 Pool",
                            src_lang,
                            tgt_lang
                        );
                        let dbg = Phase3TwoLevelDebug {
                            pool_count: cfg.pools.len() as u16,
                            preferred_pool: 0,
                            selected_pool: None,
                            fallback_used: false,
                            attempts: vec![],
                        };
                        return (None, dbg, NoAvailableNodeBreakdown::default());
                    }
                    
                    debug!(
                        src_lang = %src_lang,
                        tgt_lang = %tgt_lang,
                        eligible_pool_count = eligible_pools.len(),
                        eligible_pool_ids = ?eligible_pools,
                        "找到 {} 个包含源语言 {} 和目标语言 {} 的 Pool",
                        eligible_pools.len(),
                        src_lang,
                        tgt_lang
                    );
                    let all_pool_ids: Vec<u16> = cfg.pools.iter().map(|p| p.pool_id).collect();
                    let preferred = eligible_pools[0]; // 使用第一个匹配的 Pool 作为 preferred
                    (all_pool_ids, preferred, eligible_pools)
                }
            } else if using_capability_pools {
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
                    // 根据配置选择策略：hash-based（session affinity）或随机
                    if cfg.enable_session_affinity {
                        preferred_idx = crate::phase3::pick_index_for_key(eligible.len(), cfg.hash_seed, routing_key);
                        preferred_pool = eligible[preferred_idx];
                    } else {
                        // 随机选择 preferred pool（无 session affinity）
                        let mut rng = thread_rng();
                        if let Some(&pool) = eligible.choose(&mut rng) {
                            preferred_pool = pool;
                            preferred_idx = eligible.iter().position(|&p| p == pool).unwrap_or(0);
                        } else {
                            preferred_pool = eligible[0];
                            preferred_idx = 0;
                        }
                    }
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
                let preferred = if cfg.enable_session_affinity {
                    crate::phase3::pool_id_for_key(pool_count, cfg.hash_seed, routing_key)
                } else {
                    // 随机选择 preferred pool（无 session affinity）
                    let mut rng = thread_rng();
                    rng.gen_range(0..pool_count)
                };
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

        // Phase2已将reserved融合到current_jobs，无需单独获取reserved_counts

        // 性能：预取 pool -> node_ids
        // 如果启用 Phase 2，从 Redis 读取（保持原子性）；否则返回错误（必须启用 Phase 2）
        let mut pool_candidates: std::collections::HashMap<u16, Vec<String>> =
            std::collections::HashMap::with_capacity(pools.len());
        
        if let Some(rt) = phase2 {
            // 从 Redis 批量读取 Pool 成员（保持原子性，优化性能）
            let cfg = self.phase3.read().await.clone();
            
            // 收集所有 pool_name
            let pool_names: Vec<(&str, u16)> = pools.iter().copied()
                .filter_map(|pid| {
                    cfg.pools.iter()
                        .find(|p| p.pool_id == pid)
                        .map(|p| (p.name.as_str(), pid))
                })
                .collect();
            
            if !pool_names.is_empty() {
                // 批量读取（并行）
                let pool_name_strs: Vec<&str> = pool_names.iter().map(|(name, _)| *name).collect();
                let members_map = rt.get_pool_members_batch_from_redis(&pool_name_strs).await;
                
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
            let mut breakdown = NoAvailableNodeBreakdown::default();
            let mut best_node_id: Option<String> = None;

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

            // 优化：先快速收集候选节点信息，立即释放读锁，避免在持有锁时进行 Redis 查询
            let candidate_nodes: Vec<(String, crate::node_registry::Node)> = {
                let t0 = Instant::now();
                let nodes = self.nodes.read().await;
                crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);
                let mut candidates = Vec::new();
                for nid in nodes_to_check.iter() {
                    if let Some(ex) = exclude_node_id {
                        if ex == nid {
                            continue;
                        }
                    }
                    if let Some(node) = nodes.get(nid) {
                        candidates.push((nid.clone(), node.clone()));
                    }
                }
                candidates
            };

            // 在锁外进行节点过滤和 Redis 查询
            let mut valid_candidates: Vec<(crate::node_registry::Node, usize)> = Vec::new();

            for (_nid, node) in candidate_nodes {
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

                if !node_has_installed_types(&node, required_types) {
                    breakdown.model_not_available += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                    continue;
                }

                // 优化：在锁外进行 Redis 查询，避免阻塞其他读操作
                if !node_has_required_types_ready(&node, required_types, phase2).await {
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

                if !is_node_resource_available(&node, self.resource_threshold) {
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

                // 符合条件的候选节点
                valid_candidates.push((node, effective_jobs));
            }

            // 按负载排序（effective_jobs 升序）
            valid_candidates.sort_by_key(|(_, eff)| *eff);

            // 选择负载最低的节点（如果有多个负载相同，随机选择第一个）
            if let Some((best_node, _)) = valid_candidates.first() {
                best_node_id = Some(best_node.node_id.clone());
            }

            let reason = if best_node_id.is_some() { "ok" } else { breakdown.best_reason_label() };

            attempts.push((pool_id, reason, candidate_ids.len()));
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

