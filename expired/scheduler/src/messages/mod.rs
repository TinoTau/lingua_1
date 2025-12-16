// WebSocket 消息协议定义（与 docs/PROTOCOLS.md 对应）

// 子模块
pub mod common;
pub mod error;
pub mod ui_event;
pub mod session;
pub mod node;

// 重新导出所有公共类型
pub use common::{
    FeatureFlags, PipelineConfig, InstalledModel, ModelStatus, CapabilityState,
    HardwareInfo, NodeStatus,
};
pub use error::{ErrorCode, get_error_hint};
pub use ui_event::{UiEventType, UiEventStatus};
pub use session::SessionMessage;
pub use node::NodeMessage;
// 注意：GpuInfo, ResourceUsage, ExtraResult, JobError 在消息协议中使用，
// 但调度服务器代码中未直接使用，因此不在此处导出

