//! 锁优化组件初始化和管理

use super::NodeRegistry;
use super::snapshot_manager::SnapshotManager;
use crate::core::config::{Phase3Config, CoreServicesConfig};

impl NodeRegistry {
    /// 获取或初始化快照管理器
    pub(crate) async fn get_or_init_snapshot_manager(&self) -> &SnapshotManager {
        self.snapshot_manager.get_or_init(|| async {
            SnapshotManager::new((*self.management_registry).clone()).await
        }).await
    }
    
    /// 同步节点到 ManagementRegistry（用于节点注册/更新）
    #[allow(dead_code)] // 目前未使用，节点注册使用 register_node_with_policy 直接操作
    pub async fn sync_node_to_management(&self, node_id: String, node: super::Node, pool_ids: Vec<u16>) {
        self.management_registry.update_node(node_id.clone(), node, pool_ids).await;
        let snapshot_manager = self.get_or_init_snapshot_manager().await;
        snapshot_manager.update_node_snapshot(&node_id).await;
    }
    
    /// 从 ManagementRegistry 移除节点
    #[allow(dead_code)] // 目前未使用，节点移除通过其他路径处理
    pub async fn remove_node_from_management(&self, node_id: &str) {
        self.management_registry.remove_node(node_id).await;
        let snapshot_manager = self.get_or_init_snapshot_manager().await;
        snapshot_manager.remove_node_snapshot(node_id).await;
    }
    
    /// 同步 Phase3 配置到 ManagementRegistry
    pub async fn sync_phase3_config_to_management(&self, config: Phase3Config) {
        self.management_registry.update_phase3_config(config).await;
        let snapshot_manager = self.get_or_init_snapshot_manager().await;
        snapshot_manager.update_lang_index_snapshot().await;
    }
    
    /// 同步核心服务配置到 ManagementRegistry
    pub async fn sync_core_services_to_management(&self, config: CoreServicesConfig) {
        self.management_registry.update_core_services(config).await;
    }
}
