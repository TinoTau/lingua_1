//! Phase 3 Pool 节点分配实现

use super::NodeRegistry;
use crate::phase2::Phase2Runtime;
use std::collections::HashSet;
use tracing::{debug, info, warn};
use crate::messages::NodeStatus;

impl NodeRegistry {
    // 已删除未使用的函数：phase3_upsert_node_to_pool_index
    // 此函数已被 phase3_upsert_node_to_pool_index_with_runtime 替代
    // 如果测试需要，请使用 phase3_upsert_node_to_pool_index_with_runtime(node_id, None)
    
    /// Phase 3：更新节点到 Pool 索引（支持传递 phase2_runtime 以从 Redis 读取配置）
    pub(crate) async fn phase3_upsert_node_to_pool_index_with_runtime(
        &self,
        node_id: &str,
        phase2_runtime: Option<&crate::phase2::Phase2Runtime>,
    ) {
        let mut cfg = self.phase3.read().await.clone();
        if !cfg.enabled || cfg.mode != "two_level" {
            return;
        }
        
        // 优化：快速检查节点当前 Pool 分配，如果节点已经在 Pool 中且状态正常，则跳过重新分配
        // 注意：需要检查节点的服务能力是否仍然有效，如果服务能力变化，需要重新分配
        {
            let current_pools = self.phase3_node_pool.read().await;
            if let Some(existing_pools) = current_pools.get(node_id) {
                if !existing_pools.is_empty() {
                    // 优化：使用 ManagementRegistry 快速读取节点信息
                    let node_clone = {
                        let mgmt = self.management_registry.read().await;
                        mgmt.nodes.get(node_id).map(|state| state.node.clone())
                    };
                    if let Some(n) = node_clone {
                        // 节点已经在 Pool 中，且在线且状态为 Ready
                        if n.online && n.status == NodeStatus::Ready {
                            // 优化：在锁外进行 Redis 查询，避免阻塞其他读操作
                            // 还需要检查节点的服务能力是否仍然有效（从 Redis 读取）
                            // 如果服务能力变化，需要重新分配
                            if let Some(rt) = phase2_runtime {
                                let has_asr = rt.has_node_capability(node_id, &crate::messages::ServiceType::Asr).await;
                                let has_nmt = rt.has_node_capability(node_id, &crate::messages::ServiceType::Nmt).await;
                                let has_tts = rt.has_node_capability(node_id, &crate::messages::ServiceType::Tts).await;
                                
                                // 如果所有必需的服务能力都有效，可以跳过重新分配
                                if has_asr && has_nmt && has_tts {
                                    debug!(
                                        node_id = %node_id,
                                        existing_pools = ?existing_pools,
                                        "节点已在 Pool 中且状态正常，服务能力有效，跳过重新分配（优化：减少不必要的 Redis 查询和锁竞争）"
                                    );
                                    return;
                                } else {
                                    debug!(
                                        node_id = %node_id,
                                        has_asr = has_asr,
                                        has_nmt = has_nmt,
                                        has_tts = has_tts,
                                        "节点服务能力变化，需要重新分配 Pool"
                                    );
                                }
                            } else {
                                // 如果没有 phase2_runtime，无法检查服务能力，继续执行重新分配
                                debug!(
                                    node_id = %node_id,
                                    "未提供 phase2_runtime，无法检查服务能力，继续执行 Pool 重新分配"
                                );
                            }
                        }
                    }
                }
            }
        }
        
        // 如果启用了 Phase2 且本地 Pool 配置为空，尝试从 Redis 读取
        if cfg.pools.is_empty() {
            if let Some(rt) = phase2_runtime {
                if let Some((redis_pools, version)) = rt.get_pool_config().await {
                    info!(
                        node_id = %node_id,
                        pool_count = redis_pools.len(),
                        version = version,
                        pool_names = ?redis_pools.iter().map(|p| &p.name).collect::<Vec<_>>(),
                        "本地 Pool 配置为空，从 Redis 读取配置"
                    );
                    // 更新本地配置
                    {
                        let mut phase3 = self.phase3.write().await;
                        phase3.pools = redis_pools.clone();
                    }
                    cfg.pools = redis_pools;
                } else {
                    warn!(
                        node_id = %node_id,
                        "本地 Pool 配置为空，Redis 中也没有配置"
                    );
                }
            } else {
                warn!(
                    node_id = %node_id,
                    "本地 Pool 配置为空，但未提供 phase2_runtime，无法从 Redis 读取"
                );
            }
        }
        
        let pool_ids: HashSet<u16> = if !cfg.pools.is_empty() {
            // 优化：使用 ManagementRegistry 快速读取节点信息
            let node_clone = {
                let mgmt = self.management_registry.read().await;
                match mgmt.nodes.get(node_id) {
                    Some(state) => Some(state.node.clone()),
                    None => {
                        warn!(node_id = %node_id, "节点不存在，无法分配 Pool");
                        return;
                    }
                }
            };
            let n = node_clone.as_ref().unwrap();
            
            // 优化：在锁外进行 Redis 查询，避免阻塞其他读操作
            // 检查节点状态和服务能力（从 Redis 读取）
            let (has_asr, has_nmt, has_tts) = if let Some(rt) = phase2_runtime {
                let has_asr = rt.has_node_capability(node_id, &crate::messages::ServiceType::Asr).await;
                let has_nmt = rt.has_node_capability(node_id, &crate::messages::ServiceType::Nmt).await;
                let has_tts = rt.has_node_capability(node_id, &crate::messages::ServiceType::Tts).await;
                (has_asr, has_nmt, has_tts)
            } else {
                warn!(
                    node_id = %node_id,
                    "未提供 Phase2Runtime，无法从 Redis 读取节点能力"
                );
                (false, false, false)
            };
            
            debug!(
                node_id = %node_id,
                online = n.online,
                status = ?n.status,
                has_language_capabilities = n.language_capabilities.is_some(),
                has_asr = has_asr,
                has_nmt = has_nmt,
                has_tts = has_tts,
                "开始 Pool 分配：检查节点状态和服务能力（从 Redis 读取）"
            );
            
            if cfg.auto_generate_language_pools {
                // 自动生成模式：使用语言能力匹配（支持多个 Pool）
                info!(node_id = %node_id, "使用自动生成模式分配 Pool");
                // 优化：在锁外获取 language_index，避免在锁内进行异步操作
                let language_index = self.language_capability_index.read().await;
                let matched_pools = super::phase3_pool_allocation::determine_pools_for_node_auto_mode_with_index(&cfg, n, &language_index, phase2_runtime).await;
                if !matched_pools.is_empty() {
                    info!(
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
                    drop(language_index);
                    // 传递 phase2_runtime 以便同步到 Redis
                    let new_pool_id = self.try_create_pool_for_node(node_id, phase2_runtime).await;
                    if let Some(pid) = new_pool_id {
                        info!(
                            node_id = %node_id,
                            pool_id = pid,
                            "成功为节点动态创建新 Pool {}",
                            pid
                        );
                        // 优化：快速克隆节点信息，立即释放锁，避免在持有锁时进行异步操作
                        // 创建新 Pool 后，重新读取配置并尝试匹配所有 Pool
                        let cfg_updated = self.phase3.read().await.clone();
                        let node_clone_retry = {
                            let mgmt = self.management_registry.read().await;
                            mgmt.nodes.get(node_id).map(|state| state.node.clone())
                        };
                        if let Some(n_updated) = node_clone_retry {
                            let language_index_updated = self.language_capability_index.read().await;
                            let matched_pools_retry = super::phase3_pool_allocation::determine_pools_for_node_auto_mode_with_index(&cfg_updated, &n_updated, &language_index_updated, phase2_runtime).await;
                            if !matched_pools_retry.is_empty() {
                                info!(
                                    node_id = %node_id,
                                    pool_count = matched_pools_retry.len(),
                                    pool_ids = ?matched_pools_retry,
                                    "创建新 Pool 后，节点成功匹配到 {} 个 Pool",
                                    matched_pools_retry.len()
                                );
                                matched_pools_retry.into_iter().collect()
                            } else {
                                warn!(
                                    node_id = %node_id,
                                    pool_id = pid,
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
                        warn!(
                            node_id = %node_id,
                            "节点未创建新 Pool（可能已达到上限或语言对已存在）"
                        );
                        HashSet::new()
                    }
                }
            } else {
                // 手动配置模式：使用服务类型匹配（仍然只返回一个 Pool）
                debug!(node_id = %node_id, "使用手动配置模式分配 Pool");
                if let Some(pid) = super::phase3_pool_allocation::determine_pool_for_node(&cfg, n) {
                    [pid].iter().cloned().collect()
                } else {
                    HashSet::new()
                }
            }
        } else {
            // 非自动生成模式：使用 hash 分配（仍然只返回一个 Pool）
            [crate::phase3::pool_id_for_key(cfg.pool_count, cfg.hash_seed, node_id)].iter().cloned().collect()
        };
        self.phase3_set_node_pools(node_id, pool_ids, phase2_runtime).await;
    }

    pub async fn phase3_remove_node_from_pool_index(&self, node_id: &str, phase2_runtime: Option<&Phase2Runtime>) {
        self.phase3_set_node_pool(node_id, None, phase2_runtime).await;
    }
}
