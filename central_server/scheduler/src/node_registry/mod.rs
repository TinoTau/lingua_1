// 节点注册表模块（拆分版：原 mod.rs 过长，按职责拆分为多个子模块）

mod types;
mod validation;
mod core;
mod reserved;
mod unavailable;
mod exclude_stats;
mod selection;

pub use types::{Node, DispatchExcludeReason};
pub use selection::NoAvailableNodeBreakdown;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub(super) struct UnavailableServiceEntry {
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
}