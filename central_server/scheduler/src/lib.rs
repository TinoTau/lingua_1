// 库入口，用于测试和外部使用

pub mod config;
pub mod messages;
pub mod session;
pub mod dispatcher;
pub mod node_registry;
pub mod pairing;
pub mod model_hub;
pub mod websocket;
pub mod connection_manager;
pub mod result_queue;
pub mod app_state;
pub mod audio_buffer;
pub mod module_resolver;
pub mod group_manager;
pub mod node_status_manager;
pub mod room_manager;
pub mod stats;
pub mod service_catalog;
pub mod dashboard_snapshot;
pub mod model_not_available;
pub mod metrics;
pub mod observability;
pub mod prometheus_metrics;
pub mod job_timeout;

pub use app_state::AppState;
pub use audio_buffer::AudioBufferManager;
pub use module_resolver::{ModuleResolver, MODULE_TABLE};
pub use group_manager::{GroupManager, GroupConfig};

