//! Phase 3 Pool 创建逻辑

use super::NodeRegistry;
use crate::phase2::Phase2Runtime;
use std::collections::HashSet;
use tracing::{debug, info, warn};

use super::phase3_pool_constants::{
    POOL_LEADER_LOCK_TTL_SECONDS,
    POOL_CONFIG_RETRY_DELAY_MS,
};

impl NodeRegistry {
    /// 尝试为节点动态创建 Pool（如果节点的语言集合不在现有 Pool 中）
    /// 返回新创建的 Pool ID，如果不需要创建或创建失败则返回 None
    /// 如果提供了 phase2_runtime，会尝试同步 Pool 配置到 Redis（保持原子性）
    pub(super) async fn try_create_pool_for_node(
        &self, 
        node_id: &str,
        phase2_runtime: Option<&Phase2Runtime>,
    ) -> Option<u16> {
        // 使用 ManagementRegistry（统一管理锁）
        let node = {
            let mgmt = self.management_registry.read().await;
            mgmt.nodes.get(node_id).map(|state| state.node.clone())?
        };
        let language_index = self.language_capability_index.read().await;
        
        // 获取节点的语义修复服务支持的语言集合
        let semantic_langs: HashSet<String> = if let Some(ref caps) = node.language_capabilities {
            caps.semantic_languages.as_ref()
                .map(|v| v.iter().cloned().collect())
                .unwrap_or_default()
        } else {
            // 向后兼容：从 language_index 获取
            language_index.get_node_semantic_languages(&node.node_id)
        };
        
        if semantic_langs.is_empty() {
            debug!(
                node_id = %node_id,
                "节点没有语义修复服务支持的语言，无法创建 Pool"
            );
            return None;
        }
        
        // 排序语言集合（用于 Pool 命名）
        let mut sorted_langs: Vec<String> = semantic_langs.into_iter().collect();
        sorted_langs.sort();
        let pool_name = sorted_langs.join("-");
        
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
        
        // 检查节点的语言集合是否已经在现有 Pool 中
        let existing_pool_names: HashSet<String> = cfg.pools.iter()
            .map(|p| p.name.clone())
            .collect();
        
        if existing_pool_names.contains(&pool_name) {
            debug!(
                node_id = %node_id,
                pool_name = %pool_name,
                "节点的语言集合已存在于现有 Pool 中，无需创建新 Pool"
            );
            return None;
        }
        
        info!(
            node_id = %node_id,
            pool_name = %pool_name,
            languages = ?sorted_langs,
            "检测到节点支持新的语言集合，准备创建新 Pool"
        );
        
        // 计算新的 Pool ID（使用当前最大 Pool ID + 1）
        let next_pool_id = cfg.pools.iter()
            .map(|p| p.pool_id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        
        // 检查是否超过 max_pools 限制
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
        
        // 创建新的 Pool 配置（基于语言集合）
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
                // ASR 和 TTS 语言不限制（由节点端决定）
                asr_languages: None,
                tts_languages: None,
                // NMT 能力：支持语言集合内的任意语言对
                nmt_requirements: Some(crate::core::config::PoolNmtRequirements {
                    languages: sorted_langs.clone(),
                    rule: "any_to_any".to_string(),
                    supported_pairs: None, // 不限制具体语言对，由节点端决定
                    blocked_pairs: None,
                }),
                // 语义修复语言：Pool 的语言集合
                semantic_languages: Some(sorted_langs.clone()),
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
        
        // 如果启用 Phase 2，尝试同步 Pool 配置到 Redis（保持原子性）
        if let Some(rt) = phase2_runtime {
            // 读取当前配置（包含新创建的 Pool）
            let cfg = self.phase3.read().await.clone();
            
            // 尝试成为 Leader 并写入 Redis
            // 如果无法获取新锁，尝试续约现有锁（可能是同一个实例）
            let is_leader = rt.try_acquire_pool_leader(POOL_LEADER_LOCK_TTL_SECONDS).await
                || rt.renew_pool_leader(POOL_LEADER_LOCK_TTL_SECONDS).await;
            
            if is_leader {
                if rt.set_pool_config(&cfg.pools).await {
                    info!(
                        node_id = %node_id,
                        pool_id = next_pool_id,
                        pool_name = %pool_name,
                        pool_count = cfg.pools.len(),
                        "动态创建的 Pool 配置已同步到 Redis"
                    );
                } else {
                    warn!(
                        node_id = %node_id,
                        pool_id = next_pool_id,
                        pool_name = %pool_name,
                        "动态创建的 Pool 配置写入 Redis 失败，但继续使用本地配置"
                    );
                }
            } else {
                // 不是 Leader，等待一段时间后重试读取（可能其他实例已经创建了相同的 Pool）
                debug!(
                    node_id = %node_id,
                    pool_id = next_pool_id,
                    pool_name = %pool_name,
                    "未能获取 Pool Leader 锁，等待其他实例生成配置"
                );
                tokio::time::sleep(tokio::time::Duration::from_millis(POOL_CONFIG_RETRY_DELAY_MS)).await;
                
                // 再次尝试从 Redis 读取（可能其他实例已经创建了相同的 Pool）
                if let Some((redis_pools, _version)) = rt.get_pool_config().await {
                    // 检查 Redis 中是否已经有相同的 Pool
                    let redis_has_pool = redis_pools.iter().any(|p| p.name == pool_name);
                    if redis_has_pool {
                        info!(
                            node_id = %node_id,
                            pool_name = %pool_name,
                            "Redis 中已存在相同的 Pool（可能由其他实例创建），使用 Redis 配置"
                        );
                        // 更新本地配置为 Redis 配置（可能包含其他实例创建的 Pool）
                        let mut phase3 = self.phase3.write().await;
                        phase3.pools = redis_pools;
                    } else {
                        // Redis 中仍然没有，合并本地和 Redis 配置，然后尝试再次获取 Leader 锁并写入
                        debug!(
                            node_id = %node_id,
                            pool_name = %pool_name,
                            "Redis 中仍然没有相同的 Pool，合并配置后尝试再次获取 Leader 锁并写入"
                        );
                        // 合并本地配置（包含新创建的 Pool）和 Redis 配置
                        let mut merged_pools = redis_pools.clone();
                        // 添加本地新创建的 Pool（如果 Redis 中没有）
                        if !merged_pools.iter().any(|p| p.name == pool_name) {
                            merged_pools.push(new_pool.clone());
                        }
                        // 更新本地配置为合并后的配置
                        {
                            let mut phase3 = self.phase3.write().await;
                            phase3.pools = merged_pools.clone();
                        }
                        // 尝试再次获取 Leader 锁并写入（或续约现有锁）
                        let is_leader = rt.try_acquire_pool_leader(POOL_LEADER_LOCK_TTL_SECONDS).await
                            || rt.renew_pool_leader(POOL_LEADER_LOCK_TTL_SECONDS).await;
                        
                        if is_leader {
                            if rt.set_pool_config(&merged_pools).await {
                                info!(
                                    node_id = %node_id,
                                    pool_name = %pool_name,
                                    pool_count = merged_pools.len(),
                                    "重试后成功获取 Leader 锁并写入合并后的 Pool 配置"
                                );
                            }
                        } else {
                            // 仍然无法获取 Leader 锁，等待更长时间后重试（或续约现有锁）
                            tokio::time::sleep(tokio::time::Duration::from_millis(POOL_CONFIG_RETRY_DELAY_MS * 2)).await;
                            let is_leader = rt.try_acquire_pool_leader(POOL_LEADER_LOCK_TTL_SECONDS).await
                                || rt.renew_pool_leader(POOL_LEADER_LOCK_TTL_SECONDS).await;
                            
                            if is_leader {
                                let cfg = self.phase3.read().await.clone();
                                if rt.set_pool_config(&cfg.pools).await {
                                    info!(
                                        node_id = %node_id,
                                        pool_name = %pool_name,
                                        "最终重试后成功获取 Leader 锁并写入 Pool 配置"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // 【关键修复】同步 Pool 配置到 ManagementRegistry 和 SnapshotManager
        // 这样 PoolLanguageIndex 才能正确更新，调度时才能找到新创建的 Pool
        let cfg = self.phase3.read().await.clone();
        self.sync_phase3_config_to_management(cfg.clone()).await;
        
        // 【关键修复】更新 Phase3 配置缓存（任务分配时使用无锁读取）
        // 如果不更新缓存，get_phase3_config_cached() 仍然会返回旧的空配置
        self.update_phase3_config_cache(&cfg).await;
        
        // 重建 Pool 索引（将新节点添加到新 Pool）
        // 注意：这里不需要调用 rebuild_phase3_pool_index，因为 phase3_set_node_pool 会处理索引更新
        
        Some(next_pool_id)
    }
}
