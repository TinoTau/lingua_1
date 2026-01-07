//! Phase 3 Pool 相关常量定义

/// Pool Leader 锁的 TTL（秒）
pub const POOL_LEADER_LOCK_TTL_SECONDS: u64 = 60;

/// Pool 配置在 Redis 中的 TTL（秒，1小时）
pub const POOL_CONFIG_REDIS_TTL_SECONDS: u64 = 3600;

/// 等待其他实例生成配置的重试延迟（毫秒）
pub const POOL_CONFIG_RETRY_DELAY_MS: u64 = 500;

/// Pool 清理任务的扫描间隔（秒）
pub const POOL_CLEANUP_SCAN_INTERVAL_SECONDS: u64 = 60;

/// Pool 配置同步检查间隔（秒）
pub const POOL_CONFIG_SYNC_CHECK_INTERVAL_SECONDS: u64 = 10;
