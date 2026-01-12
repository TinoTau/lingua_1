//! Phase 3 Pool 成员管理

use super::NodeRegistry;
use crate::phase2::Phase2Runtime;
use crate::messages::NodeStatus;
use std::collections::HashSet;
use std::time::Instant;
use tracing::{debug, info, warn};

impl NodeRegistry {
    /// Phase 3：更新 node -> pools 的归属（同时维护 pool_index）
    /// - desired 为空：从所有 pool_index 中移除该节点
    /// - 一个节点可以属于多个 Pool
    /// 如果提供了 phase2_runtime，只更新 Redis；否则同时更新内存和 Redis（向后兼容）
    pub(super) async fn phase3_set_node_pools(&self, node_id: &str, desired: HashSet<u16>, phase2_runtime: Option<&Phase2Runtime>) {
        // 先更新 node->pools 映射，拿到 old
        let t0 = Instant::now();
        let mut m = self.phase3_node_pool.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_node_pool.write", t0.elapsed().as_millis() as u64);
        let old: HashSet<u16> = m.remove(node_id).unwrap_or_default();
        let is_new_allocation = old.is_empty() && !desired.is_empty();
        
        // 如果 Pool 分配未变化，跳过更新
        if old == desired {
            debug!(
                node_id = %node_id,
                pool_ids = ?desired,
                "节点 Pool 分配未变化，跳过更新"
            );
            // 仍然需要将节点放回映射中
            if !desired.is_empty() {
                m.insert(node_id.to_string(), desired);
            }
            return;
        }
        
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
        // 同时更新 ManagementRegistry 中的 Pool 分配
        {
            let mut mgmt = self.management_registry.write().await;
            if let Some(node_state) = mgmt.nodes.get_mut(node_id) {
                if is_new_allocation && node_state.node.status == NodeStatus::Registering {
                    node_state.node.status = NodeStatus::Ready;
                    info!(
                        node_id = %node_id,
                        pool_count = desired.len(),
                        "节点状态从 Registering 更新为 Ready（已分配到 {} 个 Pool）",
                        desired.len()
                    );
                }
                // 更新 Pool 分配
                node_state.pool_ids = desired.iter().cloned().collect();
            }
        }

        // 更新 pool_index：如果提供了 phase2_runtime，只更新 Redis；否则同时更新内存和 Redis
        if let Some(rt) = phase2_runtime {
            // 只更新 Redis，不再更新内存索引
            let cfg = self.phase3.read().await.clone();
            
            // 从旧的 Pool 中移除节点
            for old_pid in &old {
                if !desired.contains(old_pid) {
                    if let Some(pool_config) = cfg.pools.iter().find(|p| p.pool_id == *old_pid) {
                        // 从 Redis 读取当前 Pool 的所有成员，移除该节点，再写回
                        if let Some(mut members) = rt.get_pool_members_from_redis(&pool_config.name).await {
                            members.remove(node_id);
                            let _ = rt.sync_pool_members_to_redis(&pool_config.name, &members).await;
                        }
                    }
                }
            }
            
            // 添加到新的 Pool 中
            for new_pid in &desired {
                if !old.contains(new_pid) {
                    if let Some(pool_config) = cfg.pools.iter().find(|p| p.pool_id == *new_pid) {
                        // 从 Redis 读取当前 Pool 的所有成员，添加该节点，再写回
                        let mut members = rt.get_pool_members_from_redis(&pool_config.name).await.unwrap_or_default();
                        members.insert(node_id.to_string());
                        let _ = rt.sync_pool_members_to_redis(&pool_config.name, &members).await;
                    } else {
                        // 如果找不到 Pool 配置，记录警告（可能是动态创建的 Pool，配置还未同步）
                        warn!(
                            node_id = %node_id,
                            pool_id = new_pid,
                            "无法找到 Pool 配置，节点可能无法正确添加到 Redis。请确保 Pool 配置已同步到 Redis"
                        );
                    }
                }
            }
        } else {
            // 向后兼容：同时更新内存和 Redis（如果可能）
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
    }
    
    /// Phase 3：更新 node -> pool 的归属（向后兼容，只设置一个 Pool）
    /// 注意：此方法已废弃，建议使用 phase3_set_node_pools
    pub(super) async fn phase3_set_node_pool(&self, node_id: &str, desired: Option<u16>, phase2_runtime: Option<&Phase2Runtime>) {
        let pool_ids: HashSet<u16> = desired.map(|pid| [pid].iter().cloned().collect()).unwrap_or_default();
        self.phase3_set_node_pools(node_id, pool_ids, phase2_runtime).await;
    }

    /// 获取节点所属的所有 Pool ID（支持一个节点属于多个 Pool）
    pub async fn phase3_node_pool_ids(&self, node_id: &str) -> HashSet<u16> {
        let t0 = Instant::now();
        let m = self.phase3_node_pool.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.phase3_node_pool.read", t0.elapsed().as_millis() as u64);
        m.get(node_id).cloned().unwrap_or_default()
    }
    
    // 已删除未使用的函数：phase3_node_pool_id
    // 此函数已被 phase3_node_pool_ids 替代
    // 如果测试需要，请使用 phase3_node_pool_ids(node_id).await.into_iter().next()

    /// 运维/调试：返回 pool 内示例节点 ID（最多 limit 个）
    /// 如果提供了 phase2_runtime，从 Redis 读取；否则从内存读取（向后兼容）
    pub async fn phase3_pool_sample_node_ids(&self, pool_id: u16, limit: usize, phase2_runtime: Option<&Phase2Runtime>) -> Vec<String> {
        if let Some(rt) = phase2_runtime {
            // 从 Redis 读取
            let cfg = self.phase3.read().await.clone();
            if let Some(pool_config) = cfg.pools.iter().find(|p| p.pool_id == pool_id) {
                rt.get_pool_sample_node_ids_from_redis(&pool_config.name, limit).await
            } else {
                vec![]
            }
        } else {
            // 向后兼容：从内存读取
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
    }
}
