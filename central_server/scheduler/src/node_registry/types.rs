// 节点注册表类型定义

use crate::messages::{FeatureFlags, HardwareInfo, InstalledModel, InstalledService, CapabilityByType, ServiceType, NodeStatus};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub node_id: String,
    pub name: String,
    pub version: String,
    pub platform: String, // "windows" | "linux" | "macos"
    pub hardware: HardwareInfo,
    /// 节点生命周期状态（Scheduler 权威）
    pub status: NodeStatus,
    pub online: bool,
    pub cpu_usage: f32,
    pub gpu_usage: Option<f32>,
    pub memory_usage: f32,
    pub installed_models: Vec<InstalledModel>,
    /// 节点已安装的服务实现列表
    pub installed_services: Vec<InstalledService>,
    pub features_supported: FeatureFlags,
    pub accept_public_jobs: bool,
    /// 节点能力图（按 ServiceType 聚合）
    pub capability_by_type: Vec<CapabilityByType>,
    /// 便捷的 type -> bool 视图（运行时缓存，不序列化）
    #[serde(skip)]
    pub capability_by_type_map: std::collections::HashMap<ServiceType, bool>,
    pub current_jobs: usize,
    pub max_concurrent_jobs: usize,
    pub last_heartbeat: chrono::DateTime<chrono::Utc>,
    /// 节点注册时间（用于 warmup 超时检查）
    pub registered_at: chrono::DateTime<chrono::Utc>,
    /// OBS-1: 最近心跳周期的处理效率指标（按服务ID分组）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processing_metrics: Option<crate::messages::common::ProcessingMetrics>,
}

/// 调度过滤排除原因
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DispatchExcludeReason {
    StatusNotReady,
    NotInPublicPool,
    GpuUnavailable,
    ModelNotAvailable,
    CapacityExceeded,
    ResourceThresholdExceeded,
}

