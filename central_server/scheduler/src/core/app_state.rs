// 应用状态定义

use super::{JobDispatcher, SessionManager, JobIdempotencyManager, JobResultDeduplicator, PendingJobDispatches};
use crate::node_registry::NodeRegistry;
use crate::services::{PairingService, ServiceCatalogCache, MinimalSchedulerService};
use crate::managers::{
    AudioBufferManager, GroupManager,
    ResultQueueManager, RoomManager, SessionConnectionManager, NodeConnectionManager,
};
use crate::metrics::DashboardSnapshotCache;
use crate::model_not_available::ModelNotAvailableBus;
use super::config::WebTaskSegmentationConfig;
use crate::redis_runtime::Phase2Runtime;
use crate::pool::PoolService;

#[derive(Clone)]
pub struct AppState {
    pub session_manager: SessionManager,
    pub dispatcher: JobDispatcher,
    pub node_registry: std::sync::Arc<NodeRegistry>,
    pub pairing_service: PairingService,
    // ModelHub 已删除（未实现，所有方法dead_code）
    /// ModelHub 服务目录缓存（Dashboard/统计使用，避免请求时同步 HTTP）
    pub service_catalog: ServiceCatalogCache,
    /// Dashboard 统计快照缓存（/api/v1/stats 只读快照）
    pub dashboard_snapshot: DashboardSnapshotCache,
    /// MODEL_NOT_AVAILABLE 事件总线（主路径只入队，后台做标记/去抖等处理）
    pub model_not_available_bus: ModelNotAvailableBus,
    /// Web AudioChunk 分段配置（>pause_ms 视为任务结束）
    pub web_task_segmentation: WebTaskSegmentationConfig,
    pub session_connections: SessionConnectionManager,
    pub node_connections: NodeConnectionManager,
    pub result_queue: ResultQueueManager,
    pub audio_buffer: AudioBufferManager,
    pub group_manager: GroupManager,
    // NodeStatusManager 已删除（与Redis直查架构冲突）
    pub room_manager: RoomManager,
    /// Job 幂等键管理器（用于防止重复创建 job）
    pub job_idempotency: JobIdempotencyManager,
    /// JobResult 去重管理器（用于防止重复返回结果）
    pub job_result_deduplicator: JobResultDeduplicator,
    /// Utterance 消息路径：按 utterance_index 顺序派发（客户端可能乱序发送 Utterance）
    pub pending_job_dispatches: PendingJobDispatches,
    /// Phase 2：Redis/多实例运行时（可选，默认 None）
    pub phase2: Option<std::sync::Arc<Phase2Runtime>>,
    /// 极简无锁调度服务（可选，需要 Phase2 启用）
    pub minimal_scheduler: Option<std::sync::Arc<MinimalSchedulerService>>,
    /// Pool 服务（自动分配池，节点选择）
    pub pool_service: Option<std::sync::Arc<PoolService>>,
}

