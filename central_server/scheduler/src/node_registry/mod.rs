// 节点注册表模块（拆分版：原 mod.rs 过长，按职责拆分为多个子模块）

mod types;
mod validation;
mod core;
mod reserved;
mod unavailable;
mod exclude_stats;
mod selection;
mod phase3_pool;
mod phase3_core_cache;

pub use types::{Node, DispatchExcludeReason};
pub use selection::{NoAvailableNodeBreakdown, Phase3TwoLevelDebug};

use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub(super) struct UnavailableServiceEntry {
    #[allow(dead_code)] // 用于过期检查，通过 retain 间接使用
    pub(super) expire_at_ms: i64,
}

#[derive(Debug, Clone)]
pub(super) struct ReservedJobEntry {
    pub(super) expire_at_ms: i64,
}

#[derive(Clone)]
pub struct NodeRegistry {
    pub(crate) nodes: Arc<RwLock<HashMap<String, Node>>>,
    /// 资源使用率阈值（超过此值的节点将被跳过）
    resource_threshold: f32,
    /// 调度排除原因统计（用于聚合统计）
    /// key: 排除原因, value: (总次数, 示例节点 ID 列表（最多 Top-K）)
    exclude_reason_stats: Arc<RwLock<HashMap<DispatchExcludeReason, (usize, Vec<String>)>>>,
    /// 节点服务包临时不可用标记（Phase 1：用于处理 MODEL_NOT_AVAILABLE）
    /// key1: node_id
    /// key2: service_id（当前项目中也可能使用 model_id 表达）
    unavailable_services: Arc<RwLock<HashMap<String, HashMap<String, UnavailableServiceEntry>>>>,
    /// 节点并发占用（reserved jobs，Phase 1）
    /// 用于弥补“心跳 current_jobs 更新滞后”导致的超卖风险。
    /// key1: node_id
    /// key2: job_id
    reserved_jobs: Arc<RwLock<HashMap<String, HashMap<String, ReservedJobEntry>>>>,
    /// Phase 3：两级调度配置（pool_count/hash_seed 等）
    phase3: Arc<RwLock<crate::core::config::Phase3Config>>,
    /// Phase 3：pool -> node_id 集合（用于 pool 内选节点，避免全量遍历）
    phase3_pool_index: Arc<RwLock<HashMap<u16, HashSet<String>>>>,
    /// Phase 3：node_id -> pool_id（用于快速移除/迁移节点的 pool 归属）
    phase3_node_pool: Arc<RwLock<HashMap<String, u16>>>,
    /// 核心服务包配置（用于 Phase3 pool 核心能力缓存与快速定位）
    core_services: Arc<RwLock<crate::core::config::CoreServicesConfig>>,
    /// Phase 3：pool 核心能力缓存（online/ready + core services installed/ready 覆盖）
    phase3_core_cache: Arc<RwLock<phase3_core_cache::Phase3CoreCacheState>>,
}