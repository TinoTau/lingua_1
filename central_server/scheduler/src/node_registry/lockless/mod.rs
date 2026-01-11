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

// 导出主要类型（基础实现完成）
pub use cache::{LocklessCache, LocklessCacheConfig};
pub use redis_client::LocklessRedisClient;
pub use version_manager::VersionManager;
pub use degradation::DegradeMode;
pub use node_write::{NodeHeartbeatData, NodeRegistrationData};
