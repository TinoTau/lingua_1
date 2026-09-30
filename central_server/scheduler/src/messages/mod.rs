// WebSocket 消息协议定义（与 docs/PROTOCOLS.md 对应）

// 子模块
pub mod common;
pub mod error;
pub mod ui_event;
pub mod session;
pub mod node;
pub mod user_profile;

#[allow(unused_imports)]
pub use common::{
    FeatureFlags, PipelineConfig, InstalledModel, InstalledService, CapabilityByType, ServiceType, DeviceType, ServiceStatus,
    HardwareInfo, NodeStatus, GpuInfo, ResourceUsage, ServiceTimings, NetworkTimings,
};
pub use error::{ErrorCode, get_error_hint};
pub use ui_event::{UiEventType, UiEventStatus};
pub use session::SessionMessage;
#[allow(unused_imports)]
pub use node::{NodeMessage, JobError};
pub use user_profile::{UserProfileV1, USER_PROFILE_MAX_BYTES};

