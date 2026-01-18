//! 无锁缓存管理器
//! 
//! 实现两级缓存（L1/L2）和版本号管理的无锁架构

use super::redis_client::LocklessRedisClient;
use super::pubsub::PubSubHandler;
use super::version_manager::VersionManager;
use super::degradation::{DegradationManager, DegradeMode};
use super::serialization::{RedisNodeData, RedisPhase3Config};
use crate::node_registry::runtime_snapshot::{NodeRuntimeSnapshot, NodeHealth};
use crate::core::config::{Phase3Config, CoreServicesConfig};
use crate::node_registry::pool_language_index::PoolLanguageIndex;
use crate::messages::ServiceType;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn, error};
use std::time::{Duration, Instant};
use futures_util::future;

/// 缓存的节点快照（L1 缓存）
#[derive(Debug, Clone)]
#[allow(dead_code)] // 将在后续实现中使用
pub(crate) struct CachedNodeSnapshot {
    pub(crate) snapshot: NodeRuntimeSnapshot,
    pub(crate) version: u64,
    pub(crate) cached_at_ms: i64,
    /// L1 缓存过期时间（毫秒）
    pub(crate) l1_ttl_ms: i64,
}

/// 缓存的 Phase3 配置
#[derive(Debug, Clone)]
#[allow(dead_code)] // 将在后续实现中使用
struct CachedPhase3Config {
    config: Arc<Phase3Config>,
    version: u64,
    cached_at_ms: i64,
}

/// 缓存的 CoreServices 配置
#[derive(Debug, Clone)]
#[allow(dead_code)] // 将在后续实现中使用
struct CachedCoreServicesConfig {
    config: Arc<CoreServicesConfig>,
    version: u64,
    cached_at_ms: i64,
}

/// 缓存的语言索引
#[derive(Debug, Clone)]
#[allow(dead_code)] // 将在后续实现中使用
struct CachedLangIndex {
    index: Arc<PoolLanguageIndex>,
    version: u64,
    cached_at_ms: i64,
}

/// 无锁缓存配置
#[derive(Debug, Clone)]
#[allow(dead_code)] // 将在后续实现中使用
pub struct LocklessCacheConfig {
    /// L1 缓存过期时间（毫秒）
    pub l1_cache_ttl_ms: i64,
    /// L2 缓存过期时间（毫秒）
    pub l2_cache_ttl_ms: i64,
    /// 版本号检查超时时间（毫秒）
    pub version_check_timeout_ms: u64,
    /// Redis 超时阈值（毫秒）
    pub redis_timeout_threshold_ms: u64,
    /// 随机 TTL 范围（毫秒，用于防止缓存雪崩）
    pub random_ttl_range_ms: u64,
}

impl Default for LocklessCacheConfig {
    fn default() -> Self {
        Self {
            l1_cache_ttl_ms: 5000,      // 5 秒
            l2_cache_ttl_ms: 30000,     // 30 秒
            version_check_timeout_ms: 50, // 50 毫秒
            redis_timeout_threshold_ms: 100, // 100 毫秒
            random_ttl_range_ms: 1000,  // 1 秒随机范围（防止缓存雪崩）
        }
    }
}

/// 无锁缓存管理器
/// 
/// 实现两级缓存（L1/L2）和版本号管理的无锁架构
#[derive(Clone)]
#[allow(dead_code)] // 将在后续实现中使用
pub struct LocklessCache {
    /// L1 缓存：节点快照（DashMap 是无锁并发 HashMap）
    pub(crate) l1_nodes: Arc<DashMap<String, CachedNodeSnapshot>>,
    
    /// L2 缓存：节点快照（延迟缓存，使用 RwLock）
    pub(crate) l2_nodes: Arc<RwLock<std::collections::HashMap<String, CachedNodeSnapshot>>>,
    
    /// 配置缓存（很少更新，使用 RwLock）
    phase3_config: Arc<RwLock<Option<CachedPhase3Config>>>,
    core_services: Arc<RwLock<Option<CachedCoreServicesConfig>>>,
    
    /// 语言索引缓存
    lang_index: Arc<RwLock<Option<CachedLangIndex>>>,
    
    /// 版本号管理器
    pub(crate) version_manager: VersionManager,
    
    /// Redis 客户端
    pub(crate) redis_client: LocklessRedisClient,
    
    /// 发布/订阅处理器
    pubsub_handler: Arc<RwLock<Option<PubSubHandler>>>,
    
    /// 降级管理器
    degradation_manager: DegradationManager,
    
    /// 配置
    pub(crate) config: LocklessCacheConfig,
}

impl LocklessCache {
    /// 创建新的无锁缓存管理器
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn new(
        redis_client: LocklessRedisClient,
        config: LocklessCacheConfig,
    ) -> anyhow::Result<Self> {
        let degradation_manager = DegradationManager::new(config.redis_timeout_threshold_ms);
        
        let cache = Self {
            l1_nodes: Arc::new(DashMap::new()),
            l2_nodes: Arc::new(RwLock::new(std::collections::HashMap::new())),
            phase3_config: Arc::new(RwLock::new(None)),
            core_services: Arc::new(RwLock::new(None)),
            lang_index: Arc::new(RwLock::new(None)),
            version_manager: VersionManager::new(),
            redis_client,
            pubsub_handler: Arc::new(RwLock::new(None)),
            degradation_manager: degradation_manager.clone(),
            config: config.clone(),
        };

        // 版本号检查已在 get_node() 中异步执行，无需额外的 Pub/Sub
        // 心跳更新时直接更新本地缓存，保证最终一致性

        Ok(cache)
    }

    /// 获取节点快照（完全无锁读取路径）
    /// 
    /// 流程：
    /// 1. 检查 L1 缓存（DashMap，无锁）
    /// 2. 异步检查版本号（非阻塞，超时 50ms）
    /// 3. 如果版本号匹配，直接返回（最快路径）
    /// 4. 如果版本号不匹配或缓存未命中，从 Redis 刷新（带穿透保护）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn get_node(&self, node_id: &str) -> Option<NodeRuntimeSnapshot> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        
        // 步骤 1: 检查 L1 缓存（DashMap 无锁读取）
        if let Some(cached) = self.l1_nodes.get(node_id) {
            // 检查 L1 缓存是否过期（使用随机 TTL 防止雪崩）
            if now_ms <= cached.cached_at_ms + cached.l1_ttl_ms {
                // L1 缓存未过期，异步检查版本号（非阻塞）
                let version_check_future = self.redis_client.get_node_version(node_id);
                let cached_version = cached.version;
                
                tokio::select! {
                    version_result = version_check_future => {
                        match version_result {
                            Ok(Some(current_version)) if cached_version >= current_version => {
                                // 缓存有效，直接返回（最常见情况）
                                return Some(cached.snapshot.clone());
                            }
                    Ok(_) => {
                        // 版本号不匹配或节点不存在，需要刷新
                        debug!(node_id = %node_id, cached_version = cached_version, "L1 缓存版本号不匹配，需要刷新");
                    }
                    Err(_e) => {
                        // Redis 错误，使用缓存（降级策略）
                        self.degradation_manager.record_redis_error(1000).await;
                        return Some(cached.snapshot.clone());
                    }
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_millis(self.config.version_check_timeout_ms)) => {
                        // 版本号检查超时，使用缓存（最终一致性）
                        return Some(cached.snapshot.clone());
                    }
                }
            }
        }

        // 步骤 2: 检查 miss 标记（防止穿透）
        let miss_key = format!("scheduler:miss:{{node:{}}}", node_id);
        match self.redis_client.get_handle().exists(&miss_key).await {
            Ok(true) => {
                debug!(node_id = %node_id, "节点 miss 标记存在，跳过 Redis 查询");
                return None;
            }
            Ok(false) => {
                // miss 标记不存在，继续查询
            }
            Err(e) => {
                debug!(error = %e, node_id = %node_id, "检查 miss 标记失败，继续查询");
            }
        }

        // 步骤 3: 检查降级模式
        let degrade_mode = self.degradation_manager.get_mode().await;
        if degrade_mode == DegradeMode::LocalOnly {
            return self.l1_nodes.get(node_id).map(|c| c.snapshot.clone());
        }

        // 步骤 4: 从 Redis 刷新（如果 L2Only 模式，先检查 L2）
        if degrade_mode == DegradeMode::L2Only {
            if let Some(cached) = self.check_l2_cache(node_id).await {
                return Some(cached);
            }
        }

        // 步骤 5: 从 Redis 刷新
        self.refresh_node_from_redis(node_id).await
    }

    /// 检查 L2 缓存（降级模式使用，简化实现）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    async fn check_l2_cache(&self, node_id: &str) -> Option<NodeRuntimeSnapshot> {
        let l2_cache = self.l2_nodes.read().await;
        let now_ms = chrono::Utc::now().timestamp_millis();
        l2_cache.get(node_id)
            .filter(|cached| now_ms - cached.cached_at_ms <= self.config.l2_cache_ttl_ms)
            .map(|cached| cached.snapshot.clone())
    }

    /// 从 Redis 刷新节点数据（带缓存穿透保护）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub(crate) async fn refresh_node_from_redis(&self, node_id: &str) -> Option<NodeRuntimeSnapshot> {
        let start = Instant::now();
        
        // 从 Redis 读取节点数据
        let node_data_result = self.redis_client.get_node_data(node_id).await;
        
        let elapsed = start.elapsed();
        let elapsed_ms = elapsed.as_millis().min(u64::MAX as u128) as u64;
        
        // 记录 Redis 性能指标并更新降级状态
        if elapsed_ms > self.config.redis_timeout_threshold_ms {
            self.degradation_manager.record_redis_error(elapsed_ms).await;
        } else {
            self.degradation_manager.record_redis_success().await;
        }

        let node_data_str = match node_data_result {
            Ok(Some(data)) => data,
            Ok(None) => {
                // 节点不存在（可能已下线），写入 miss 标记防止穿透
                debug!(node_id = %node_id, "节点不存在于 Redis，写入 miss 标记");
                let miss_key = format!("scheduler:miss:{{node:{}}}", node_id);
                let miss_ttl = (self.config.random_ttl_range_ms.min(10) as i64).max(1);
                let _ = self.redis_client.get_handle().set_ex_string(
                    &miss_key,
                    "1",
                    miss_ttl as u64,
                ).await;
                
                // 清理本地缓存
                self.l1_nodes.remove(node_id);
                self.l2_nodes.write().await.remove(node_id);
                self.version_manager.remove_node_version(node_id).await;
                return None;
            }
            Err(e) => {
                error!(error = %e, node_id = %node_id, "从 Redis 读取节点数据失败");
                // 降级到 L2 缓存（如果可用）
                let degrade_mode = self.degradation_manager.get_mode().await;
                if degrade_mode == DegradeMode::L2Only || degrade_mode == DegradeMode::LocalOnly {
                    return self.check_l2_cache(node_id).await;
                }
                return None;
            }
        };

        // 解析 JSON
        let node_data: RedisNodeData = match serde_json::from_str(&node_data_str) {
            Ok(data) => data,
            Err(e) => {
                error!(error = %e, node_id = %node_id, "解析节点数据失败");
                return None;
            }
        };

        // 转换为 NodeRuntimeSnapshot
        let snapshot = match node_data.to_snapshot() {
            Some(s) => s,
            None => {
                warn!(node_id = %node_id, "无法将 Redis 数据转换为快照");
                return None;
            }
        };

        // 更新本地缓存（L1 和 L2，使用随机 TTL 防止雪崩）
        let now_ms = chrono::Utc::now().timestamp_millis();
        let random_offset = (node_id.len() as i64) % (self.config.random_ttl_range_ms as i64);
        let effective_ttl = self.config.l1_cache_ttl_ms + random_offset;
        
        let cached = CachedNodeSnapshot {
            snapshot: snapshot.clone(),
            version: node_data.version,
            cached_at_ms: now_ms,
            l1_ttl_ms: effective_ttl,
        };

        // 更新 L1 缓存（无锁写入）
        self.l1_nodes.insert(node_id.to_string(), cached.clone());
        
        // 同时更新 L2 缓存（降级模式使用）
        self.l2_nodes.write().await.insert(node_id.to_string(), cached);

        // 更新版本号管理器
        self.version_manager.update_node_version(node_id, node_data.version).await;

        info!(
            node_id = %node_id,
            version = node_data.version,
            elapsed_ms = elapsed_ms,
            effective_ttl_ms = effective_ttl,
            "从 Redis 刷新节点数据成功"
        );

        Some(snapshot)
    }

    /// 批量获取节点快照
    /// 
    /// 用于 Pool 内节点选择，并行获取多个节点的快照
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn get_nodes_batch(&self, node_ids: &[String]) -> Vec<NodeRuntimeSnapshot> {
        // 并行获取所有节点快照（DashMap 支持并发读取）
        future::join_all(node_ids.iter().map(|node_id| self.get_node(node_id)))
            .await
            .into_iter()
            .flatten()
            .collect()
    }

    /// 从指定 Pool 中选择节点（无锁读取）
    /// 
    /// 流程：
    /// 1. 从 Redis 获取 Pool 成员列表（Set）
    /// 2. 并行获取所有节点的快照（DashMap 无锁读取）
    /// 3. 过滤符合条件的节点（本地过滤，无锁）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn select_nodes_for_pool(
        &self,
        pool_id: u16,
        required_types: &[ServiceType],
    ) -> Vec<NodeRuntimeSnapshot> {
        // 步骤 1: 从 Redis 获取 Pool 成员列表
        let member_ids = match self.redis_client.get_pool_members(pool_id).await {
            Ok(ids) if !ids.is_empty() => ids,
            Ok(_) => {
                debug!(pool_id = pool_id, "Pool 成员列表为空");
                return vec![];
            }
            Err(e) => {
                warn!(error = %e, pool_id = pool_id, "从 Redis 获取 Pool 成员失败");
                return vec![];
            }
        };

        // 步骤 2: 并行获取所有节点的快照并过滤（本地过滤，无锁）
        self.get_nodes_batch(&member_ids).await
            .into_iter()
            .filter(|node| self.matches_requirements(node, required_types))
            .collect()
    }

    /// 检查节点是否满足要求（无锁本地检查）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    fn matches_requirements(&self, node: &NodeRuntimeSnapshot, required_types: &[ServiceType]) -> bool {
        // 检查节点健康状态
        if node.health != NodeHealth::Online {
            return false;
        }

        // 检查并发限制
        if node.current_jobs >= node.max_concurrency as usize {
            return false;
        }

        // 检查服务类型支持（从本地缓存读取，无锁）
        for service_type in required_types {
            if !node.installed_services.iter().any(|s| s.r#type == *service_type) {
                return false;
            }
        }

        true
    }

    /// 获取 Phase3 配置（无锁读取）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn get_phase3_config(&self) -> Option<Arc<Phase3Config>> {
        // 检查本地缓存
        {
            let cached = self.phase3_config.read().await;
            if let Some(ref config) = *cached {
                let now_ms = chrono::Utc::now().timestamp_millis();
                if now_ms - config.cached_at_ms <= self.config.l2_cache_ttl_ms {
                    // 异步检查版本号（不阻塞）
                    let version_check_future = self.redis_client.get_global_version("config");
                    tokio::select! {
                        version_result = version_check_future => {
                            if let Ok(Some(current_version)) = version_result {
                                if config.version >= current_version {
                                    return Some(config.config.clone());
                                }
                            }
                        }
                        _ = tokio::time::sleep(Duration::from_millis(self.config.version_check_timeout_ms)) => {
                            // 超时，使用缓存数据
                            return Some(config.config.clone());
                        }
                    }
                }
            }
        }

        // 从 Redis 刷新
        self.refresh_phase3_config_from_redis().await
    }

    /// 从 Redis 刷新 Phase3 配置
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    async fn refresh_phase3_config_from_redis(&self) -> Option<Arc<Phase3Config>> {
        let config_str = match self.redis_client.get_phase3_config().await {
            Ok(Some(s)) => s,
            Ok(None) => {
                warn!("Phase3 配置不存在于 Redis");
                return None;
            }
            Err(e) => {
                error!(error = %e, "从 Redis 读取 Phase3 配置失败");
                // 降级到本地缓存
                let cached = self.phase3_config.read().await;
                return cached.as_ref().map(|c| c.config.clone());
            }
        };

        let redis_config: RedisPhase3Config = match serde_json::from_str(&config_str) {
            Ok(c) => c,
            Err(e) => {
                error!(error = %e, "解析 Phase3 配置失败");
                return None;
            }
        };

        // 更新本地缓存
        {
            let mut cached = self.phase3_config.write().await;
            *cached = Some(CachedPhase3Config {
                config: Arc::new(redis_config.config.clone()),
                version: redis_config.version,
                cached_at_ms: chrono::Utc::now().timestamp_millis(),
            });
        }

        // 更新版本号管理器
        self.version_manager.update_global_version("config", redis_config.version).await;

        Some(Arc::new(redis_config.config))
    }
}

// 节点写入路径的方法在 node_write.rs 中实现
// 包括：update_node_heartbeat, register_node, remove_node 等
