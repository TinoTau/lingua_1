//! 版本号管理器
//! 
//! 负责管理本地缓存的版本号和全局版本号的同步

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, warn};

/// 缓存版本号跟踪
#[derive(Debug, Clone, Default)]
pub struct CacheVersions {
    /// 节点版本号映射（node_id -> version）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub nodes: HashMap<String, u64>,
    /// Phase3 配置版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub phase3_config: Option<u64>,
    /// 语言索引版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub lang_index: Option<u64>,
    /// 全局版本号（用于快速检查是否有更新）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub global_nodes_version: u64,
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub global_config_version: u64,
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub global_index_version: u64,
}

impl CacheVersions {
    pub fn new() -> Self {
        Self::default()
    }

    /// 更新节点版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub fn update_node_version(&mut self, node_id: &str, version: u64) {
        self.nodes.insert(node_id.to_string(), version);
    }

    /// 获取节点版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub fn get_node_version(&self, node_id: &str) -> Option<u64> {
        self.nodes.get(node_id).copied()
    }

    /// 移除节点版本号（节点已下线）
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub fn remove_node_version(&mut self, node_id: &str) {
        self.nodes.remove(node_id);
    }

    /// 更新全局版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub fn update_global_version(&mut self, entity_type: &str, version: u64) {
        match entity_type {
            "nodes" => {
                self.global_nodes_version = version;
            }
            "config" => {
                self.global_config_version = version;
                self.phase3_config = Some(version);
            }
            "index" => {
                self.global_index_version = version;
                self.lang_index = Some(version);
            }
            _ => {
                warn!(entity_type = %entity_type, "未知的实体类型");
            }
        }
    }

    /// 检查节点版本号是否已过期
    /// 
    /// 返回: true 表示需要刷新，false 表示缓存有效
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub fn is_node_stale(&self, node_id: &str, current_version: Option<u64>) -> bool {
        let cached_version = self.get_node_version(node_id);
        match (cached_version, current_version) {
            (Some(cached), Some(current)) => cached < current,
            (None, Some(_)) => true, // 缓存不存在，需要刷新
            (Some(_), None) => false, // 当前版本不存在，使用缓存
            (None, None) => false, // 都不存在，无需刷新
        }
    }
}

/// 版本号管理器
/// 
/// 负责管理本地缓存的版本号和全局版本号的同步
#[derive(Clone)]
pub struct VersionManager {
    versions: Arc<RwLock<CacheVersions>>,
}

impl VersionManager {
    pub fn new() -> Self {
        Self {
            versions: Arc::new(RwLock::new(CacheVersions::new())),
        }
    }

    /// 获取节点版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn get_node_version(&self, node_id: &str) -> Option<u64> {
        let versions = self.versions.read().await;
        versions.get_node_version(node_id)
    }

    /// 更新节点版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn update_node_version(&self, node_id: &str, version: u64) {
        let mut versions = self.versions.write().await;
        versions.update_node_version(node_id, version);
        debug!(node_id = %node_id, version = version, "更新节点版本号");
    }

    /// 移除节点版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn remove_node_version(&self, node_id: &str) {
        let mut versions = self.versions.write().await;
        versions.remove_node_version(node_id);
        debug!(node_id = %node_id, "移除节点版本号");
    }

    /// 更新全局版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn update_global_version(&self, entity_type: &str, version: u64) {
        let mut versions = self.versions.write().await;
        versions.update_global_version(entity_type, version);
        debug!(entity_type = %entity_type, version = version, "更新全局版本号");
    }

    /// 检查节点版本号是否已过期
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn is_node_stale(&self, node_id: &str, current_version: Option<u64>) -> bool {
        let versions = self.versions.read().await;
        versions.is_node_stale(node_id, current_version)
    }

    /// 获取全局版本号
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn get_global_version(&self, entity_type: &str) -> u64 {
        let versions = self.versions.read().await;
        match entity_type {
            "nodes" => versions.global_nodes_version,
            "config" => versions.global_config_version,
            "index" => versions.global_index_version,
            _ => 0,
        }
    }
}

impl Default for VersionManager {
    fn default() -> Self {
        Self::new()
    }
}
