use serde::{Deserialize, Serialize};

/// Redis 运行时配置：实例生命周期、owner、Streams inbox、节点快照等
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisRuntimeConfig {
    /// 是否启用 Redis 运行时（节点管理、多实例、池分配等均依赖 Redis）
    #[serde(default)]
    pub enabled: bool,
    /// Scheduler 实例 ID：留空或 "auto" 自动生成（hostname + pid + 短 uuid）；显式指定便于调试
    #[serde(default = "super::config_defaults::default_redis_runtime_instance_id")]
    pub instance_id: String,
    /// Redis 连接配置（单实例或 Cluster）
    #[serde(default)]
    pub redis: RedisConnectionConfig,
    /// owner 绑定 TTL（秒）：node/session owner key 过期时间，建议略大于心跳续约周期
    #[serde(default = "super::config_defaults::default_redis_runtime_owner_ttl_seconds")]
    pub owner_ttl_seconds: u64,
    /// Streams 读取 block 时间（毫秒）
    #[serde(default = "super::config_defaults::default_redis_runtime_stream_block_ms")]
    pub stream_block_ms: u64,
    /// Streams 每次拉取条数
    #[serde(default = "super::config_defaults::default_redis_runtime_stream_count")]
    pub stream_count: usize,
    /// Streams consumer group 名称（同 group 多实例可实现 failover）
    #[serde(default = "super::config_defaults::default_redis_runtime_stream_group")]
    pub stream_group: String,
    /// Streams inbox 最大长度（MAXLEN ~）
    #[serde(default = "super::config_defaults::default_redis_runtime_stream_maxlen")]
    pub stream_maxlen: usize,
    /// 是否启用 DLQ（长期 pending/多次失败消息移入 dlq stream）
    #[serde(default)]
    pub dlq_enabled: bool,
    /// DLQ stream 最大长度
    #[serde(default = "super::config_defaults::default_redis_runtime_dlq_maxlen")]
    pub dlq_maxlen: usize,
    /// pending 超过该投递次数后进入 DLQ
    #[serde(default = "super::config_defaults::default_redis_runtime_dlq_max_deliveries")]
    pub dlq_max_deliveries: u64,
    /// pending idle 超过该阈值（毫秒）才允许进入 DLQ
    #[serde(default = "super::config_defaults::default_redis_runtime_dlq_min_idle_ms")]
    pub dlq_min_idle_ms: u64,
    /// DLQ 扫描间隔（毫秒）
    #[serde(default = "super::config_defaults::default_redis_runtime_dlq_scan_interval_ms")]
    pub dlq_scan_interval_ms: u64,
    /// 每次 DLQ 扫描最多处理条数
    #[serde(default = "super::config_defaults::default_redis_runtime_dlq_scan_count")]
    pub dlq_scan_count: usize,
    /// 节点快照同步（从 Redis 拉取全量节点到本地 NodeRegistry）
    #[serde(default)]
    pub node_snapshot: NodeSnapshotConfig,
    /// Redis schema 兼容层（可选补写 v1 keys，默认关闭）
    #[serde(default)]
    pub schema_compat: SchemaCompatConfig,
}

/// Redis schema 兼容层（按文档建议补写 v1 keys，默认关闭）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaCompatConfig {
    /// 是否启用 schema_compat（总开关）
    #[serde(default)]
    pub enabled: bool,
    /// 是否写入 `v1:stats:snapshot`（Dashboard 快照写入 Redis）
    #[serde(default)]
    pub stats_snapshot_enabled: bool,
    /// stats snapshot TTL（秒）
    #[serde(default = "super::config_defaults::default_phase2_stats_snapshot_ttl_seconds")]
    pub stats_snapshot_ttl_seconds: u64,
    /// stats snapshot 写入间隔（毫秒）
    #[serde(default = "super::config_defaults::default_phase2_stats_snapshot_interval_ms")]
    pub stats_snapshot_interval_ms: u64,
    /// 是否写入 `v1:nodes:caps:{node:<id>}`（Hash，扁平化字段）
    #[serde(default)]
    pub node_caps_enabled: bool,
    /// node caps TTL（秒；0 表示不设置 TTL）
    #[serde(default)]
    pub node_caps_ttl_seconds: u64,
    /// 是否写入 `v1:sessions:bind:{session:<id>}`（Hash，仅对"配对节点"场景）
    #[serde(default)]
    pub session_bind_enabled: bool,
    /// session bind TTL（秒）
    #[serde(default = "super::config_defaults::default_phase2_session_bind_ttl_seconds")]
    pub session_bind_ttl_seconds: u64,
}

/// 节点快照同步配置（Redis -> 本地 NodeRegistry）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSnapshotConfig {
    /// 是否启用节点快照同步（默认 true；仅在 redis_runtime.enabled=true 时生效）
    #[serde(default = "super::config_defaults::default_phase2_node_snapshot_enabled")]
    pub enabled: bool,
    /// 节点 presence TTL（秒）：redis key 过期即视为离线（用于跨实例在线判断）
    #[serde(default = "super::config_defaults::default_phase2_node_presence_ttl_seconds")]
    pub presence_ttl_seconds: u64,
    /// 后台刷新间隔（毫秒）：从 Redis 拉取全量节点快照并 upsert 到本地 NodeRegistry
    #[serde(default = "super::config_defaults::default_phase2_node_refresh_interval_ms")]
    pub refresh_interval_ms: u64,
    /// 从 nodes:all 清理"长期离线"的节点（秒）。设为 0 表示不清理。
    #[serde(default = "super::config_defaults::default_phase2_node_remove_stale_after_seconds")]
    pub remove_stale_after_seconds: u64,
}

/// Redis 连接配置（单实例或 Cluster）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisConnectionConfig {
    /// Redis 模式： "single" | "cluster"
    #[serde(default = "super::config_defaults::default_phase2_redis_mode")]
    pub mode: String,
    /// 单实例 Redis URL（mode=single 时使用）
    #[serde(default = "super::config_defaults::default_phase2_redis_url")]
    pub url: String,
    /// Cluster 节点 URL 列表（mode=cluster 时使用）
    #[serde(default)]
    pub cluster_urls: Vec<String>,
    /// key 前缀（便于多环境隔离）
    #[serde(default = "super::config_defaults::default_phase2_key_prefix")]
    pub key_prefix: String,
}

impl Default for RedisRuntimeConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            instance_id: super::config_defaults::default_redis_runtime_instance_id(),
            redis: RedisConnectionConfig::default(),
            owner_ttl_seconds: super::config_defaults::default_redis_runtime_owner_ttl_seconds(),
            stream_block_ms: super::config_defaults::default_redis_runtime_stream_block_ms(),
            stream_count: super::config_defaults::default_redis_runtime_stream_count(),
            stream_group: super::config_defaults::default_redis_runtime_stream_group(),
            stream_maxlen: super::config_defaults::default_redis_runtime_stream_maxlen(),
            dlq_enabled: true,
            dlq_maxlen: super::config_defaults::default_redis_runtime_dlq_maxlen(),
            dlq_max_deliveries: super::config_defaults::default_redis_runtime_dlq_max_deliveries(),
            dlq_min_idle_ms: super::config_defaults::default_redis_runtime_dlq_min_idle_ms(),
            dlq_scan_interval_ms: super::config_defaults::default_redis_runtime_dlq_scan_interval_ms(),
            dlq_scan_count: super::config_defaults::default_redis_runtime_dlq_scan_count(),
            node_snapshot: NodeSnapshotConfig::default(),
            schema_compat: SchemaCompatConfig::default(),
        }
    }
}

impl Default for SchemaCompatConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            stats_snapshot_enabled: false,
            stats_snapshot_ttl_seconds: super::config_defaults::default_phase2_stats_snapshot_ttl_seconds(),
            stats_snapshot_interval_ms: super::config_defaults::default_phase2_stats_snapshot_interval_ms(),
            node_caps_enabled: false,
            node_caps_ttl_seconds: 0,
            session_bind_enabled: false,
            session_bind_ttl_seconds: super::config_defaults::default_phase2_session_bind_ttl_seconds(),
        }
    }
}

impl Default for NodeSnapshotConfig {
    fn default() -> Self {
        Self {
            enabled: super::config_defaults::default_phase2_node_snapshot_enabled(),
            presence_ttl_seconds: super::config_defaults::default_phase2_node_presence_ttl_seconds(),
            refresh_interval_ms: super::config_defaults::default_phase2_node_refresh_interval_ms(),
            remove_stale_after_seconds: super::config_defaults::default_phase2_node_remove_stale_after_seconds(),
        }
    }
}

impl Default for RedisConnectionConfig {
    fn default() -> Self {
        Self {
            mode: super::config_defaults::default_phase2_redis_mode(),
            url: super::config_defaults::default_phase2_redis_url(),
            cluster_urls: Vec::new(),
            key_prefix: super::config_defaults::default_phase2_key_prefix(),
        }
    }
}
