// 应用状态定义

use crate::session::SessionManager;
use crate::dispatcher::JobDispatcher;
use crate::node_registry::NodeRegistry;
use crate::pairing::PairingService;
use crate::model_hub::ModelHub;
use crate::connection_manager::{SessionConnectionManager, NodeConnectionManager};
use crate::result_queue::ResultQueueManager;
use crate::audio_buffer::AudioBufferManager;
use crate::group_manager::GroupManager;
use crate::node_status_manager::NodeStatusManager;
use crate::room_manager::RoomManager;
use crate::service_catalog::ServiceCatalogCache;
use crate::dashboard_snapshot::DashboardSnapshotCache;
use crate::model_not_available::ModelNotAvailableBus;
use crate::config::WebTaskSegmentationConfig;

#[derive(Clone)]
pub struct AppState {
    pub session_manager: SessionManager,
    pub dispatcher: JobDispatcher,
    pub node_registry: std::sync::Arc<NodeRegistry>,
    pub pairing_service: PairingService,
    #[allow(dead_code)]
    pub model_hub: ModelHub,
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
    pub node_status_manager: NodeStatusManager,
    pub room_manager: RoomManager,
}

