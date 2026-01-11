//! Phase 3 Pool 清理任务

use super::NodeRegistry;
use crate::phase2::Phase2Runtime;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, info, warn};

use super::phase3_pool_constants::{
    POOL_LEADER_LOCK_TTL_SECONDS,
    POOL_CONFIG_RETRY_DELAY_MS,
    POOL_CLEANUP_SCAN_INTERVAL_SECONDS,
    POOL_CONFIG_SYNC_CHECK_INTERVAL_SECONDS,
};

impl NodeRegistry {
    /// 重新生成自动语言 Pool（全量重建）
    /// 如果提供了 phase2_runtime，会尝试从 Redis 读取或写入 Pool 配置
    pub async fn rebuild_auto_language_pools(&self, phase2_runtime: Option<Arc<Phase2Runtime>>) {
        let cfg = self.phase3.read().await.clone();
        
        // 只在自动生成模式时执行
        if !cfg.auto_generate_language_pools {
            warn!("自动生成 Pool 未启用，跳过重建");
            return;
        }

        // Phase 2：如果启用了 Redis，尝试从 Redis 读取 Pool 配置
        if let Some(rt) = phase2_runtime.as_ref() {
            if let Some((redis_pools, version)) = rt.get_pool_config().await {
                // 【关键修复】如果 Redis 配置为空，不要清空本地配置
                if redis_pools.is_empty() {
                    warn!(
                        "Redis 中的 Pool 配置为空，保留本地配置（rebuild_auto_language_pools）"
                    );
                    // 不更新配置，直接返回
                    return;
                }
                
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
                
                // 【关键修复】同步 Pool 配置到 ManagementRegistry 和缓存
                // 这样 PoolLanguageIndex 才能正确更新，任务分配时才能找到 Pool 配置
                let cfg = self.phase3.read().await.clone();
                self.sync_phase3_config_to_management(cfg.clone()).await;
                self.update_phase3_config_cache(&cfg).await;
                
                // 重建 Pool 索引
                info!("开始重建 Pool 索引（从 Redis 配置）");
                self.rebuild_phase3_pool_index(phase2_runtime.as_ref().map(|rt| rt.as_ref())).await;
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
                
                // 【关键修复】如果生成的 pools 为空，不要清空现有配置
                if new_pools.is_empty() {
                    warn!(
                        "生成的 Pool 配置为空，保留现有配置（避免清空）"
                    );
                    return;
                }
                
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
                
                // 【关键修复】同步 Pool 配置到 ManagementRegistry 和缓存
                // 这样 PoolLanguageIndex 才能正确更新，任务分配时才能找到 Pool 配置
                let cfg = self.phase3.read().await.clone();
                self.sync_phase3_config_to_management(cfg.clone()).await;
                self.update_phase3_config_cache(&cfg).await;
                
                // 重建 Pool 索引
                info!("开始重建 Pool 索引");
                self.rebuild_phase3_pool_index(phase2_runtime.as_ref().map(|rt| rt.as_ref())).await;
                self.rebuild_phase3_core_cache().await;
                
                info!("Pool 索引重建完成");
                return;
            } else {
                // 不是 leader，等待一段时间后重试从 Redis 读取
                debug!("未能获取 Pool Leader 锁，等待其他实例生成配置");
                tokio::time::sleep(tokio::time::Duration::from_millis(POOL_CONFIG_RETRY_DELAY_MS)).await;
                
                // 再次尝试从 Redis 读取
                if let Some((redis_pools, version)) = rt.get_pool_config().await {
                    // 【关键修复】如果 Redis 配置为空，不要清空本地配置
                    if redis_pools.is_empty() {
                        warn!(
                            "Redis 中的 Pool 配置为空（重试后），保留本地配置，fallback 到本地生成"
                        );
                        // 继续到 fallback 逻辑
                    } else {
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
                        
                        // 【关键修复】同步 Pool 配置到 ManagementRegistry 和缓存
                        let cfg = self.phase3.read().await.clone();
                        self.sync_phase3_config_to_management(cfg.clone()).await;
                        self.update_phase3_config_cache(&cfg).await;
                        
                        // 重建 Pool 索引
                        info!("开始重建 Pool 索引（从 Redis 配置，重试成功）");
                        self.rebuild_phase3_pool_index(phase2_runtime.as_ref().map(|rt| rt.as_ref())).await;
                        self.rebuild_phase3_core_cache().await;
                        
                        info!("Pool 索引重建完成");
                        return;
                    }
                }
                
                // 如果仍然没有配置，fallback 到本地生成
                warn!("Redis 中仍然没有 Pool 配置，fallback 到本地生成");
            }
        }

        // Fallback：本地生成（单实例模式或 Redis 不可用）
        info!("开始重建自动语言 Pool（本地模式）");
        
        // 生成新的 pools
        let new_pools = self.auto_generate_language_pair_pools().await;
        
        // 【关键修复】如果生成的 pools 为空，不要清空现有配置
        if new_pools.is_empty() {
            warn!(
                "生成的 Pool 配置为空，保留现有配置（避免清空）"
            );
            return;
        }
        
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
        
        // 【关键修复】同步 Pool 配置到 ManagementRegistry 和缓存
        let cfg = self.phase3.read().await.clone();
        self.sync_phase3_config_to_management(cfg.clone()).await;
        self.update_phase3_config_cache(&cfg).await;
        
        // 重建 Pool 索引
        info!("开始重建 Pool 索引");
        self.rebuild_phase3_pool_index(phase2_runtime.as_ref().map(|rt| rt.as_ref())).await;
        self.rebuild_phase3_core_cache().await;
        
        // Phase 2: 同步所有 Pool 成员索引到 Redis（如果提供了 phase2_runtime）
        if let Some(rt) = phase2_runtime.as_ref() {
            let pool_index = self.phase3_pool_index_clone(Some(rt.as_ref())).await;
            let cfg = self.phase3.read().await.clone();
            rt.sync_all_pool_members_to_redis(&pool_index, &cfg.pools).await;
        }
        
        info!("Pool 索引重建完成");
    }
    
    /// 启动定期 Pool 清理任务（用于自动生成模式）
    /// 定期检查并清理空 Pool，重建 Pool 配置
    /// 如果提供了 phase2_runtime，会从 Redis 读取 Pool 配置
    pub fn start_pool_cleanup_task(self: &std::sync::Arc<Self>, phase2_runtime: Option<Arc<Phase2Runtime>>) {
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
                        // 使用 ManagementRegistry（统一管理锁）
                        let offline_nodes: Vec<String> = {
                            let mgmt = registry.management_registry.read().await;
                            mgmt.nodes
                                .iter()
                                .filter(|(_, state)| !state.node.online)
                                .map(|(id, _)| id.clone())
                                .collect()
                        };
                        
                        if !offline_nodes.is_empty() {
                            debug!(
                                offline_count = offline_nodes.len(),
                                "发现 {} 个离线节点，从 Pool 索引中移除",
                                offline_nodes.len()
                            );
                            let phase2_rt_ref = phase2_rt.as_ref().map(|rt| rt.as_ref());
                            for node_id in &offline_nodes {
                                registry.phase3_remove_node_from_pool_index(node_id, phase2_rt_ref).await;
                            }
                        }
                        
                        // 2. 检查空 Pool 并重建
                        // 注意：只有在所有 Pool 都为空，且没有在线节点时，才触发重建
                        // 这样可以避免清空动态创建的 Pool
                        let phase2_rt_ref = phase2_rt.as_ref().map(|rt| rt.as_ref());
                        let pool_sizes = registry.phase3_pool_sizes(phase2_rt_ref).await;
                        let empty_pools: Vec<u16> = pool_sizes
                            .iter()
                            .filter(|(_, size)| *size == 0)
                            .map(|(pid, _)| *pid)
                            .collect();
                        
                        // 检查是否有在线节点
                        // 使用 ManagementRegistry（统一管理锁）
                        let online_nodes_count = {
                            let mgmt = registry.management_registry.read().await;
                            mgmt.nodes.values().filter(|state| state.node.online).count()
                        };
                        
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
                                    // 【关键修复】如果 Redis 配置为空，不要清空本地配置
                                    if redis_pools.is_empty() {
                                        warn!(
                                            "Redis 中的 Pool 配置为空，保留本地配置（避免清空）"
                                        );
                                        continue;
                                    }
                                    
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
                                    
                                    // 【关键修复】同步 Pool 配置到 ManagementRegistry 和缓存
                                    let cfg = registry.phase3.read().await.clone();
                                    registry.sync_phase3_config_to_management(cfg.clone()).await;
                                    registry.update_phase3_config_cache(&cfg).await;
                                    
                                    // 重建 Pool 索引（清空后重新分配所有在线节点）
                                    registry.rebuild_phase3_pool_index(phase2_rt.as_ref().map(|rt| rt.as_ref())).await;
                                    registry.rebuild_phase3_core_cache().await;
                                    
                                    // 【关键修复】重新分配所有在线节点到 Pool（因为索引被清空了）
                                    // 使用 ManagementRegistry（统一管理锁）
                                    let online_node_ids: Vec<String> = {
                                        let mgmt = registry.management_registry.read().await;
                                        mgmt.nodes
                                            .iter()
                                            .filter(|(_, state)| state.node.online)
                                            .map(|(id, _)| id.clone())
                                            .collect()
                                    };
                                    
                                    if !online_node_ids.is_empty() {
                                        info!(
                                            online_node_count = online_node_ids.len(),
                                            "重新分配 {} 个在线节点到 Pool（Pool 配置已更新）",
                                            online_node_ids.len()
                                        );
                                        // 必须提供 phase2_runtime（产品可用性要求，不允许降级）
                                        if let Some(rt) = phase2_rt.as_ref() {
                                            for node_id in &online_node_ids {
                                                registry.phase3_upsert_node_to_pool_index_with_runtime(node_id, Some(rt.as_ref())).await;
                                            }
                                        } else {
                                            warn!(
                                                "Pool 配置更新后需要重新分配节点，但未提供 phase2_runtime，跳过节点重新分配"
                                            );
                                        }
                                    }
                                    
                                    // Phase 2: 同步所有 Pool 成员索引到 Redis
                                    let pool_index = registry.phase3_pool_index_clone(phase2_rt.as_ref().map(|rt| rt.as_ref())).await;
                                    let cfg = registry.phase3.read().await.clone();
                                    if let Some(rt) = phase2_rt.as_ref() {
                                        rt.sync_all_pool_members_to_redis(&pool_index, &cfg.pools).await;
                                    }
                                    
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
