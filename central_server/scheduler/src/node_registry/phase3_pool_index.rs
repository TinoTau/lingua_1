//! Phase 3 Pool 索引管理

use super::NodeRegistry;
use crate::phase2::Phase2Runtime;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

impl NodeRegistry {
    /// 重建 Pool 索引
    /// 如果提供了 phase2_runtime，只同步到 Redis；否则同时更新内存和 Redis（向后兼容）
    pub async fn rebuild_phase3_pool_index(&self, phase2_runtime: Option<&Phase2Runtime>) {
        let cfg = self.phase3.read().await.clone();
        let mut new_idx: HashMap<u16, HashSet<String>> = HashMap::new();
        let mut new_node_pool: HashMap<String, HashSet<u16>> = HashMap::new();
        if cfg.enabled && cfg.mode == "two_level" {
            // 优化：使用 ManagementRegistry 快速读取节点信息
            let node_clones: Vec<(String, super::Node)> = {
                let t0 = Instant::now();
                let mgmt = self.management_registry.read().await;
                crate::metrics::observability::record_lock_wait("node_registry.management_registry.read", t0.elapsed().as_millis() as u64);
                mgmt.nodes.iter().map(|(nid, state)| (nid.clone(), state.node.clone())).collect()
            };
            
            // 在锁外进行 Pool 分配计算（避免阻塞其他读操作）
            for (nid, n) in node_clones {
                let pool_ids: HashSet<u16> = if !cfg.pools.is_empty() {
                    if cfg.auto_generate_language_pools {
                        // 自动生成模式：支持多个 Pool
                        // 注意：determine_pools_for_node_auto_mode_with_index 现在是 async 函数
                        // 但在非 Phase2 模式下，无法从 Redis 读取能力信息
                        // 这里暂时返回空集合（因为无法检查节点能力）
                        HashSet::new()
                    } else {
                        // 手动配置模式：只返回一个 Pool
                        if let Some(pid) = super::phase3_pool_allocation::determine_pool_for_node(&cfg, &n) {
                            [pid].iter().cloned().collect()
                        } else {
                            HashSet::new()
                        }
                    }
                } else {
                    // 非自动生成模式：使用 hash 分配
                    [crate::phase3::pool_id_for_key(cfg.pool_count, cfg.hash_seed, &nid)].iter().cloned().collect()
                };
                if !pool_ids.is_empty() {
                    for pid in &pool_ids {
                        new_idx.entry(*pid).or_default().insert(nid.clone());
                    }
                    new_node_pool.insert(nid.clone(), pool_ids);
                }
            }
        }
        
        // 如果提供了 phase2_runtime，只同步到 Redis；否则同时更新内存和 Redis（向后兼容）
        if let Some(rt) = phase2_runtime {
            // 只同步到 Redis，不再更新内存索引
            rt.sync_all_pool_members_to_redis(&new_idx, &cfg.pools).await;
        } else {
            // 向后兼容：同时更新内存和 Redis（如果可能）
            let t0 = Instant::now();
            let mut idx = self.phase3_pool_index.write().await;
            crate::metrics::observability::record_lock_wait("node_registry.phase3_pool_index.write", t0.elapsed().as_millis() as u64);
            *idx = new_idx.clone();
            drop(idx);
            let t0 = Instant::now();
            let mut m = self.phase3_node_pool.write().await;
            crate::metrics::observability::record_lock_wait("node_registry.phase3_node_pool.write", t0.elapsed().as_millis() as u64);
            *m = new_node_pool;
        }
    }
    
    /// 获取 pool_index 的克隆（用于外部同步到 Redis）
    /// 如果提供了 phase2_runtime，从 Redis 读取；否则从内存读取（向后兼容）
    pub async fn phase3_pool_index_clone(&self, phase2_runtime: Option<&Phase2Runtime>) -> HashMap<u16, HashSet<String>> {
        if let Some(rt) = phase2_runtime {
            // 从 Redis 读取
            let cfg = self.phase3.read().await.clone();
            rt.get_all_pool_members_from_redis(&cfg.pools).await
        } else {
            // 向后兼容：从内存读取
            let idx = self.phase3_pool_index.read().await;
            idx.clone()
        }
    }

    /// 运维/调试：返回各 pool 的节点数（总数，包括 offline/registering；筛选在上层做）
    /// 如果提供了 phase2_runtime，从 Redis 读取；否则从内存读取（向后兼容）
    pub async fn phase3_pool_sizes(&self, phase2_runtime: Option<&Phase2Runtime>) -> Vec<(u16, usize)> {
        if let Some(rt) = phase2_runtime {
            // 从 Redis 读取
            let cfg = self.phase3.read().await.clone();
            let sizes = rt.get_pool_sizes_from_redis(&cfg.pools).await;
            let mut v: Vec<(u16, usize)> = sizes.into_iter().collect();
            v.sort_by_key(|(k, _)| *k);
            v
        } else {
            // 向后兼容：从内存读取
            let t0 = Instant::now();
            let idx = self.phase3_pool_index.read().await;
            crate::metrics::observability::record_lock_wait("node_registry.phase3_pool_index.read", t0.elapsed().as_millis() as u64);
            let mut v: Vec<(u16, usize)> = idx.iter().map(|(k, set)| (*k, set.len())).collect();
            v.sort_by_key(|(k, _)| *k);
            v
        }
    }
}
