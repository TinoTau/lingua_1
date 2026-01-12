// 库入口，用于测试和外部使用

pub mod core;
pub mod messages;
pub mod node_registry;
pub mod websocket;
pub mod utils;
pub mod managers;
pub mod services;
pub mod metrics;
pub mod timeout;
pub mod model_not_available;
pub mod phase2;
pub mod phase3;

// Re-export commonly used types
pub use core::{AppState, Config, JobDispatcher, SessionManager};
pub use managers::{
    AudioBufferManager, GroupManager, GroupConfig, NodeStatusManager,
    ResultQueueManager, RoomManager, SessionConnectionManager, NodeConnectionManager,
};
pub use services::{ModelHub, PairingService, ServiceCatalogCache};
pub use utils::ModuleResolver;

