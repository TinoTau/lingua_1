// 节点注册表模块（拆分版：原 mod.rs 过长，按职责拆分为多个子模块）

mod types;
mod validation;
mod core;
mod unavailable;
mod exclude_stats;
mod selection;

// 无锁架构：Redis 直查
mod node_data;
mod node_redis_repository;
mod node_registry_simple;

// deprecated_types 已彻底删除

// 无锁架构：Redis 直查
pub use node_data::NodeData;
pub use node_redis_repository::NodeRedisRepository;
pub use node_registry_simple::{NodeRegistrySimple, SchedNodeInfo};

// PoolLanguageIndex 已删除，使用 PoolService 替代

pub use types::{Node, DispatchExcludeReason};
// NoAvailableNodeBreakdown 已删除（旧节点选择逻辑已删除）

// 导出 NodeRegistry（无状态，Redis 直查）
pub use core::NodeRegistry;