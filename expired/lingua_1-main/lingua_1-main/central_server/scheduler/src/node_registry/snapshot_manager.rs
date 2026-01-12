//! 快照管理器
//! 
//! 负责从 ManagementState 更新 RuntimeSnapshot（COW 模式）

use super::management_state::ManagementRegistry;
use super::runtime_snapshot::{RuntimeSnapshot, build_node_snapshot, NodeRuntimeMap};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// 快照管理器
/// 负责维护 RuntimeSnapshot 与 ManagementState 的同步
#[derive(Clone)]
pub struct SnapshotManager {
    /// 管理注册表（数据源）
    management: ManagementRegistry,
    /// 运行时快照（只读，通过 COW 更新）
    snapshot: Arc<RwLock<RuntimeSnapshot>>,
}

impl SnapshotManager {
    /// 创建新的快照管理器
    pub async fn new(management: ManagementRegistry) -> Self {
        let lang_index = {
            let state = management.read().await;
            state.lang_index.clone()
        };
        
        let snapshot = RuntimeSnapshot::new(lang_index);
        
        Self {
            management,
            snapshot: Arc::new(RwLock::new(snapshot)),
        }
    }

    /// 获取运行时快照（读锁）
    pub async fn get_snapshot(&self) -> tokio::sync::RwLockReadGuard<'_, RuntimeSnapshot> {
        self.snapshot.read().await
    }

    /// 更新快照（从 ManagementState 重建）
    #[allow(dead_code)] // 目前未使用，使用增量更新 update_node_snapshot
    pub async fn update_snapshot(&self) {
        let start = std::time::Instant::now();
        
        // 从 ManagementState 读取数据
        let state = self.management.read().await;
        
        // 构建节点快照映射
        let mut node_map = NodeRuntimeMap::new();
        for (node_id, node_state) in &state.nodes {
            let snapshot = build_node_snapshot(
                node_id.clone(),
                &node_state.node,
                &node_state.pool_ids,
            );
            node_map.insert(node_id.clone(), Arc::new(snapshot));
        }
        
        // 更新快照（COW 模式）
        let mut snapshot = self.snapshot.write().await;
        snapshot.update_nodes(node_map);
        snapshot.update_lang_index(state.lang_index.clone());
        
        let elapsed = start.elapsed();
        info!(
            node_count = snapshot.nodes.len(),
            snapshot_version = snapshot.version,
            elapsed_ms = elapsed.as_millis(),
            "快照更新完成"
        );
    }

    /// 增量更新节点快照（只更新单个节点）
    pub async fn update_node_snapshot(&self, node_id: &str) {
        let state = self.management.read().await;
        
        if let Some(node_state) = state.get_node(node_id) {
            let snapshot = build_node_snapshot(
                node_id.to_string(),
                &node_state.node,
                &node_state.pool_ids,
            );
            
            // 更新快照（COW 模式）
            let mut snapshot_guard = self.snapshot.write().await;
            let mut new_map = (*snapshot_guard.nodes).clone();
            new_map.insert(node_id.to_string(), Arc::new(snapshot));
            snapshot_guard.update_nodes(new_map);
            
            debug!(
                node_id = %node_id,
                snapshot_version = snapshot_guard.version,
                "节点快照增量更新完成"
            );
        } else {
            warn!(
                node_id = %node_id,
                "尝试更新不存在的节点的快照"
            );
        }
    }

    /// 移除节点快照
    #[allow(dead_code)] // 目前未使用，节点移除通过增量更新处理
    pub async fn remove_node_snapshot(&self, node_id: &str) {
        let mut snapshot = self.snapshot.write().await;
        let mut new_map = (*snapshot.nodes).clone();
        
        if new_map.remove(node_id).is_some() {
            snapshot.update_nodes(new_map);
            debug!(
                node_id = %node_id,
                snapshot_version = snapshot.version,
                "节点快照移除完成"
            );
        }
    }

    /// 更新语言索引快照
    pub async fn update_lang_index_snapshot(&self) {
        let state_start = std::time::Instant::now();
        let state = self.management.read().await;
        let state_elapsed = state_start.elapsed();
        let lang_index_size = state.lang_index.language_set_count();
        let language_sets = state.lang_index.language_set_keys(10);
        
        let snapshot_start = std::time::Instant::now();
        let mut snapshot = self.snapshot.write().await;
        let old_version = snapshot.version;
        let old_lang_index_size = snapshot.lang_index.language_set_count();
        snapshot.update_lang_index(state.lang_index.clone());
        let snapshot_elapsed = snapshot_start.elapsed();
        drop(state); // 显式释放读锁
        
        info!(
            snapshot_version = snapshot.version,
            old_version = old_version,
            old_lang_index_size = old_lang_index_size,
            new_lang_index_size = lang_index_size,
            language_sets = ?language_sets,
            state_lock_wait_ms = state_elapsed.as_millis(),
            snapshot_lock_wait_ms = snapshot_elapsed.as_millis(),
            "语言索引快照更新完成"
        );
    }
}
