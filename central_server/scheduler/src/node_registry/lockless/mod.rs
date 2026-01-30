//! 无锁架构模块
//! 
//! 将共享状态存储到 Redis，每个调度器实例维护本地缓存，使用版本号和发布/订阅机制实现缓存失效和一致性保证。

mod cache;
mod redis_client;
mod pubsub;
mod serialization;
mod version_manager;
mod degradation;
mod node_write;

// 注意：这些类型仅在 lockless 模块内部使用，不对外导出
// 如果未来需要外部使用，可以取消注释
// pub use cache::{LocklessCache, LocklessCacheConfig};
// pub use redis_client::LocklessRedisClient;
// pub use version_manager::VersionManager;
// pub use degradation::DegradeMode;
// pub use node_write::{NodeHeartbeatData, NodeRegistrationData};

// 注意：lockless 模块当前未在生产代码中使用，保留用于未来扩展
// 所有未使用的代码都标记为 