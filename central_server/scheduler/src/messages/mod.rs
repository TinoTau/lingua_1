// WebSocket 消息协议定义（与 docs/PROTOCOLS.md 对应）

// 子模块
pub mod common;
pub mod error;
pub mod ui_event;
pub mod session;
pub mod node;

// 重新导出所有公共类型
// 注意：GpuInfo, ResourceUsage, JobError 在测试中被使用，所以保留导出
#[allow(unused_imports)]  // These are used in tests
pub use common::{
    FeatureFlags, PipelineConfig, InstalledModel, InstalledService, ModelStatus, CapabilityState,
    HardwareInfo, NodeStatus, GpuInfo, ResourceUsage, ServiceTimings,
};
pub use error::{ErrorCode, get_error_hint};
pub use ui_event::{UiEventType, UiEventStatus};
pub use session::SessionMessage;
#[allow(unused_imports)]  // Used in tests
pub use node::{NodeMessage, JobError};

