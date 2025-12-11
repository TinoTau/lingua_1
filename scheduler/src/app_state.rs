// 应用状态定义

use crate::session::SessionManager;
use crate::dispatcher::JobDispatcher;
use crate::node_registry::NodeRegistry;
use crate::pairing::PairingService;
use crate::model_hub::ModelHub;
use crate::connection_manager::{SessionConnectionManager, NodeConnectionManager};
use crate::result_queue::ResultQueueManager;

#[derive(Clone)]
pub struct AppState {
    pub session_manager: SessionManager,
    pub dispatcher: JobDispatcher,
    pub node_registry: std::sync::Arc<NodeRegistry>,
    pub pairing_service: PairingService,
    pub model_hub: ModelHub,
    pub session_connections: SessionConnectionManager,
    pub node_connections: NodeConnectionManager,
    pub result_queue: ResultQueueManager,
}

