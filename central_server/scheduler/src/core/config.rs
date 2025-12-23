use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub model_hub: ModelHubConfig,
    pub scheduler: SchedulerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelHubConfig {
    pub base_url: String,
    pub storage_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    pub max_concurrent_jobs_per_node: usize,
    /// Phase 1：任务超时（job_timeout_seconds）的语义与策略补充
    /// - job_timeout_seconds：从“成功下发到节点（dispatched）”开始计时的超时秒数
    /// - pending_timeout_seconds：从创建开始计时的 pending 超时秒数（无可用节点/无法派发）
    /// - failover_max_attempts：超时后自动重派的最大次数
    /// - send_cancel：超时/重派前是否给节点发送 job_cancel（best-effort）
    /// - scan_interval_ms：超时扫描间隔
    #[serde(default)]
    pub job_timeout: JobTimeoutPolicyConfig,
    pub job_timeout_seconds: u64,
    pub heartbeat_interval_seconds: u64,
    #[serde(default)]
    pub load_balancer: LoadBalancerConfig,
    #[serde(default)]
    pub node_health: NodeHealthConfig,
    /// Phase 1：MODEL_NOT_AVAILABLE 处理相关配置
    #[serde(default)]
    pub model_not_available: ModelNotAvailableConfig,
    /// Phase 1：任务级绑定（request_id/lease）与并发占用（reserved）相关配置
    #[serde(default)]
    pub task_binding: TaskBindingConfig,
    /// Web 端 AudioChunk 的任务边界定义
    #[serde(default)]
    pub web_task_segmentation: WebTaskSegmentationConfig,
    /// 观测/验收（方向A：采样日志）
    #[serde(default)]
    pub observability: ObservabilityConfig,
    /// Phase 1：核心服务包映射（用于 required_types (ServiceType) 计算与选节点过滤）
    #[serde(default)]
    pub core_services: CoreServicesConfig,
    /// Phase 2：Redis / 多实例相关配置（默认关闭，开启后按文档启用 instance presence + owner + Streams）
    #[serde(default)]
    pub phase2: Phase2Config,
    /// Phase 3：两级调度 / Pool（默认关闭；开启后优先走“Global 选 pool -> pool 内选 node”的路径）
    #[serde(default)]
    pub phase3: Phase3Config,
}

/// Phase 3：两级调度（Two-level scheduling）
/// 目标：在节点规模增大时，把“全量遍历选节点”收敛为“先选 pool，再在 pool 内选 node”，并提供可观测性与可运维性。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase3Config {
    /// 是否启用 Phase 3（默认 false）
    #[serde(default)]
    pub enabled: bool,
    /// 模式：目前仅支持 "two_level"
    #[serde(default = "default_phase3_mode")]
    pub mode: String,
    /// pool 数量（将 nodes 分桶；请求优先落到一个 pool，必要时 fallback）
    #[serde(default = "default_phase3_pool_count")]
    pub pool_count: u16,
    /// hash seed（用于 pool 计算；改动会导致 pool 映射变化）
    #[serde(default = "default_phase3_hash_seed")]
    pub hash_seed: u64,
    /// 当首选 pool 无可用节点时，是否遍历其他 pool 进行 fallback
    #[serde(default = "default_phase3_fallback_scan_all_pools")]
    pub fallback_scan_all_pools: bool,

    /// Phase 3（强隔离）：按能力配置 pools（如果非空，则启用“按能力分 pool”的强隔离模式）
    /// - Node 会被分配到“第一个匹配”的 pool（按 pools 顺序）
    /// - Job 会在“可满足 required 服务”的 pools 集合中选择 preferred，并按配置 fallback
    #[serde(default)]
    pub pools: Vec<Phase3PoolConfig>,

    /// tenant -> pool 显式绑定（强隔离/容量规划）
    /// - 当 routing_key == tenant_id 时生效（目前 routing_key 优先 tenant_id，否则 session_id）
    #[serde(default)]
    pub tenant_overrides: Vec<Phase3TenantOverride>,

    /// pool 资格匹配范围：
    /// - "core_only"：只对 ASR/NMT/TTS 核心服务做 pool 级过滤（默认，兼容性最好）
    /// - "all_required"：对 required_types (ServiceType) 全量做 pool 级过滤（更强隔离，需 pool.required_services 覆盖完整）
    #[serde(default = "default_phase3_pool_match_scope")]
    pub pool_match_scope: String,

    /// pool 匹配模式：
    /// - "contains"：包含匹配（默认）：required ⊆ pool.required_services
    /// - "exact"：精确匹配：set(required) == set(pool.required_services)
    ///   - 运维语义：用于“强隔离”，避免更大/更全的 pool 兜底更小的任务集合
    #[serde(default = "default_phase3_pool_match_mode")]
    pub pool_match_mode: String,

    /// 若为 true：当 pools 非空但没有任何 eligible pool 时，直接返回 NO_AVAILABLE_NODE（强隔离）
    /// 若为 false：eligible 为空时回退到“遍历所有配置 pools”（兼容模式）
    #[serde(default)]
    pub strict_pool_eligibility: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase3PoolConfig {
    pub pool_id: u16,
    #[serde(default)]
    pub name: String,
    /// 该 pool "保证具备"的服务类型（ServiceType 字符串列表，如 ["ASR", "NMT", "TTS"]）
    #[serde(default)]
    pub required_services: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase3TenantOverride {
    pub tenant_id: String,
    pub pool_id: u16,
}

fn default_phase3_mode() -> String {
    "two_level".to_string()
}

fn default_phase3_pool_count() -> u16 {
    16
}

fn default_phase3_hash_seed() -> u64 {
    0
}

fn default_phase3_fallback_scan_all_pools() -> bool {
    true
}

fn default_phase3_pool_match_scope() -> String {
    "core_only".to_string()
}

fn default_phase3_pool_match_mode() -> String {
    "contains".to_string()
}

impl Default for Phase3Config {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: default_phase3_mode(),
            pool_count: default_phase3_pool_count(),
            hash_seed: default_phase3_hash_seed(),
            fallback_scan_all_pools: default_phase3_fallback_scan_all_pools(),
            pools: vec![],
            tenant_overrides: vec![],
            pool_match_scope: default_phase3_pool_match_scope(),
            pool_match_mode: default_phase3_pool_match_mode(),
            strict_pool_eligibility: false,
        }
    }
}

/// Phase 2：Redis / 多实例基础能力（Instance 生命周期 + owner + Streams inbox）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase2Config {
    /// 是否开启 Phase 2（默认 false，避免影响 Phase 1 单实例运行）
    #[serde(default)]
    pub enabled: bool,
    /// Scheduler 实例 ID：
    /// - 留空或 "auto"：启动时自动生成（hostname + pid + 短 uuid）
    /// - 显式指定：用于固定实例名（便于调试/观测）
    #[serde(default = "default_phase2_instance_id")]
    pub instance_id: String,
    /// Redis 配置（支持单实例与 Cluster 形态）
    #[serde(default)]
    pub redis: Phase2RedisConfig,
    /// owner 绑定 TTL（秒）：node/session owner key 的过期时间
    /// 建议略大于连接心跳续约周期（由 Scheduler 周期性续约）
    #[serde(default = "default_phase2_owner_ttl_seconds")]
    pub owner_ttl_seconds: u64,
    /// Streams 读取 block 时间（毫秒）
    #[serde(default = "default_phase2_stream_block_ms")]
    pub stream_block_ms: u64,
    /// Streams 每次拉取条数
    #[serde(default = "default_phase2_stream_count")]
    pub stream_count: usize,
    /// Streams consumer group 名称（同一个 stream 的同一 group 下多实例可实现 failover）
    #[serde(default = "default_phase2_stream_group")]
    pub stream_group: String,
    /// Streams inbox 最大长度（近似裁剪 MAXLEN ~），防止 stream 无界增长
    #[serde(default = "default_phase2_stream_maxlen")]
    pub stream_maxlen: usize,
    /// 是否启用 DLQ（将长期 pending/多次投递失败的消息移入 dlq stream）
    #[serde(default)]
    pub dlq_enabled: bool,
    /// DLQ stream 最大长度（近似裁剪 MAXLEN ~）
    #[serde(default = "default_phase2_dlq_maxlen")]
    pub dlq_maxlen: usize,
    /// pending 消息超过该投递次数后进入 DLQ
    #[serde(default = "default_phase2_dlq_max_deliveries")]
    pub dlq_max_deliveries: u64,
    /// pending 消息 idle 超过该阈值（毫秒）才允许进入 DLQ（避免搬走正在处理的消息）
    #[serde(default = "default_phase2_dlq_min_idle_ms")]
    pub dlq_min_idle_ms: u64,
    /// DLQ 扫描间隔（毫秒）
    #[serde(default = "default_phase2_dlq_scan_interval_ms")]
    pub dlq_scan_interval_ms: u64,
    /// 每次 DLQ 扫描最多处理多少条 pending
    #[serde(default = "default_phase2_dlq_scan_count")]
    pub dlq_scan_count: usize,
    /// Phase 2：节点快照同步（使任意 Scheduler 都拥有全量节点视图）
    #[serde(default)]
    pub node_snapshot: Phase2NodeSnapshotConfig,
    /// Phase 2：Redis schema 对齐兼容层（默认关闭；用于补写文档建议的 v1 keys）
    #[serde(default)]
    pub schema_compat: Phase2SchemaCompatConfig,
}

fn default_phase2_instance_id() -> String {
    "auto".to_string()
}

fn default_phase2_owner_ttl_seconds() -> u64 {
    45
}

fn default_phase2_stream_block_ms() -> u64 {
    1000
}

fn default_phase2_stream_count() -> usize {
    64
}

fn default_phase2_stream_group() -> String {
    "scheduler".to_string()
}

fn default_phase2_stream_maxlen() -> usize {
    10_000
}

fn default_phase2_dlq_maxlen() -> usize {
    10_000
}

fn default_phase2_dlq_max_deliveries() -> u64 {
    10
}

fn default_phase2_dlq_min_idle_ms() -> u64 {
    60_000
}

fn default_phase2_dlq_scan_interval_ms() -> u64 {
    5000
}

fn default_phase2_dlq_scan_count() -> usize {
    100
}

impl Default for Phase2Config {
    fn default() -> Self {
        Self {
            enabled: true,  // 默认启用 Phase2
            instance_id: default_phase2_instance_id(),
            redis: Phase2RedisConfig::default(),
            owner_ttl_seconds: default_phase2_owner_ttl_seconds(),
            stream_block_ms: default_phase2_stream_block_ms(),
            stream_count: default_phase2_stream_count(),
            stream_group: default_phase2_stream_group(),
            stream_maxlen: default_phase2_stream_maxlen(),
            dlq_enabled: true,
            dlq_maxlen: default_phase2_dlq_maxlen(),
            dlq_max_deliveries: default_phase2_dlq_max_deliveries(),
            dlq_min_idle_ms: default_phase2_dlq_min_idle_ms(),
            dlq_scan_interval_ms: default_phase2_dlq_scan_interval_ms(),
            dlq_scan_count: default_phase2_dlq_scan_count(),
            node_snapshot: Phase2NodeSnapshotConfig::default(),
            schema_compat: Phase2SchemaCompatConfig::default(),
        }
    }
}

/// Phase2：Redis schema 对齐兼容层（按文档建议补写 v1 keys）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase2SchemaCompatConfig {
    /// 是否启用 schema_compat（总开关）
    #[serde(default)]
    pub enabled: bool,
    /// 是否写入 `v1:stats:snapshot`（Dashboard 快照写入 Redis）
    #[serde(default)]
    pub stats_snapshot_enabled: bool,
    /// stats snapshot TTL（秒）
    #[serde(default = "default_phase2_stats_snapshot_ttl_seconds")]
    pub stats_snapshot_ttl_seconds: u64,
    /// stats snapshot 写入间隔（毫秒）
    #[serde(default = "default_phase2_stats_snapshot_interval_ms")]
    pub stats_snapshot_interval_ms: u64,
    /// 是否写入 `v1:nodes:caps:{node:<id>}`（Hash，扁平化字段）
    #[serde(default)]
    pub node_caps_enabled: bool,
    /// node caps TTL（秒；0 表示不设置 TTL）
    #[serde(default)]
    pub node_caps_ttl_seconds: u64,
    /// 是否写入 `v1:sessions:bind:{session:<id>}`（Hash，仅对“配对节点”场景）
    #[serde(default)]
    pub session_bind_enabled: bool,
    /// session bind TTL（秒）
    #[serde(default = "default_phase2_session_bind_ttl_seconds")]
    pub session_bind_ttl_seconds: u64,
}

fn default_phase2_stats_snapshot_ttl_seconds() -> u64 {
    60
}

fn default_phase2_stats_snapshot_interval_ms() -> u64 {
    5000
}

fn default_phase2_session_bind_ttl_seconds() -> u64 {
    3600
}

impl Default for Phase2SchemaCompatConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            stats_snapshot_enabled: false,
            stats_snapshot_ttl_seconds: default_phase2_stats_snapshot_ttl_seconds(),
            stats_snapshot_interval_ms: default_phase2_stats_snapshot_interval_ms(),
            node_caps_enabled: false,
            node_caps_ttl_seconds: 0,
            session_bind_enabled: false,
            session_bind_ttl_seconds: default_phase2_session_bind_ttl_seconds(),
        }
    }
}

/// Phase 2：节点快照同步配置（Redis -> 本地 NodeRegistry）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase2NodeSnapshotConfig {
    /// 是否启用节点快照同步（默认 true；仅在 phase2.enabled=true 时生效）
    #[serde(default = "default_phase2_node_snapshot_enabled")]
    pub enabled: bool,
    /// 节点 presence TTL（秒）：redis key 过期即视为离线（用于跨实例在线判断）
    #[serde(default = "default_phase2_node_presence_ttl_seconds")]
    pub presence_ttl_seconds: u64,
    /// 后台刷新间隔（毫秒）：从 Redis 拉取全量节点快照并 upsert 到本地 NodeRegistry
    #[serde(default = "default_phase2_node_refresh_interval_ms")]
    pub refresh_interval_ms: u64,
    /// 从 nodes:all 清理“长期离线”的节点（秒）。设为 0 表示不清理。
    #[serde(default = "default_phase2_node_remove_stale_after_seconds")]
    pub remove_stale_after_seconds: u64,
}

fn default_phase2_node_snapshot_enabled() -> bool {
    true
}

fn default_phase2_node_presence_ttl_seconds() -> u64 {
    45
}

fn default_phase2_node_refresh_interval_ms() -> u64 {
    2000
}

fn default_phase2_node_remove_stale_after_seconds() -> u64 {
    600
}

impl Default for Phase2NodeSnapshotConfig {
    fn default() -> Self {
        Self {
            enabled: default_phase2_node_snapshot_enabled(),
            presence_ttl_seconds: default_phase2_node_presence_ttl_seconds(),
            refresh_interval_ms: default_phase2_node_refresh_interval_ms(),
            remove_stale_after_seconds: default_phase2_node_remove_stale_after_seconds(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase2RedisConfig {
    /// Redis 模式： "single" | "cluster"
    #[serde(default = "default_phase2_redis_mode")]
    pub mode: String,
    /// 单实例 Redis URL（mode=single 时使用）
    #[serde(default = "default_phase2_redis_url")]
    pub url: String,
    /// Cluster 节点 URL 列表（mode=cluster 时使用）
    #[serde(default)]
    pub cluster_urls: Vec<String>,
    /// key 前缀（便于多环境隔离）
    #[serde(default = "default_phase2_key_prefix")]
    pub key_prefix: String,
}

fn default_phase2_redis_mode() -> String {
    "single".to_string()
}

fn default_phase2_redis_url() -> String {
    "redis://127.0.0.1:6379".to_string()
}

fn default_phase2_key_prefix() -> String {
    "lingua".to_string()
}

impl Default for Phase2RedisConfig {
    fn default() -> Self {
        Self {
            mode: default_phase2_redis_mode(),
            url: default_phase2_redis_url(),
            cluster_urls: Vec::new(),
            key_prefix: default_phase2_key_prefix(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobTimeoutPolicyConfig {
    /// Pending（未成功派发）状态的超时秒数（从 job.created_at 计时）
    #[serde(default = "default_job_pending_timeout_seconds")]
    pub pending_timeout_seconds: u64,
    /// 超时后自动重派最大次数（不包含首次派发）
    #[serde(default = "default_job_failover_max_attempts")]
    pub failover_max_attempts: u32,
    /// 超时扫描间隔（毫秒）
    #[serde(default = "default_job_timeout_scan_interval_ms")]
    pub scan_interval_ms: u64,
    /// 是否给节点发送取消指令（best-effort）
    #[serde(default = "default_job_timeout_send_cancel")]
    pub send_cancel: bool,
}

fn default_job_pending_timeout_seconds() -> u64 {
    10
}

fn default_job_failover_max_attempts() -> u32 {
    3
}

fn default_job_timeout_scan_interval_ms() -> u64 {
    1000
}

fn default_job_timeout_send_cancel() -> bool {
    true
}

impl Default for JobTimeoutPolicyConfig {
    fn default() -> Self {
        Self {
            pending_timeout_seconds: default_job_pending_timeout_seconds(),
            failover_max_attempts: default_job_failover_max_attempts(),
            scan_interval_ms: default_job_timeout_scan_interval_ms(),
            send_cancel: default_job_timeout_send_cancel(),
        }
    }
}

/// 核心链路服务包 ID（与 ModelHub services_index.json 中的 service_id 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreServicesConfig {
    /// ASR 服务包（可为空；为空则不参与 required 列表）
    #[serde(default = "default_core_asr_service_id")]
    pub asr_service_id: String,
    /// NMT 服务包（可为空）
    #[serde(default = "default_core_nmt_service_id")]
    pub nmt_service_id: String,
    /// TTS 服务包（可为空）
    #[serde(default = "default_core_tts_service_id")]
    pub tts_service_id: String,
}

fn default_core_asr_service_id() -> String {
    "node-inference".to_string()
}

fn default_core_nmt_service_id() -> String {
    "nmt-m2m100".to_string()
}

fn default_core_tts_service_id() -> String {
    "piper-tts".to_string()
}

impl Default for CoreServicesConfig {
    fn default() -> Self {
        Self {
            asr_service_id: default_core_asr_service_id(),
            nmt_service_id: default_core_nmt_service_id(),
            tts_service_id: default_core_tts_service_id(),
        }
    }
}

/// 任务级绑定与并发占用配置（Phase 1）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBindingConfig {
    /// request_id → (job_id,node_id) 绑定租约 TTL（秒）
    /// 用于：重复请求幂等；避免同一任务被重复创建/重复派发
    #[serde(default = "default_task_binding_lease_seconds")]
    pub lease_seconds: u64,
    /// 节点 reserved job 记录 TTL（秒），用于避免心跳延迟导致超卖
    /// 建议与 lease_seconds 同步或略大
    #[serde(default = "default_task_binding_reserved_ttl_seconds")]
    pub reserved_ttl_seconds: u64,
    /// 是否开启“打散”策略（任务级）：避免同一 session 连续任务落到同一节点（若存在其他候选则优先避开）
    #[serde(default)]
    pub spread_enabled: bool,
    /// 打散窗口（秒）：仅在窗口内避免使用“上一次已派发节点”
    #[serde(default = "default_task_binding_spread_window_seconds")]
    pub spread_window_seconds: u64,
}

fn default_task_binding_lease_seconds() -> u64 {
    90
}

fn default_task_binding_reserved_ttl_seconds() -> u64 {
    90
}

fn default_task_binding_spread_window_seconds() -> u64 {
    30
}

impl Default for TaskBindingConfig {
    fn default() -> Self {
        Self {
            lease_seconds: default_task_binding_lease_seconds(),
            reserved_ttl_seconds: default_task_binding_reserved_ttl_seconds(),
            spread_enabled: false,
            spread_window_seconds: default_task_binding_spread_window_seconds(),
        }
    }
}

/// Web 端音频分段（AudioChunk）任务边界配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebTaskSegmentationConfig {
    /// 超过该停顿（毫秒）视为一个任务结束（默认 2000ms，增加以避免句子中间停顿导致截断）
    #[serde(default = "default_web_pause_ms")]
    pub pause_ms: u64,
}

fn default_web_pause_ms() -> u64 {
    2000  // 从 1000ms 增加到 2000ms，减少句子中间停顿导致的截断问题
}

impl Default for WebTaskSegmentationConfig {
    fn default() -> Self {
        Self { pause_ms: default_web_pause_ms() }
    }
}

/// MODEL_NOT_AVAILABLE 处理配置（Phase 1）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelNotAvailableConfig {
    /// 对 (node_id, service_id) 标记“暂不可用”的 TTL（秒）
    #[serde(default = "default_model_na_unavailable_ttl_seconds")]
    pub unavailable_ttl_seconds: u64,
    /// 去抖窗口（秒）：同一 (service_id, version) 在窗口内只记录一次“昂贵操作”日志/指标
    #[serde(default = "default_model_na_debounce_window_seconds")]
    pub debounce_window_seconds: u64,
    /// 节点级限流窗口（秒）
    #[serde(default = "default_model_na_node_ratelimit_window_seconds")]
    pub node_ratelimit_window_seconds: u64,
    /// 节点级限流阈值：每窗口最多接受多少次 MODEL_NOT_AVAILABLE 事件（超出丢弃）
    #[serde(default = "default_model_na_node_ratelimit_max")]
    pub node_ratelimit_max: u32,
}

fn default_model_na_unavailable_ttl_seconds() -> u64 {
    60
}

fn default_model_na_debounce_window_seconds() -> u64 {
    5
}

fn default_model_na_node_ratelimit_window_seconds() -> u64 {
    10
}

fn default_model_na_node_ratelimit_max() -> u32 {
    30
}

impl Default for ModelNotAvailableConfig {
    fn default() -> Self {
        Self {
            unavailable_ttl_seconds: default_model_na_unavailable_ttl_seconds(),
            debounce_window_seconds: default_model_na_debounce_window_seconds(),
            node_ratelimit_window_seconds: default_model_na_node_ratelimit_window_seconds(),
            node_ratelimit_max: default_model_na_node_ratelimit_max(),
        }
    }
}

/// 节点健康检查配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeHealthConfig {
    /// 心跳间隔（秒）
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_seconds: u64,
    /// 心跳超时（秒），超过此时间未收到心跳则判为 offline
    #[serde(default = "default_heartbeat_timeout")]
    pub heartbeat_timeout_seconds: u64,
    /// registering → ready 需要连续正常心跳次数
    #[serde(default = "default_health_check_count")]
    pub health_check_count: usize,
    /// warmup 超时（秒），超过此时间仍未 ready 则转 degraded
    #[serde(default = "default_warmup_timeout")]
    pub warmup_timeout_seconds: u64,
    /// 失败率阈值：连续 N 次中失败 ≥ M 次，或连续失败 M 次
    #[serde(default = "default_failure_threshold")]
    pub failure_threshold: FailureThreshold,
    /// 状态转换定期扫描间隔（秒）
    #[serde(default = "default_status_scan_interval")]
    pub status_scan_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailureThreshold {
    /// 检查窗口大小（例如：5 次）
    pub window_size: usize,
    /// 失败次数阈值（例如：3 次）
    pub failure_count: usize,
    /// 连续失败次数阈值（例如：3 次）
    pub consecutive_failure_count: usize,
}

fn default_heartbeat_interval() -> u64 {
    15
}

fn default_heartbeat_timeout() -> u64 {
    45
}

fn default_health_check_count() -> usize {
    3
}

fn default_warmup_timeout() -> u64 {
    60
}

fn default_failure_threshold() -> FailureThreshold {
    FailureThreshold {
        window_size: 5,
        failure_count: 3,
        consecutive_failure_count: 3,
    }
}

fn default_status_scan_interval() -> u64 {
    30
}

impl Default for NodeHealthConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval_seconds: default_heartbeat_interval(),
            heartbeat_timeout_seconds: default_heartbeat_timeout(),
            health_check_count: default_health_check_count(),
            warmup_timeout_seconds: default_warmup_timeout(),
            failure_threshold: default_failure_threshold(),
            status_scan_interval_seconds: default_status_scan_interval(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancerConfig {
    #[serde(default = "default_load_balancer_strategy")]
    pub strategy: String,
    /// 资源使用率阈值（超过此值的节点将被跳过）
    #[serde(default = "default_resource_threshold")]
    pub resource_threshold: f32,
}

fn default_resource_threshold() -> f32 {
    75.0 // 默认 75%（CPU、GPU、内存使用率超过此值将被跳过）
}

fn default_load_balancer_strategy() -> String {
    "least_connections".to_string()
}

impl Default for LoadBalancerConfig {
    fn default() -> Self {
        Self {
            strategy: default_load_balancer_strategy(),
            resource_threshold: default_resource_threshold(),
        }
    }
}

impl Config {
    pub fn load() -> anyhow::Result<Self> {
        let config_path = PathBuf::from("config.toml");
        
        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let config: Config = toml::from_str(&content)?;
            Ok(config)
        } else {
            // 使用默认配置
            Ok(Config::default())
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                port: 5010,
                host: "0.0.0.0".to_string(),
            },
            model_hub: ModelHubConfig {
                base_url: "http://localhost:5000".to_string(),
                // 默认指向 repo 内 ModelHub 服务包索引目录（可在 config.toml 覆盖）
                // 期望存在 services_index.json（用于 Scheduler 单机冷启动/离线兜底）
                storage_path: PathBuf::from("../model-hub/models/services"),
            },
            scheduler: SchedulerConfig {
                max_concurrent_jobs_per_node: 4,
                job_timeout_seconds: 30,
                heartbeat_interval_seconds: 15,
                job_timeout: JobTimeoutPolicyConfig::default(),
                load_balancer: LoadBalancerConfig {
                    strategy: "least_connections".to_string(),
                    resource_threshold: default_resource_threshold(),
                },
                node_health: NodeHealthConfig::default(),
                model_not_available: ModelNotAvailableConfig::default(),
                task_binding: TaskBindingConfig::default(),
                web_task_segmentation: WebTaskSegmentationConfig::default(),
                observability: ObservabilityConfig::default(),
                core_services: CoreServicesConfig::default(),
                phase2: Phase2Config::default(),
                phase3: Phase3Config::default(),
            },
        }
    }
}

/// 方向A：采样日志阈值配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservabilityConfig {
    /// 获取锁等待时间超过该阈值就记录 warn（毫秒）
    #[serde(default = "default_obs_lock_wait_warn_ms")]
    pub lock_wait_warn_ms: u64,
    /// 关键路径耗时超过该阈值就记录 warn（毫秒）
    #[serde(default = "default_obs_path_warn_ms")]
    pub path_warn_ms: u64,
}

fn default_obs_lock_wait_warn_ms() -> u64 {
    10
}

fn default_obs_path_warn_ms() -> u64 {
    50
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        Self {
            lock_wait_warn_ms: default_obs_lock_wait_warn_ms(),
            path_warn_ms: default_obs_path_warn_ms(),
        }
    }
}

