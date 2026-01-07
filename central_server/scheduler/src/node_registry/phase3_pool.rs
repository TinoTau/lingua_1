use super::NodeRegistry;
use crate::phase2::Phase2Runtime;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;

use super::phase3_pool_constants::{
    POOL_LEADER_LOCK_TTL_SECONDS,
    POOL_CONFIG_RETRY_DELAY_MS,
    POOL_CLEANUP_SCAN_INTERVAL_SECONDS,
    POOL_CONFIG_SYNC_CHECK_INTERVAL_SECONDS,
};

impl NodeRegistry {
    pub async fn phase3_config(&self) -> crate::core::config::Phase3Config {
        self.phase3.read().await.clone()
    }

    pub async fn set_phase3_config(&self, cfg: crate::core::config::Phase3Config) {
        let mut w = self.phase3.write().await;
        let should_auto_generate = cfg.auto_generate_language_pools && cfg.pools.is_empty();
        *w = cfg.clone();
        drop(w);
        
        // 如果启用自动生成且 pools 为空，则自动生成
        // 注意：这里无法访问 phase2_runtime，会在后续的定期任务中从 Redis 读取
        if should_auto_generate {
            self.rebuild_auto_language_pools(None).await;
        }
        
        self.rebuild_phase3_pool_index().await;
        // Phase 3：pool 映射变化（pool_count/hash_seed 等）会影响 core cache 的 pool_id 归属
        self.rebuild_phase3_core_cache().await;
    }

    pub(super) async fn phase3_upsert_node_to_pool_index(&self, node_id: &str) {
        use tracing::{debug, info, warn};
        use std::collections::HashSet;
        
        let cfg = self.phase3.read().await.clone();
        if !cfg.enabled || cfg.mode != "two_level" {
            return;
        }
        let pool_ids: HashSet<u16> = if !cfg.pools.is_empty() {
            let nodes = self.nodes.read().await;
            let Some(n) = nodes.get(node_id) else {
                warn!(node_id = %node_id, "节点不存在，无法分配 Pool");
                return;
            };
            if cfg.auto_generate_language_pools {
                // 自动生成模式：使用语言能力匹配（支持多个 Pool）
                debug!(node_id = %node_id, "使用自动生成模式分配 Pool");
                let language_index = self.language_capability_index.read().await;
                let matched_pools = super::phase3_pool_allocation::determine_pools_for_node_auto_mode_with_index(&cfg, n, &language_index);
                if !matched_pools.is_empty() {
                    debug!(
                        node_id = %node_id,
                        pool_count = matched_pools.len(),
                        pool_ids = ?matched_pools,
                        "节点匹配到 {} 个 Pool",
                        matched_pools.len()
                    );
                    matched_pools.into_iter().collect()
                } else {
                    // 节点未匹配到任何现有 Pool，检查是否需要动态创建新 Pool
                    info!(
                        node_id = %node_id,
                        "节点未匹配到任何现有 Pool，检查是否需要创建新 Pool"
                    );
                    drop(nodes);
                    drop(language_index);
                    let new_pool_id = self.try_create_pool_for_node(node_id).await;
                    if let Some(pid) = new_pool_id {
                        info!(
                            node_id = %node_id,
                            pool_id = pid,
                            "成功为节点动态创建新 Pool {}",
                            pid
                        );
                        // 创建新 Pool 后，重新读取配置并尝试匹配所有 Pool
                        let cfg_updated = self.phase3.read().await.clone();
                        let nodes_updated = self.nodes.read().await;
                        if let Some(n_updated) = nodes_updated.get(node_id) {
                            let language_index_updated = self.language_capability_index.read().await;
                            let matched_pools_retry = super::phase3_pool_allocation::determine_pools_for_node_auto_mode_with_index(&cfg_updated, n_updated, &language_index_updated);
                            if !matched_pools_retry.is_empty() {
                                debug!(
                                    node_id = %node_id,
                                    pool_count = matched_pools_retry.len(),
                                    pool_ids = ?matched_pools_retry,
                                    "创建新 Pool 后，节点成功匹配到 {} 个 Pool",
                                    matched_pools_retry.len()
                                );
                                matched_pools_retry.into_iter().collect()
                            } else {
                                debug!(
                                    node_id = %node_id,
                                    "创建新 Pool 后，节点仍未匹配到其他 Pool（可能是匹配逻辑问题）"
                                );
                                // 至少包含新创建的 Pool
                                [pid].iter().cloned().collect()
                            }
                        } else {
                            // 至少包含新创建的 Pool
                            [pid].iter().cloned().collect()
                        }
                    } else {
                        debug!(
                            node_id = %node_id,
                            "节点未创建新 Pool（可能已达到上限或语言对已存在）"
                        );
                        HashSet::new()
                    }
                }
            } else {
                // 手动配置模式：使用服务类型匹配（仍然只返回一个 Pool）
                debug!(node_id = %node_id, "使用手动配置模式分配 Pool");
                if let Some(pid) = determine_pool_for_node(&cfg, n) {
                    [pid].iter().cloned().collect()
                } else {
                    HashSet::new()
                }
            }
        } else {
            // 非自动生成模式：使用 hash 分配（仍然只返回一个 Pool）
            [crate::phase3::pool_id_for_key(cfg.pool_count, cfg.hash_seed, node_id)].iter().cloned().collect()
        };
        self.phase3_set_node_pools(node_id, pool_ids).await;
    }

    pub async fn phase3_remove_node_from_pool_index(&self, node_id: &str) {
        self.phase3_set_node_pool(node_id, None).await;
    }

    /// 尝试为节点动态创建 Pool（如果节点支持的语言对不在现有 Pool 中）
    /// 返回新创建的 Pool ID，如果不需要创建或创建失败则返回 None
    pub(super) async fn try_create_pool_for_node(&self, node_id: &str) -> Option<u16> {
        use tracing::{debug, info, warn};
        
        let nodes = self.nodes.read().await;
        let node = nodes.get(node_id)?;
        let language_index = self.language_capability_index.read().await;
        
        // 获取节点的语言对
        // 使用 auto_language_pool 模块中的逻辑来获取语言对
        let node_pairs = {
            // 优先级1：使用节点端计算的 supported_language_pairs
            if let Some(ref caps) = node.language_capabilities {
                if let Some(ref pairs) = caps.supported_language_pairs {
                    pairs.iter().map(|p| (p.src.clone(), p.tgt.clone())).collect()
                } else {
                    // 向后兼容模式：需要计算，但这里简化处理，直接返回空
                    // 因为如果节点没有 supported_language_pairs，说明可能是旧节点
                    // 这种情况下，应该由全量重建来处理
                    vec![]
                }
            } else {
                vec![]
            }
        };
        
        if node_pairs.is_empty() {
            debug!(
                node_id = %node_id,
                "节点没有支持的语言对，无法创建 Pool"
            );
            return None;
        }
        
        drop(nodes);
        drop(language_index);
        
        // 检查现有 Pool 配置
        let cfg = self.phase3.read().await.clone();
        let auto_cfg = match cfg.auto_pool_config.as_ref() {
            Some(c) => c,
            None => {
                warn!(
                    node_id = %node_id,
                    "auto_pool_config 未配置，无法创建 Pool"
                );
                return None;
            }
        };
        
        // 检查节点的语言对是否已经在现有 Pool 中
        let existing_pool_names: HashSet<String> = cfg.pools.iter()
            .map(|p| p.name.clone())
            .collect();
        
        // 找到第一个不在现有 Pool 中的语言对
        let mut new_pool_pair: Option<(String, String)> = None;
        for (src, tgt) in &node_pairs {
            let pool_name = format!("{}-{}", src, tgt);
            if !existing_pool_names.contains(&pool_name) {
                new_pool_pair = Some((src.clone(), tgt.clone()));
                break;
            }
        }
        
        if new_pool_pair.is_none() {
            debug!(
                node_id = %node_id,
                "节点的所有语言对都已存在于现有 Pool 中，无需创建新 Pool"
            );
            return None;
        }
        
        let (src, tgt) = new_pool_pair.unwrap();
        let pool_name = format!("{}-{}", src, tgt);
        
        info!(
            node_id = %node_id,
            pool_name = %pool_name,
            src_lang = %src,
            tgt_lang = %tgt,
            "检测到节点支持新的语言对，准备创建新 Pool"
        );
        
        // 计算新的 Pool ID（使用当前最大 Pool ID + 1）
        let next_pool_id = cfg.pools.iter()
            .map(|p| p.pool_id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        
        // 检查是否超过 max_pools 限制（仅精确池）
        if cfg.pools.len() >= auto_cfg.max_pools {
            warn!(
                node_id = %node_id,
                pool_name = %pool_name,
                current_pool_count = cfg.pools.len(),
                max_pools = auto_cfg.max_pools,
                "Pool 数量已达到上限，无法创建新 Pool"
            );
            return None;
        }
        
        // 创建新的 Pool 配置
        let new_pool = crate::core::config::Phase3PoolConfig {
            pool_id: next_pool_id,
            name: pool_name.clone(),
            required_services: {
                let mut services = vec![
                    "asr".to_string(),
                    "nmt".to_string(),
                    "tts".to_string(),
                ];
                if auto_cfg.require_semantic {
                    services.push("semantic".to_string());
                }
                services
            },
            language_requirements: Some(crate::core::config::PoolLanguageRequirements {
                asr_languages: Some(vec![src.clone()]),
                tts_languages: Some(vec![tgt.clone()]),
                nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                    languages: vec![src.clone(), tgt.clone()],
                    rule: "specific_pairs".to_string(),
                    supported_pairs: Some(vec![crate::messages::common::LanguagePair {
                        src: src.clone(),
                        tgt: tgt.clone(),
                    }]),
                    blocked_pairs: None,
                }),
                semantic_languages: None,
            }),
        };
        
        // 更新 Pool 配置（本地）
        {
            let mut phase3 = self.phase3.write().await;
            phase3.pools.push(new_pool.clone());
            info!(
                node_id = %node_id,
                pool_id = next_pool_id,
                pool_name = %pool_name,
                new_pool_count = phase3.pools.len(),
                "新 Pool 已添加到本地配置"
            );
        }
        
        // 注意：动态创建的 Pool 配置只更新本地，不立即同步到 Redis
        // Redis 同步由定期清理任务或全量重建时处理
        // 这样可以避免在节点心跳处理中引入 Phase2Runtime 依赖
        
        // 重建 Pool 索引（将新节点添加到新 Pool）
        // 注意：这里不需要调用 rebuild_phase3_pool_index，因为 phase3_set_node_pool 会处理索引更新
        
        Some(next_pool_id)
    }

    pub async fn rebuild_phase3_pool_index(&self) {
        use std::collections::HashSet;
        let cfg = self.phase3.read().await.clone();
        let mut new_idx: HashMap<u16, HashSet<String>> = HashMap::new();
        let mut new_node_pool: HashMap<String, HashSet<u16>> = HashMap::new();
        if cfg.enabled && cfg.mode == "two_level" {
            let t0 = Instant::now();
            let nodes = self.nodes.read().await;
            crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);
            for nid in nodes.keys() {
                let pool_ids: HashSet<u16> = if !cfg.pools.is_empty() {
                    if cfg.auto_generate_language_pools {
                        // 自动生成模式：支持多个 Pool
                        if let Some(n) = nodes.get(nid) {
                            let language_index = self.language_capability_index.read().await;
                            let matched = super::phase3_pool_allocation::determine_pools_for_node_auto_mode_with_index(&cfg, n, &language_index);
                            matched.into_iter().collect()
                        } else {
                            HashSet::new()
                        }
                    } else {
                        // 手动配置模式：只返回一个 Pool
                        if let Some(pid) = nodes.get(nid).and_then(|n| determine_pool_for_node(&cfg, n)) {
                            [pid].iter().cloned().collect()
                        } else {
                            HashSet::new()
                        }
                    }
                } else {
                    // 非自动生成模式：使用 hash 分配
                    [crate::phase3::pool_id_for_key(cfg.pool_count, cfg.hash_seed, nid)].iter().cloned().collect()
                };
                if !pool_ids.is_empty() {
                    for pid in &pool_ids {
                        new_idx.entry(*pid).or_default().insert(nid.clone());
                    }
                    new_node_pool.insert(nid.clone(), pool_ids);
                }
            }
        }
        let t0 = Instant::now();
        let mut idx = self.phase3_pool_index.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_pool_index.write", t0.elapsed().as_millis() as u64);
        *idx = new_idx;
        drop(idx);
        let t0 = Instant::now();
        let mut m = self.phase3_node_pool.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_node_pool.write", t0.elapsed().as_millis() as u64);
        *m = new_node_pool;
    }

    /// 运维/调试：返回各 pool 的节点数（总数，包括 offline/registering；筛选在上层做）
    pub async fn phase3_pool_sizes(&self) -> Vec<(u16, usize)> {
        let t0 = Instant::now();
        let idx = self.phase3_pool_index.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_pool_index.read", t0.elapsed().as_millis() as u64);
        let mut v: Vec<(u16, usize)> = idx.iter().map(|(k, set)| (*k, set.len())).collect();
        v.sort_by_key(|(k, _)| *k);
        v
    }

    /// Phase 3：更新 node -> pools 的归属（同时维护 pool_index）
    /// - desired 为空：从所有 pool_index 中移除该节点
    /// - 一个节点可以属于多个 Pool
    pub(super) async fn phase3_set_node_pools(&self, node_id: &str, desired: HashSet<u16>) {
        use tracing::info;
        use crate::messages::NodeStatus;
        
        // 先更新 node->pools 映射，拿到 old
        let t0 = Instant::now();
        let mut m = self.phase3_node_pool.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_node_pool.write", t0.elapsed().as_millis() as u64);
        let old: HashSet<u16> = m.remove(node_id).unwrap_or_default();
        let is_new_allocation = old.is_empty() && !desired.is_empty();
        
        if !desired.is_empty() {
            m.insert(node_id.to_string(), desired.clone());
            let added: Vec<u16> = desired.difference(&old).cloned().collect();
            let removed: Vec<u16> = old.difference(&desired).cloned().collect();
            
            if !added.is_empty() || !removed.is_empty() {
                if !added.is_empty() && !removed.is_empty() {
                    info!(
                        node_id = %node_id,
                        added_pools = ?added,
                        removed_pools = ?removed,
                        "节点 Pool 归属更新：新增 {} 个 Pool，移除 {} 个 Pool",
                        added.len(),
                        removed.len()
                    );
                } else if !added.is_empty() {
                    info!(
                        node_id = %node_id,
                        added_pools = ?added,
                        "节点新增 {} 个 Pool",
                        added.len()
                    );
                } else {
                    info!(
                        node_id = %node_id,
                        removed_pools = ?removed,
                        "节点从 {} 个 Pool 移除",
                        removed.len()
                    );
                }
            }
        } else if !old.is_empty() {
            info!(
                node_id = %node_id,
                old_pools = ?old,
                "节点从所有 Pool 移除"
            );
        }
        drop(m);
        
        // 如果节点是新分配到 Pool 的，且状态是 Registering，则更新为 Ready
        if is_new_allocation {
            let mut nodes = self.nodes.write().await;
            if let Some(node) = nodes.get_mut(node_id) {
                if node.status == NodeStatus::Registering {
                    node.status = NodeStatus::Ready;
                    info!(
                        node_id = %node_id,
                        pool_count = desired.len(),
                        "节点状态从 Registering 更新为 Ready（已分配到 {} 个 Pool）",
                        desired.len()
                    );
                }
            }
            drop(nodes);
        }

        // 再更新 pool_index
        let t0 = Instant::now();
        let mut idx = self.phase3_pool_index.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_pool_index.write", t0.elapsed().as_millis() as u64);
        
        // 从旧的 Pool 中移除节点
        for old_pid in &old {
            if !desired.contains(old_pid) {
                if let Some(set) = idx.get_mut(old_pid) {
                    set.remove(node_id);
                    if set.is_empty() {
                        idx.remove(old_pid);
                    }
                }
            }
        }
        
        // 添加到新的 Pool 中
        for new_pid in &desired {
            if !old.contains(new_pid) {
                idx.entry(*new_pid)
                    .or_insert_with(HashSet::new)
                    .insert(node_id.to_string());
            }
        }
    }
    
    /// Phase 3：更新 node -> pool 的归属（向后兼容，只设置一个 Pool）
    /// 注意：此方法已废弃，建议使用 phase3_set_node_pools
    pub(super) async fn phase3_set_node_pool(&self, node_id: &str, desired: Option<u16>) {
        use std::collections::HashSet;
        let pool_ids: HashSet<u16> = desired.map(|pid| [pid].iter().cloned().collect()).unwrap_or_default();
        self.phase3_set_node_pools(node_id, pool_ids).await;
    }

    /// 获取节点所属的所有 Pool ID（支持一个节点属于多个 Pool）
    pub async fn phase3_node_pool_ids(&self, node_id: &str) -> HashSet<u16> {
        let t0 = Instant::now();
        let m = self.phase3_node_pool.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_node_pool.read", t0.elapsed().as_millis() as u64);
        m.get(node_id).cloned().unwrap_or_default()
    }
    
    /// 获取节点所属的 Pool ID（向后兼容，返回第一个 Pool）
    /// 注意：此方法已废弃，建议使用 phase3_node_pool_ids
    pub async fn phase3_node_pool_id(&self, node_id: &str) -> Option<u16> {
        let pool_ids = self.phase3_node_pool_ids(node_id).await;
        pool_ids.into_iter().next()
    }

    /// 运维/调试：返回 pool 内示例节点 ID（最多 limit 个）
    pub async fn phase3_pool_sample_node_ids(&self, pool_id: u16, limit: usize) -> Vec<String> {
        let lim = limit.max(1);
        let t0 = Instant::now();
        let idx = self.phase3_pool_index.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_pool_index.read", t0.elapsed().as_millis() as u64);
        let mut v: Vec<String> = idx
            .get(&pool_id)
            .map(|s| s.iter().cloned().take(lim).collect())
            .unwrap_or_default();
        v.sort();
        v.truncate(lim);
        v
    }

    /// 重新生成自动语言 Pool（全量重建）
    /// 如果提供了 phase2_runtime，会尝试从 Redis 读取或写入 Pool 配置
    pub async fn rebuild_auto_language_pools(&self, phase2_runtime: Option<Arc<Phase2Runtime>>) {
        use tracing::{debug, info, warn};
        
        let cfg = self.phase3.read().await.clone();
        
        // 只在自动生成模式时执行
        if !cfg.auto_generate_language_pools {
            warn!("自动生成 Pool 未启用，跳过重建");
            return;
        }

        // Phase 2：如果启用了 Redis，尝试从 Redis 读取 Pool 配置
        if let Some(rt) = phase2_runtime.as_ref() {
            if let Some((redis_pools, version)) = rt.get_pool_config().await {
                info!(
                    pool_count = redis_pools.len(),
                    version = version,
                    "从 Redis 读取 Pool 配置"
                );
                
                // 更新本地配置
                {
                    let mut phase3 = self.phase3.write().await;
                    let old_count = phase3.pools.len();
                    phase3.pools = redis_pools.clone();
                    info!(
                        old_pool_count = old_count,
                        new_pool_count = redis_pools.len(),
                        "Pool 配置已从 Redis 更新：{} -> {}",
                        old_count,
                        redis_pools.len()
                    );
                }
                
                // 重建 Pool 索引
                info!("开始重建 Pool 索引（从 Redis 配置）");
                self.rebuild_phase3_pool_index().await;
                self.rebuild_phase3_core_cache().await;
                info!("Pool 索引重建完成");
                return;
            }
            
            // Redis 中没有配置，尝试成为 leader 并生成
            debug!("Redis 中不存在 Pool 配置，尝试成为 leader 并生成");
            
            // 尝试获取 leader 锁
            if rt.try_acquire_pool_leader(POOL_LEADER_LOCK_TTL_SECONDS).await {
                info!("成功获取 Pool Leader 锁，开始生成 Pool 配置");
                
                // 生成新的 pools
                let new_pools = self.auto_generate_language_pair_pools().await;
                
                // 写入 Redis
                if rt.set_pool_config(&new_pools).await {
                    info!(
                        pool_count = new_pools.len(),
                        "Pool 配置已写入 Redis"
                    );
                } else {
                    warn!("Pool 配置写入 Redis 失败，但继续更新本地配置");
                }
                
                // 更新本地配置
                {
                    let mut phase3 = self.phase3.write().await;
                    let old_count = phase3.pools.len();
                    phase3.pools = new_pools.clone();
                    info!(
                        old_pool_count = old_count,
                        new_pool_count = new_pools.len(),
                        "Pool 配置已更新：{} -> {}",
                        old_count,
                        new_pools.len()
                    );
                }
                
                // 重建 Pool 索引
                info!("开始重建 Pool 索引");
                self.rebuild_phase3_pool_index().await;
                self.rebuild_phase3_core_cache().await;
                info!("Pool 索引重建完成");
                return;
            } else {
                // 不是 leader，等待一段时间后重试从 Redis 读取
                debug!("未能获取 Pool Leader 锁，等待其他实例生成配置");
                tokio::time::sleep(tokio::time::Duration::from_millis(POOL_CONFIG_RETRY_DELAY_MS)).await;
                
                // 再次尝试从 Redis 读取
                if let Some((redis_pools, version)) = rt.get_pool_config().await {
                    info!(
                        pool_count = redis_pools.len(),
                        version = version,
                        "从 Redis 读取 Pool 配置（重试成功）"
                    );
                    
                    // 更新本地配置
                    {
                        let mut phase3 = self.phase3.write().await;
                        let old_count = phase3.pools.len();
                        phase3.pools = redis_pools.clone();
                        info!(
                            old_pool_count = old_count,
                            new_pool_count = redis_pools.len(),
                            "Pool 配置已从 Redis 更新（重试成功）：{} -> {}",
                            old_count,
                            redis_pools.len()
                        );
                    }
                    
                    // 重建 Pool 索引
                    info!("开始重建 Pool 索引（从 Redis 配置，重试成功）");
                    self.rebuild_phase3_pool_index().await;
                    self.rebuild_phase3_core_cache().await;
                    info!("Pool 索引重建完成");
                    return;
                }
                
                // 如果仍然没有配置，fallback 到本地生成
                warn!("Redis 中仍然没有 Pool 配置，fallback 到本地生成");
            }
        }

        // Fallback：本地生成（单实例模式或 Redis 不可用）
        info!("开始重建自动语言 Pool（本地模式）");
        
        // 生成新的 pools
        let new_pools = self.auto_generate_language_pair_pools().await;
        
        // 更新配置
        {
            let mut phase3 = self.phase3.write().await;
            let old_count = phase3.pools.len();
            phase3.pools = new_pools.clone();
            info!(
                old_pool_count = old_count,
                new_pool_count = new_pools.len(),
                "Pool 配置已更新（本地模式）：{} -> {}",
                old_count,
                new_pools.len()
            );
        }
        
        // 重建 Pool 索引
        info!("开始重建 Pool 索引");
        self.rebuild_phase3_pool_index().await;
        self.rebuild_phase3_core_cache().await;
        info!("Pool 索引重建完成");
    }
    
    /// 启动定期 Pool 清理任务（用于自动生成模式）
    /// 定期检查并清理空 Pool，重建 Pool 配置
    /// 如果提供了 phase2_runtime，会从 Redis 读取 Pool 配置
    pub fn start_pool_cleanup_task(self: &std::sync::Arc<Self>, phase2_runtime: Option<Arc<Phase2Runtime>>) {
        use tracing::{debug, info, warn};
        use std::time::Duration;
        
        let registry = self.clone();
        let phase2_rt = phase2_runtime.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(POOL_CLEANUP_SCAN_INTERVAL_SECONDS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            
            // Phase 2：定期从 Redis 拉取 Pool 配置（如果启用）
            let mut pool_config_check_interval = tokio::time::interval(Duration::from_secs(POOL_CONFIG_SYNC_CHECK_INTERVAL_SECONDS));
            pool_config_check_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut last_version: Option<u64> = None;
            
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        let cfg = registry.phase3.read().await.clone();
                        if !cfg.auto_generate_language_pools {
                            continue;
                        }
                        
                        debug!("开始定期 Pool 清理扫描");
                        
                        // 1. 清理离线节点（从 Pool 索引中移除）
                        let nodes = registry.nodes.read().await;
                        let offline_nodes: Vec<String> = nodes
                            .iter()
                            .filter(|(_, n)| !n.online)
                            .map(|(id, _)| id.clone())
                            .collect();
                        drop(nodes);
                        
                        if !offline_nodes.is_empty() {
                            debug!(
                                offline_count = offline_nodes.len(),
                                "发现 {} 个离线节点，从 Pool 索引中移除",
                                offline_nodes.len()
                            );
                            for node_id in &offline_nodes {
                                registry.phase3_remove_node_from_pool_index(node_id).await;
                            }
                        }
                        
                        // 2. 检查空 Pool 并重建
                        // 注意：只有在所有 Pool 都为空，且没有在线节点时，才触发重建
                        // 这样可以避免清空动态创建的 Pool
                        let pool_sizes = registry.phase3_pool_sizes().await;
                        let empty_pools: Vec<u16> = pool_sizes
                            .iter()
                            .filter(|(_, size)| *size == 0)
                            .map(|(pid, _)| *pid)
                            .collect();
                        
                        // 检查是否有在线节点
                        let nodes = registry.nodes.read().await;
                        let online_nodes_count = nodes.values().filter(|n| n.online).count();
                        drop(nodes);
                        
                        // 只有在所有 Pool 都为空，且没有在线节点时，才触发重建
                        // 如果有在线节点，说明可能是动态创建的 Pool 暂时为空，不应该重建
                        if !empty_pools.is_empty() && empty_pools.len() == pool_sizes.len() && online_nodes_count == 0 {
                            info!(
                                empty_pools = empty_pools.len(),
                                empty_pool_ids = ?empty_pools,
                                online_nodes = online_nodes_count,
                                "检测到 {} 个空 Pool 且没有在线节点，触发重建",
                                empty_pools.len()
                            );
                            registry.rebuild_auto_language_pools(phase2_rt.clone()).await;
                        } else if !empty_pools.is_empty() {
                            debug!(
                                empty_pools = empty_pools.len(),
                                total_pools = pool_sizes.len(),
                                online_nodes = online_nodes_count,
                                "检测到 {} 个空 Pool，但有在线节点，跳过重建（可能是动态创建的 Pool）",
                                empty_pools.len()
                            );
                        } else {
                            debug!("未发现空 Pool，跳过重建");
                        }
                    }
                    _ = pool_config_check_interval.tick() => {
                        // Phase 2：定期从 Redis 拉取 Pool 配置
                        if let Some(rt) = phase2_rt.as_ref() {
                            let current_version = rt.get_pool_config_version().await;
                            
                            // 检查版本是否变化
                            if current_version != last_version {
                                if let Some((redis_pools, version)) = rt.get_pool_config().await {
                                    debug!(
                                        pool_count = redis_pools.len(),
                                        version = version,
                                        "检测到 Pool 配置更新，从 Redis 同步"
                                    );
                                    
                                    // 更新本地配置
                                    {
                                        let mut phase3 = registry.phase3.write().await;
                                        let old_count = phase3.pools.len();
                                        phase3.pools = redis_pools.clone();
                                        if old_count != redis_pools.len() {
                                            info!(
                                                old_pool_count = old_count,
                                                new_pool_count = redis_pools.len(),
                                                "Pool 配置已从 Redis 同步：{} -> {}",
                                                old_count,
                                                redis_pools.len()
                                            );
                                        }
                                    }
                                    
                                    // 重建 Pool 索引
                                    registry.rebuild_phase3_pool_index().await;
                                    registry.rebuild_phase3_core_cache().await;
                                    
                                    last_version = Some(version);
                                }
                            }
                            
                            // Leader 续约：如果当前实例是 leader，续约锁
                            if rt.is_pool_leader().await {
                                let renewed = rt.renew_pool_leader(POOL_LEADER_LOCK_TTL_SECONDS).await;
                                if renewed {
                                    debug!(
                                        instance_id = %rt.instance_id,
                                        "Pool Leader 锁续约成功"
                                    );
                                } else {
                                    warn!(
                                        instance_id = %rt.instance_id,
                                        "Pool Leader 锁续约失败"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        });
        info!(
            cleanup_interval = POOL_CLEANUP_SCAN_INTERVAL_SECONDS,
            sync_check_interval = POOL_CONFIG_SYNC_CHECK_INTERVAL_SECONDS,
            "Pool 定期清理任务已启动（每{}秒扫描一次，每{}秒检查 Redis 配置）",
            POOL_CLEANUP_SCAN_INTERVAL_SECONDS,
            POOL_CONFIG_SYNC_CHECK_INTERVAL_SECONDS
        );
    }
}

fn determine_pool_for_node(cfg: &crate::core::config::Phase3Config, n: &super::Node) -> Option<u16> {
    if cfg.pools.is_empty() {
        return None;
    }

    // 注意：自动生成模式下的节点分配在 phase3_upsert_node_to_pool_index 中处理
    // 这里只处理手动配置模式
    // 手动配置模式：按服务类型匹配
    // 收集所有匹配 pools（按类型匹配：node.installed_services.type 覆盖 pool.required_services）
    let mut matching: Vec<(u16, usize)> = Vec::new(); // (pool_id, specificity_len)
    for p in cfg.pools.iter() {
        if p.required_services.is_empty() {
            // 通配 pool：specificity=0；仅在没有更具体匹配时才会被选中
            matching.push((p.pool_id, 0));
            continue;
        }
        let ok = p
            .required_services
            .iter()
            .filter_map(|x| crate::messages::ServiceType::from_str(x).ok())
            .all(|t| n.installed_services.iter().any(|s| s.r#type == t));
        if ok {
            matching.push((p.pool_id, p.required_services.len()));
        }
    }
    if matching.is_empty() {
        return None;
    }
    if matching.len() == 1 {
        return Some(matching[0].0);
    }

    // 多个 pool 都匹配：
    // - 先选"更具体"的 pool（required_services 更长），避免"能力更全的节点"被分配到更通用的 pool（有利于强隔离）
    // - 若 specificity 相同（例如两个能力相同的 pools），再用 node_id 稳定 hash 分配（避免热点倾斜）
    let max_spec = matching.iter().map(|(_, s)| *s).max().unwrap_or(0);
    let mut best: Vec<u16> = matching
        .into_iter()
        .filter(|(_, s)| *s == max_spec)
        .map(|(pid, _)| pid)
        .collect();
    if best.len() == 1 {
        return Some(best[0]);
    }
    best.sort();
    let idx = crate::phase3::pick_index_for_key(best.len(), cfg.hash_seed, &n.node_id);
    Some(best[idx])
}
