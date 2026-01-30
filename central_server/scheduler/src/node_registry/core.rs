//! NodeRegistry - 简化的无锁实现
//!
//! 完全基于 Redis 直查，不维护任何本地状态

use crate::node_registry::{NodeData, NodeRedisRepository, NodeRegistrySimple, SchedNodeInfo};
use crate::redis_runtime::RedisHandle;
use crate::pool::PoolService;
use anyhow::Result;
use std::sync::Arc;
use tracing::info;

/// 节点注册表（无状态，Redis 直查）
/// 
/// 这是 NodeRegistry 的简化版本，删除了所有本地缓存和锁
#[derive(Clone)]
pub struct NodeRegistry {
    /// Redis 仓储层
    redis_repo: Arc<NodeRedisRepository>,
    
    /// 简化的查询接口
    simple_registry: NodeRegistrySimple,
    
    /// Pool 服务（使用内部可变性以支持后期关联）
    pool_service: Arc<tokio::sync::RwLock<Option<Arc<PoolService>>>>,
    
    /// 资源使用率阈值
    pub(crate) resource_threshold: f32,
}

impl NodeRegistry {
    /// 创建新的节点注册表
    /// 
    /// 需要传入 RedisHandle
    pub fn new(redis: Arc<RedisHandle>) -> Self {
        let redis_repo = Arc::new(NodeRedisRepository::new(redis.clone()));
        let simple_registry = NodeRegistrySimple::new(redis_repo.clone());
        
        info!("NodeRegistry 已初始化（Redis 直查模式）");
        
        Self {
            redis_repo,
            simple_registry,
            pool_service: Arc::new(tokio::sync::RwLock::new(None)),
            resource_threshold: 0.9, // 默认 90%
        }
    }
    
    /// 设置 PoolService（阶段2新增，使用内部可变性）
    pub async fn set_pool_service(&self, pool_service: Arc<PoolService>) {
        *self.pool_service.write().await = Some(pool_service);
        info!("NodeRegistry: 已关联 PoolService");
    }
    
    /// 获取 PoolService（内部使用）
    pub(crate) async fn pool_service(&self) -> Option<Arc<PoolService>> {
        self.pool_service.read().await.clone()
    }
    
    /// 设置资源阈值（兼容方法）
    pub fn set_resource_threshold(&mut self, threshold: f32) {
        self.resource_threshold = threshold;
    }
    
    // ==================== 内部访问器 ====================
    
    /// 获取 Redis 仓储层（供内部模块使用）
    pub(super) fn redis_repo(&self) -> &NodeRedisRepository {
        &self.redis_repo
    }
    
    // ==================== 查询接口 ====================
    
    /// 列出所有在线节点（供调度使用）
    pub async fn list_sched_nodes(&self) -> Result<Vec<SchedNodeInfo>> {
        self.simple_registry.list_sched_nodes().await
    }
    
    /// 查询节点数据（用于详细信息展示）
    pub async fn get_node_data(&self, node_id: &str) -> Result<Option<NodeData>> {
        self.redis_repo.get_node(node_id).await
    }
}
