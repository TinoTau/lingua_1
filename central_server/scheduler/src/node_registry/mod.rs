// 节点注册表模块（拆分版：原 mod.rs 过长，按职责拆分为多个子模块）

mod types;
mod validation;
mod core;
mod unavailable;
mod exclude_stats;
mod selection;
mod phase3_pool;
mod phase3_pool_config;
mod phase3_pool_allocation;
mod phase3_pool_allocation_impl;
mod phase3_pool_creation;
mod phase3_pool_index;
mod phase3_pool_members;
mod phase3_pool_cleanup;
pub mod phase3_pool_constants;
mod phase3_core_cache;
mod language_capability_index;
mod auto_language_pool;
mod pool_language_index;
mod management_state;
mod runtime_snapshot;
mod snapshot_manager;
mod lock_optimization;

// 锁优化组件（调度路径改造时使用）
pub use pool_language_index::PoolLanguageIndex;
pub use management_state::ManagementRegistry;
pub use snapshot_manager::SnapshotManager;

#[cfg(test)]
mod auto_language_pool_test;
#[cfg(test)]
mod phase3_pool_redis_test;
#[cfg(test)]
mod phase3_pool_allocation_test;
#[cfg(test)]
mod phase3_pool_heartbeat_test;
#[cfg(test)]
mod phase3_pool_registration_test;
#[cfg(test)]
mod pool_language_index_test;
#[cfg(test)]
mod management_state_test;
#[cfg(test)]
mod runtime_snapshot_test;
#[cfg(test)]
mod snapshot_manager_test;

pub use types::{Node, DispatchExcludeReason};
pub use selection::{NoAvailableNodeBreakdown, Phase3TwoLevelDebug};


// 以下模块将在调度路径改造时使用，暂时不导出
// pub use pool_language_index::PoolLanguageIndex;
// pub use management_state::{ManagementRegistry, ManagementState, NodeState};
// pub use runtime_snapshot::{RuntimeSnapshot, NodeRuntimeSnapshot, NodeHealth, NodeCapabilities};
// pub use snapshot_manager::SnapshotManager;

use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub(super) struct UnavailableServiceEntry {
    #[allow(dead_code)]
    pub(super) expire_at_ms: i64,
}


#[derive(Clone)]
pub struct NodeRegistry {
    /// 资源使用率阈值（超过此值的节点将被跳过）
    resource_threshold: f32,
    /// 调度排除原因统计（用于聚合统计）
    /// key: 排除原因, value: (总次数, 示例节点 ID 列表（最多 Top-K）)
    exclude_reason_stats: Arc<RwLock<HashMap<DispatchExcludeReason, (usize, Vec<String>)>>>,
    /// 节点服务包临时不可用标记（Phase 1：用于处理 MODEL_NOT_AVAILABLE）
    /// key1: node_id
    /// key2: service_id（当前项目中也可能使用 model_id 表达）
    unavailable_services: Arc<RwLock<HashMap<String, HashMap<String, UnavailableServiceEntry>>>>,
    /// Phase 3：两级调度配置（pool_count/hash_seed 等）
    phase3: Arc<RwLock<crate::core::config::Phase3Config>>,
    /// Phase 3：pool -> node_id 集合（用于 pool 内选节点，避免全量遍历）
    phase3_pool_index: Arc<RwLock<HashMap<u16, HashSet<String>>>>,
    /// Phase 3：node_id -> pool_ids（用于快速移除/迁移节点的 pool 归属）
    /// 一个节点可以属于多个 Pool（支持多个语言对）
    phase3_node_pool: Arc<RwLock<HashMap<String, HashSet<u16>>>>,
    /// 核心服务包配置（用于 Phase3 pool 核心能力缓存与快速定位）
    core_services: Arc<RwLock<crate::core::config::CoreServicesConfig>>,
    /// Phase 3：pool 核心能力缓存（online/ready + core services installed/ready 覆盖）
    phase3_core_cache: Arc<RwLock<phase3_core_cache::Phase3CoreCacheState>>,
    /// 语言能力索引（用于快速查询支持特定语言的节点）
    language_capability_index: Arc<RwLock<language_capability_index::LanguageCapabilityIndex>>,
    
    // 锁优化组件
    /// 管理注册表（统一管理锁）
    pub(crate) management_registry: Arc<ManagementRegistry>,
    /// 快照管理器（调度快路径，延迟初始化）
    pub(crate) snapshot_manager: Arc<tokio::sync::OnceCell<SnapshotManager>>,
}